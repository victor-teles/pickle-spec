import { mkdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type { RunEvent, TestResult, TestStepResult } from './run-scenario'
import { openTestRunStore, type TestRunManifest } from './test-run-store'

export interface RunArchiveArtifact {
  path: string
  mediaType?: string
  content: string
}

export interface RunArchive {
  schemaVersion: 1
  kind: 'run-archive'
  manifest: TestRunManifest
  events: RunEvent[]
  artifacts: RunArchiveArtifact[]
}

export interface WriteRunArchiveInput {
  root: string
  runId: string
  outputPath: string
}

export interface ImportRunArchiveInput {
  root: string
  archivePath: string
}

export interface ImportedRunArchive {
  manifest: TestRunManifest
  events: RunEvent[]
  preservedArchivePath: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function migrateStep(step: unknown): TestStepResult {
  const value = isRecord(step) ? step : {}
  return {
    step: value.step as TestStepResult['step'],
    state: value.state as TestStepResult['state'],
    resolvedActions: Array.isArray(value.resolvedActions)
      ? (value.resolvedActions as TestStepResult['resolvedActions'])
      : [],
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
    ...(Array.isArray(value.artifacts)
      ? { artifacts: value.artifacts as TestStepResult['artifacts'] }
      : {}),
  }
}

function migrateResult(result: unknown): TestResult {
  const value = isRecord(result) ? result : {}
  const scenario = isRecord(value.scenario) ? value.scenario : {}
  return {
    schemaVersion: 1,
    specification: value.specification as TestResult['specification'],
    scenario: {
      name: String(scenario.name ?? ''),
      ...(typeof scenario.id === 'string' ? { id: scenario.id } : {}),
    },
    executionTargetProfile:
      value.executionTargetProfile as TestResult['executionTargetProfile'],
    state: value.state as TestResult['state'],
    steps: Array.isArray(value.steps) ? value.steps.map(migrateStep) : [],
    ...(typeof value.executionMode === 'string'
      ? { executionMode: value.executionMode as TestResult['executionMode'] }
      : {}),
    ...(typeof value.message === 'string' ? { message: value.message } : {}),
    ...(typeof value.attempts === 'number' ? { attempts: value.attempts } : {}),
    ...(typeof value.flaky === 'boolean' ? { flaky: value.flaky } : {}),
    ...(typeof value.durationMs === 'number'
      ? { durationMs: value.durationMs }
      : {}),
  }
}

function migrateEvent(event: unknown, index: number): RunEvent {
  const value = isRecord(event) ? event : {}
  const base = {
    schemaVersion: 1 as const,
    sequence: typeof value.sequence === 'number' ? value.sequence : index + 1,
  }
  if (value.type === 'scenario-finished') {
    return {
      ...base,
      type: 'scenario-finished',
      result: migrateResult(value.result),
    }
  }
  if (value.type === 'step-finished') {
    return {
      ...base,
      type: 'step-finished',
      result: migrateStep(value.result),
    }
  }
  return { ...base, ...(value as object) } as RunEvent
}

function migrateManifest(manifest: unknown): TestRunManifest {
  const value = isRecord(manifest) ? manifest : {}
  return {
    schemaVersion: 1,
    id: String(value.id ?? ''),
    startedAt: String(value.startedAt ?? ''),
    ...(typeof value.finishedAt === 'string'
      ? { finishedAt: value.finishedAt }
      : {}),
    ...(typeof value.sourceRunId === 'string'
      ? { sourceRunId: value.sourceRunId }
      : {}),
    state: value.state as TestRunManifest['state'],
    results: Array.isArray(value.results)
      ? value.results.map(migrateResult)
      : [],
  }
}

export function migrateRunArchive(value: unknown): RunArchive {
  const archive = isRecord(value) ? value : {}
  const events = Array.isArray(archive.events) ? archive.events : []
  return {
    schemaVersion: 1,
    kind: 'run-archive',
    manifest: migrateManifest(archive.manifest),
    events: events.map(migrateEvent),
    artifacts: Array.isArray(archive.artifacts)
      ? (archive.artifacts as RunArchiveArtifact[])
      : [],
  }
}

interface CollectedArtifact {
  absolutePath: string
  archivePath: string
  mediaType?: string
}

function collectArtifacts(
  manifest: TestRunManifest,
  events: RunEvent[],
  runDirectory: string,
): CollectedArtifact[] {
  const byAbsolute = new Map<string, CollectedArtifact>()
  const consider = (path: string, mediaType: string | undefined): void => {
    if (byAbsolute.has(path)) return
    const archivePath = relative(runDirectory, path)
    byAbsolute.set(path, {
      absolutePath: path,
      archivePath: archivePath.startsWith('..')
        ? join('artifacts', path.split('/').at(-1) ?? 'artifact.bin')
        : archivePath,
      ...(mediaType ? { mediaType } : {}),
    })
  }

  for (const result of manifest.results) {
    for (const step of result.steps) {
      for (const artifact of step.artifacts ?? []) {
        consider(artifact.path, artifact.mediaType)
      }
    }
  }
  for (const event of events) {
    if (event.type === 'scenario-finished') {
      for (const step of event.result.steps) {
        for (const artifact of step.artifacts ?? []) {
          consider(artifact.path, artifact.mediaType)
        }
      }
    }
    if (event.type === 'step-finished') {
      for (const artifact of event.result.artifacts ?? []) {
        consider(artifact.path, artifact.mediaType)
      }
    }
  }
  return [...byAbsolute.values()]
}

function remapArtifactPath(
  path: string,
  pathMap: Map<string, string>,
  runDirectory: string,
): string {
  return pathMap.get(path) ?? join(runDirectory, path)
}

function remapResult(
  result: TestResult,
  pathMap: Map<string, string>,
  runDirectory: string,
): TestResult {
  return {
    ...result,
    steps: result.steps.map((step) => ({
      ...step,
      ...(step.artifacts
        ? {
            artifacts: step.artifacts.map((artifact) => ({
              ...artifact,
              path: remapArtifactPath(artifact.path, pathMap, runDirectory),
            })),
          }
        : {}),
    })),
  }
}

export async function writeRunArchive(
  input: WriteRunArchiveInput,
): Promise<RunArchive> {
  const store = openTestRunStore({ root: input.root })
  const run = await store.open(input.runId)
  const events = await run.events()
  if (events.length === 0) {
    throw new Error(`Unknown test run "${input.runId}"`)
  }
  const runDirectory = join(input.root, '.pickle', 'runs', input.runId)
  const manifestPath = join(runDirectory, 'manifest.json')
  const manifest = (await Bun.file(manifestPath).exists())
    ? ((await Bun.file(manifestPath).json()) as TestRunManifest)
    : await run.materialize({ finished: false })
  const collected = collectArtifacts(manifest, events, runDirectory)
  const artifacts: RunArchiveArtifact[] = []
  for (const item of collected) {
    if (!(await Bun.file(item.absolutePath).exists())) continue
    const bytes = new Uint8Array(
      await Bun.file(item.absolutePath).arrayBuffer(),
    )
    artifacts.push({
      path: item.archivePath,
      content: Buffer.from(bytes).toString('base64'),
      ...(item.mediaType ? { mediaType: item.mediaType } : {}),
    })
  }

  const pathMap = new Map(
    collected.map((item) => [item.absolutePath, item.archivePath]),
  )
  const archivedManifest: TestRunManifest = {
    ...manifest,
    results: manifest.results.map((result) => ({
      ...result,
      steps: result.steps.map((step) => ({
        ...step,
        ...(step.artifacts
          ? {
              artifacts: step.artifacts.map((artifact) => ({
                ...artifact,
                path: pathMap.get(artifact.path) ?? artifact.path,
              })),
            }
          : {}),
      })),
    })),
  }
  const archivedEvents = events.map((event) => {
    if (event.type === 'scenario-finished') {
      return {
        ...event,
        result: {
          ...event.result,
          steps: event.result.steps.map((step) => ({
            ...step,
            ...(step.artifacts
              ? {
                  artifacts: step.artifacts.map((artifact) => ({
                    ...artifact,
                    path: pathMap.get(artifact.path) ?? artifact.path,
                  })),
                }
              : {}),
          })),
        },
      }
    }
    if (event.type === 'step-finished' && event.result.artifacts) {
      return {
        ...event,
        result: {
          ...event.result,
          artifacts: event.result.artifacts.map((artifact) => ({
            ...artifact,
            path: pathMap.get(artifact.path) ?? artifact.path,
          })),
        },
      }
    }
    return event
  })

  const archive: RunArchive = {
    schemaVersion: 1,
    kind: 'run-archive',
    manifest: archivedManifest,
    events: archivedEvents,
    artifacts,
  }
  await mkdir(dirname(input.outputPath), { recursive: true })
  await Bun.write(input.outputPath, `${JSON.stringify(archive, null, 2)}\n`)
  return archive
}

export async function readRunArchive(path: string): Promise<RunArchive> {
  const parsed: unknown = JSON.parse(await Bun.file(path).text())
  return migrateRunArchive(parsed)
}

export async function importRunArchive(
  input: ImportRunArchiveInput,
): Promise<ImportedRunArchive> {
  const originalBytes = new Uint8Array(
    await Bun.file(input.archivePath).arrayBuffer(),
  )
  const archive = migrateRunArchive(
    JSON.parse(new TextDecoder().decode(originalBytes)),
  )
  const pickleDirectory = join(input.root, '.pickle')
  const archivesDirectory = join(pickleDirectory, 'archives')
  const runDirectory = join(pickleDirectory, 'runs', archive.manifest.id)
  const preservedArchivePath = join(
    archivesDirectory,
    `${archive.manifest.id}.json`,
  )
  await mkdir(archivesDirectory, { recursive: true })
  await mkdir(join(runDirectory, 'artifacts'), { recursive: true })
  await Bun.write(preservedArchivePath, originalBytes)

  const pathMap = new Map<string, string>()
  for (const artifact of archive.artifacts) {
    const target = join(runDirectory, artifact.path)
    await mkdir(dirname(target), { recursive: true })
    await Bun.write(target, Buffer.from(artifact.content, 'base64'))
    pathMap.set(artifact.path, target)
  }

  const events = archive.events.map((event) => {
    if (event.type === 'scenario-finished') {
      return {
        ...event,
        result: remapResult(event.result, pathMap, runDirectory),
      }
    }
    if (event.type === 'step-finished') {
      return {
        ...event,
        result: {
          ...event.result,
          ...(event.result.artifacts
            ? {
                artifacts: event.result.artifacts.map((artifact) => ({
                  ...artifact,
                  path: remapArtifactPath(artifact.path, pathMap, runDirectory),
                })),
              }
            : {}),
        },
      }
    }
    return event
  })
  const manifest: TestRunManifest = {
    ...archive.manifest,
    results: archive.manifest.results.map((result) =>
      remapResult(result, pathMap, runDirectory),
    ),
  }

  await Bun.write(
    join(runDirectory, 'events.ndjson'),
    `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
  )
  await Bun.write(
    join(runDirectory, 'manifest.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )

  await openTestRunStore({ root: input.root }).rebuildIndex()

  return {
    manifest,
    events,
    preservedArchivePath,
  }
}
