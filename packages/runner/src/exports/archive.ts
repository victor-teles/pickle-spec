import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import type { RunEvent } from '../execution/run-scenario'
import { testRunSchemaVersion } from '../execution/run-scenario'
import { parseTestRunManifest } from '../results/test-run-schema'
import {
  openTestRunStore,
  type TestRunManifest,
} from '../results/test-run-store'
import { resolveLocalProjectStorage } from '../storage/local-project-storage'
import {
  assertArchiveArtifactPayloads,
  collectArtifacts,
  containedArtifactPath,
  mapEventArtifacts,
  mapResultArtifacts,
} from './archive/archive-artifacts'
import { importRunArchive } from './archive/archive-import'
import { parseRunArchive } from './archive/archive-migrate'
import {
  assertConsistentRunArchive,
  assertFinalizedManifest,
} from './archive/archive-validation'

export { importRunArchive, parseRunArchive }

export interface RunArchiveArtifact {
  path: string
  mediaType?: string
  content: string
}

export interface RunArchive {
  schemaVersion: typeof testRunSchemaVersion
  kind: 'run-archive'
  manifest: TestRunManifest
  events: RunEvent[]
  artifacts: RunArchiveArtifact[]
}

export interface WriteRunArchiveInput {
  root: string
  pickleHome?: string
  runId: string
  outputPath: string
}

export interface ImportRunArchiveInput {
  root: string
  pickleHome?: string
  archivePath: string
}

export interface ImportedRunArchive {
  manifest: TestRunManifest
  events: RunEvent[]
  preservedArchivePath: string
}

interface LoadedRun {
  runDirectory: string
  manifest: TestRunManifest
  events: RunEvent[]
}

async function loadRunFiles(
  root: string,
  runId: string,
  pickleHome?: string,
): Promise<LoadedRun> {
  const store = openTestRunStore({ root, pickleHome })
  const run = await store.open(runId)
  const events = await run.events()
  if (events.length === 0) throw new Error(`Unknown test run "${runId}"`)
  const runDirectory = join(
    resolveLocalProjectStorage(root, pickleHome).runsDirectory,
    runId,
  )
  const manifestPath = join(runDirectory, 'manifest.json')
  if (!(await Bun.file(manifestPath).exists())) {
    throw new Error(`Test run "${runId}" must be finalized before export`)
  }
  const manifest = parseTestRunManifest(
    await Bun.file(manifestPath).json(),
    (version): never => {
      throw new Error(
        `Test run storage schema version ${String(version)} is unsupported`,
      )
    },
  )
  assertFinalizedManifest(manifest)
  return { runDirectory, manifest, events }
}

export async function writeRunArchive(
  input: WriteRunArchiveInput,
): Promise<RunArchive> {
  const { runDirectory, manifest, events } = await loadRunFiles(
    input.root,
    input.runId,
    input.pickleHome,
  )
  const collected = collectArtifacts(manifest, events, runDirectory)
  const pathMap = new Map(
    collected.map((item) => [resolve(item.absolutePath), item.archivePath]),
  )
  const mapPath = (path: string) =>
    pathMap.get(resolve(path)) ?? containedArtifactPath(runDirectory, path)
  const artifacts: RunArchiveArtifact[] = []
  for (const item of collected) {
    const file = Bun.file(item.absolutePath)
    if (!(await file.exists())) {
      throw new Error(`Artifact source file is missing: ${item.absolutePath}`)
    }
    artifacts.push({
      path: item.archivePath,
      content: Buffer.from(await file.arrayBuffer()).toString('base64'),
      mediaType: item.mediaType,
    })
  }

  const archive: RunArchive = {
    schemaVersion: testRunSchemaVersion,
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
  assertArchiveArtifactPayloads(archive)
  await mkdir(dirname(input.outputPath), { recursive: true })
  await Bun.write(input.outputPath, `${JSON.stringify(archive, null, 2)}\n`)
  return archive
}

export async function readRunArchive(path: string): Promise<RunArchive> {
  const parsed: unknown = JSON.parse(await Bun.file(path).text())
  const archive = parseRunArchive(parsed)
  assertConsistentRunArchive(archive)
  assertArchiveArtifactPayloads(archive)
  return archive
}
