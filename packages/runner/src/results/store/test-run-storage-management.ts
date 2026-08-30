import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { validateTestRunId } from '../test-run-id'
import { withIndex } from './test-run-index'
import type {
  RetentionPolicy,
  RetentionResult,
  TestRunManifest,
  TestRunStorageInspection,
} from './test-run-store-types'

interface RunPinsFile {
  schemaVersion: 1
  runIds: string[]
}

export interface RunStoragePaths {
  projectDirectory: string
  runsDirectory: string
  indexPath: string
  runPinsPath: string
}

export async function readPinnedRunIds(
  runPinsPath: string,
): Promise<Set<string>> {
  if (!(await Bun.file(runPinsPath).exists())) return new Set()
  const source: unknown = await Bun.file(runPinsPath).json()
  if (!isRunPinsFile(source)) {
    throw new Error('Pinned Test run metadata is invalid')
  }
  source.runIds.forEach(validateTestRunId)
  return new Set(source.runIds)
}

async function writePinnedRunIds(
  paths: RunStoragePaths,
  runIds: ReadonlySet<string>,
): Promise<void> {
  await mkdir(paths.projectDirectory, { recursive: true })
  const temporaryPath = `${paths.runPinsPath}.${crypto.randomUUID()}.tmp`
  const contents: RunPinsFile = {
    schemaVersion: 1,
    runIds: [...runIds].sort(),
  }
  try {
    await Bun.write(temporaryPath, `${JSON.stringify(contents, null, 2)}\n`)
    await rename(temporaryPath, paths.runPinsPath)
  } finally {
    await rm(temporaryPath, { force: true })
  }
}

export async function updatePinnedRun(
  paths: RunStoragePaths,
  id: string,
  pinned: boolean,
): Promise<void> {
  validateTestRunId(id)
  const eventsPath = join(paths.runsDirectory, id, 'events.ndjson')
  if (!(await Bun.file(eventsPath).exists())) {
    throw new Error(`Test run "${id}" was not found`)
  }
  const runIds = await readPinnedRunIds(paths.runPinsPath)
  if (pinned) runIds.add(id)
  else runIds.delete(id)
  await writePinnedRunIds(paths, runIds)
}

export async function inspectTestRunStorage(
  paths: RunStoragePaths,
  warningThresholdBytes: number,
): Promise<TestRunStorageInspection> {
  const totalBytes = await directorySize(paths.runsDirectory)
  const pinnedRunIds = [...(await readPinnedRunIds(paths.runPinsPath))].sort()
  return {
    totalBytes,
    warningThresholdBytes,
    warning: totalBytes >= warningThresholdBytes,
    pinnedRunIds,
  }
}

export async function applyRunRetention(
  paths: RunStoragePaths,
  policy: RetentionPolicy,
  now: Date,
  loadManifests: () => Promise<TestRunManifest[]>,
): Promise<RetentionResult> {
  const beforeBytes = await directorySize(paths.runsDirectory)
  if (policy.maxAgeMs === undefined && policy.maxBytes === undefined) {
    return { removed: [], beforeBytes, afterBytes: beforeBytes }
  }
  const cutoff =
    policy.maxAgeMs === undefined ? undefined : now.getTime() - policy.maxAgeMs
  const pinnedRunIds = await readPinnedRunIds(paths.runPinsPath)
  const eligible = (await loadManifests())
    .filter((manifest) => manifest.finishedAt && !pinnedRunIds.has(manifest.id))
    .sort(byOldest)
  const removed = await removeExpiredRuns(paths, eligible, cutoff)
  const afterBytes = await removeRunsOverLimit(
    paths,
    eligible,
    policy.maxBytes,
    removed,
  )
  return { removed, beforeBytes, afterBytes }
}

async function removeExpiredRuns(
  paths: RunStoragePaths,
  eligible: readonly TestRunManifest[],
  cutoff: number | undefined,
): Promise<string[]> {
  const removed: string[] = []
  if (cutoff === undefined) return removed
  for (const manifest of eligible) {
    if (!manifest.finishedAt || Date.parse(manifest.finishedAt) > cutoff)
      continue
    await removeRun(paths, manifest.id)
    removed.push(manifest.id)
  }
  return removed
}

async function removeRunsOverLimit(
  paths: RunStoragePaths,
  eligible: readonly TestRunManifest[],
  maxBytes: number | undefined,
  removed: string[],
): Promise<number> {
  let total = await directorySize(paths.runsDirectory)
  if (maxBytes === undefined) return total
  const removedRunIds = new Set(removed)
  const remaining = eligible.filter(
    (manifest) => !removedRunIds.has(manifest.id),
  )
  while (total > maxBytes) {
    const oldest = remaining.shift()
    if (!oldest) break
    await removeRun(paths, oldest.id)
    removed.push(oldest.id)
    total = await directorySize(paths.runsDirectory)
  }
  return total
}

async function removeRun(paths: RunStoragePaths, id: string): Promise<void> {
  await rm(join(paths.runsDirectory, id), { recursive: true, force: true })
  if (!(await Bun.file(paths.indexPath).exists())) return
  withIndex(paths.indexPath, (db) =>
    db.run('DELETE FROM runs WHERE id = ?', [id]),
  )
}

function byOldest(left: TestRunManifest, right: TestRunManifest): number {
  return (
    Date.parse(left.startedAt) - Date.parse(right.startedAt) ||
    left.id.localeCompare(right.id)
  )
}

function isRunPinsFile(value: unknown): value is RunPinsFile {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RunPinsFile>
  return (
    candidate.schemaVersion === 1 &&
    Array.isArray(candidate.runIds) &&
    candidate.runIds.every((id: unknown) => typeof id === 'string')
  )
}

async function directorySize(directory: string): Promise<number> {
  if (!(await pathExists(directory))) return 0
  let total = 0
  const files = new Bun.Glob('**/*').scan({
    cwd: directory,
    onlyFiles: true,
  })
  for await (const relativePath of files) {
    total += (await Bun.file(join(directory, relativePath)).size) ?? 0
  }
  return total
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}
