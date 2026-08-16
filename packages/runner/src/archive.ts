import { mkdir, open, rm, stat } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { migrateRunArchive } from './archive-migrate'
import type { RunEvent, TestResult, TestStepResult } from './run-scenario'
import { openTestRunStore, type TestRunManifest } from './test-run-store'

export { migrateRunArchive }

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

interface CollectedArtifact {
  absolutePath: string
  archivePath: string
  mediaType?: string
}

type MapArtifactPath = (path: string) => string

type NodeError = Error & { code?: string }

function collectArtifacts(
  results: readonly TestResult[],
  runDirectory: string,
): CollectedArtifact[] {
  const byAbsolute = new Map<string, CollectedArtifact>()
  for (const result of results) {
    for (const step of result.steps) {
      for (const artifact of step.artifacts ?? []) {
        if (byAbsolute.has(artifact.path)) continue
        const archivePath = relative(runDirectory, artifact.path)
        byAbsolute.set(artifact.path, {
          absolutePath: artifact.path,
          archivePath: archivePath.startsWith('..')
            ? join('artifacts', basename(artifact.path))
            : archivePath,
          mediaType: artifact.mediaType,
        })
      }
    }
  }
  return [...byAbsolute.values()]
}

function mapStepArtifacts(
  step: TestStepResult,
  mapPath: MapArtifactPath,
): TestStepResult {
  if (!step.artifacts) return step
  return {
    ...step,
    artifacts: step.artifacts.map((artifact) => ({
      ...artifact,
      path: mapPath(artifact.path),
    })),
  }
}

function mapResultArtifacts(
  result: TestResult,
  mapPath: MapArtifactPath,
): TestResult {
  return {
    ...result,
    steps: result.steps.map((step) => mapStepArtifacts(step, mapPath)),
  }
}

function mapEventArtifacts(
  event: RunEvent,
  mapPath: MapArtifactPath,
): RunEvent {
  if (event.type === 'scenario-finished') {
    return { ...event, result: mapResultArtifacts(event.result, mapPath) }
  }
  if (event.type === 'step-finished') {
    return { ...event, result: mapStepArtifacts(event.result, mapPath) }
  }
  return event
}

type LoadedRun = {
  runDirectory: string
  manifest: TestRunManifest
  events: RunEvent[]
}

async function loadRunFiles(root: string, runId: string): Promise<LoadedRun> {
  const store = openTestRunStore({ root })
  const run = await store.open(runId)
  const events = await run.events()
  if (events.length === 0) throw new Error(`Unknown test run "${runId}"`)
  const runDirectory = join(root, '.pickle', 'runs', runId)
  const manifestFile = Bun.file(join(runDirectory, 'manifest.json'))
  const manifest = (await manifestFile.exists())
    ? ((await manifestFile.json()) as TestRunManifest)
    : await run.materialize({ finished: false })
  return { runDirectory, manifest, events }
}

export async function writeRunArchive(
  input: WriteRunArchiveInput,
): Promise<RunArchive> {
  const { runDirectory, manifest, events } = await loadRunFiles(
    input.root,
    input.runId,
  )
  const collected = collectArtifacts(manifest.results, runDirectory)
  const pathMap = new Map(
    collected.map((item) => [item.absolutePath, item.archivePath]),
  )
  const mapPath: MapArtifactPath = (path) => pathMap.get(path) ?? path
  const artifacts: RunArchiveArtifact[] = []
  for (const item of collected) {
    const file = Bun.file(item.absolutePath)
    if (!(await file.exists())) continue
    artifacts.push({
      path: item.archivePath,
      content: Buffer.from(await file.arrayBuffer()).toString('base64'),
      mediaType: item.mediaType,
    })
  }

  const archive: RunArchive = {
    schemaVersion: 1,
    kind: 'run-archive',
    manifest: {
      ...manifest,
      results: manifest.results.map((result) =>
        mapResultArtifacts(result, mapPath),
      ),
    },
    events: events.map((event) => mapEventArtifacts(event, mapPath)),
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
  validateRunId(archive.manifest.id)
  const pickleDirectory = join(input.root, '.pickle')
  const archivesDirectory = join(pickleDirectory, 'archives')
  const runDirectory = join(pickleDirectory, 'runs', archive.manifest.id)
  const preservedArchivePath = join(
    archivesDirectory,
    `${archive.manifest.id}.json`,
  )
  if (
    (await pathExists(runDirectory)) ||
    (await pathExists(preservedArchivePath))
  ) {
    throw new Error(`Test run "${archive.manifest.id}" already exists`)
  }
  const artifacts = archive.artifacts.map((artifact) => ({
    ...artifact,
    target: importedArtifactPath(runDirectory, artifact.path),
  }))
  await mkdir(archivesDirectory, { recursive: true })
  await mkdir(dirname(runDirectory), { recursive: true })
  try {
    await mkdir(runDirectory)
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new Error(`Test run "${archive.manifest.id}" already exists`)
    }
    throw error
  }

  let preservedArchive = false
  try {
    const archiveFile = await open(preservedArchivePath, 'wx')
    preservedArchive = true
    try {
      await archiveFile.writeFile(originalBytes)
    } finally {
      await archiveFile.close()
    }
    await mkdir(join(runDirectory, 'artifacts'))

    const pathMap = new Map<string, string>()
    for (const artifact of artifacts) {
      await mkdir(dirname(artifact.target), { recursive: true })
      await Bun.write(artifact.target, Buffer.from(artifact.content, 'base64'))
      pathMap.set(artifact.path, artifact.target)
    }
    const mapPath: MapArtifactPath = (path) =>
      pathMap.get(path) ?? join(runDirectory, path)
    const events = archive.events.map((event) =>
      mapEventArtifacts(event, mapPath),
    )
    const manifest: TestRunManifest = {
      ...archive.manifest,
      results: archive.manifest.results.map((result) =>
        mapResultArtifacts(result, mapPath),
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

    return { manifest, events, preservedArchivePath }
  } catch (error) {
    await rm(runDirectory, { recursive: true, force: true })
    if (preservedArchive) await rm(preservedArchivePath, { force: true })
    if (isAlreadyExists(error)) {
      throw new Error(`Test run "${archive.manifest.id}" already exists`)
    }
    throw error
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && (error as NodeError).code === 'EEXIST'
}

function validateRunId(id: string): void {
  if (
    !id ||
    id === '.' ||
    id === '..' ||
    id.includes('/') ||
    id.includes('\\')
  ) {
    throw new Error(`Invalid test run identifier "${id}"`)
  }
}

function importedArtifactPath(runDirectory: string, path: string): string {
  const artifactsDirectory = resolve(runDirectory, 'artifacts')
  const target = resolve(runDirectory, path)
  if (!target.startsWith(`${artifactsDirectory}${sep}`)) {
    throw new Error('Artifact path must stay inside the imported test run')
  }
  return target
}
