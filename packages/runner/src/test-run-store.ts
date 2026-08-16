import { Database } from 'bun:sqlite'
import { appendFile, copyFile, mkdir, rm } from 'node:fs/promises'
import { extname, join } from 'node:path'
import type {
  RunEvent,
  RunEventPayload,
  TestResult,
  TestResultState,
  TestStepResult,
} from './run-scenario'

export type ArtifactCapturePolicy =
  | 'off'
  | 'on-failure-or-adaptation'
  | 'always'

export interface TestRunStoreOptions {
  root: string
  createId?: () => string
  now?: () => Date
  artifactCapture?: ArtifactCapturePolicy
}

export interface TestRunManifest {
  schemaVersion: 1
  id: string
  startedAt: string
  finishedAt?: string
  state: TestResultState
  results: TestResult[]
}

export interface TestRunSummary {
  id: string
  startedAt: string
  finishedAt?: string
  state: TestResultState
  resultCount: number
}

export interface PersistedTestRun {
  id: string
  append(event: RunEvent | RunEventPayload): Promise<RunEvent>
  events(): Promise<RunEvent[]>
  materialize(input?: { finished?: boolean }): Promise<TestRunManifest>
}

export interface RetentionPolicy {
  maxAgeMs?: number
  maxBytes?: number
}

export interface RetentionResult {
  removed: string[]
}

export interface TestRunStore {
  create(): Promise<PersistedTestRun>
  open(id: string): Promise<PersistedTestRun>
  list(): Promise<TestRunSummary[]>
  rebuildIndex(): Promise<void>
  applyRetention(policy?: RetentionPolicy): Promise<RetentionResult>
}

export const defaultRetention = {
  maxAgeMs: 30 * 24 * 60 * 60 * 1000,
  maxBytes: 2 * 1024 * 1024 * 1024,
}

const stateRank: Record<TestResultState, number> = {
  skipped: 0,
  passed: 1,
  'passed-with-adaptation': 2,
  cancelled: 3,
  failed: 4,
  'infrastructure-error': 5,
}

export function openTestRunStore(options: TestRunStoreOptions): TestRunStore {
  const createId = options.createId ?? (() => crypto.randomUUID())
  const now = options.now ?? (() => new Date())
  const artifactCapture = options.artifactCapture ?? 'on-failure-or-adaptation'
  const pickleDirectory = join(options.root, '.pickle')
  const runsDirectory = join(pickleDirectory, 'runs')
  const indexPath = join(pickleDirectory, 'index.sqlite')

  async function upsertManifest(manifest: TestRunManifest): Promise<void> {
    await mkdir(pickleDirectory, { recursive: true })
    const db = openIndex(indexPath)
    try {
      upsertRun(db, manifest)
    } finally {
      db.close()
    }
  }

  function runAt(id: string, startedAt: string): PersistedTestRun {
    return persistedTestRun(
      id,
      join(runsDirectory, id),
      startedAt,
      now,
      artifactCapture,
      upsertManifest,
    )
  }

  async function openRun(id: string): Promise<PersistedTestRun> {
    const events = await readEvents(join(runsDirectory, id, 'events.ndjson'))
    const started = events.find((event) => event.type === 'run-started')
    return runAt(
      id,
      started?.type === 'run-started'
        ? started.run.startedAt
        : now().toISOString(),
    )
  }

  async function manifestFor(id: string): Promise<TestRunManifest> {
    const manifestPath = join(runsDirectory, id, 'manifest.json')
    if (await Bun.file(manifestPath).exists()) {
      return (await Bun.file(manifestPath).json()) as TestRunManifest
    }
    return (await openRun(id)).materialize({ finished: false })
  }

  async function loadManifests(): Promise<TestRunManifest[]> {
    const manifests: TestRunManifest[] = []
    try {
      const files = new Bun.Glob('*/events.ndjson').scan({
        cwd: runsDirectory,
        onlyFiles: true,
      })
      for await (const relativePath of files) {
        manifests.push(await manifestFor(relativePath.split('/')[0]!))
      }
    } catch {
      return []
    }
    return manifests
  }

  async function rebuild() {
    await mkdir(pickleDirectory, { recursive: true })
    const db = openIndex(indexPath)
    try {
      db.run('DELETE FROM runs')
      for (const manifest of await loadManifests()) upsertRun(db, manifest)
    } finally {
      db.close()
    }
  }

  return {
    async create() {
      const id = createId()
      const startedAt = now().toISOString()
      await mkdir(join(runsDirectory, id), { recursive: true })
      const run = runAt(id, startedAt)
      await run.append({ type: 'run-started', run: { id, startedAt } })
      return run
    },
    open: openRun,
    async list() {
      if (!(await Bun.file(indexPath).exists())) await rebuild()
      const db = openIndex(indexPath)
      try {
        return listRuns(db)
      } finally {
        db.close()
      }
    },
    async rebuildIndex() {
      await rebuild()
    },
    async applyRetention(policy: RetentionPolicy = {}) {
      const maxAgeMs = policy.maxAgeMs ?? defaultRetention.maxAgeMs
      const maxBytes = policy.maxBytes ?? defaultRetention.maxBytes
      const cutoff = now().getTime() - maxAgeMs
      const removed: string[] = []
      const manifests = await loadManifests()
      for (const manifest of manifests) {
        if (Date.parse(manifest.startedAt) <= cutoff) {
          await removeRun(runsDirectory, indexPath, manifest.id)
          removed.push(manifest.id)
        }
      }
      const remaining = manifests.filter(
        (manifest) => !removed.includes(manifest.id),
      )
      remaining.sort(
        (left, right) =>
          Date.parse(left.startedAt) - Date.parse(right.startedAt) ||
          left.id.localeCompare(right.id),
      )
      let total = await directorySize(runsDirectory)
      while (remaining.length > 1 && total > maxBytes) {
        const oldest = remaining.shift()
        if (!oldest) break
        await removeRun(runsDirectory, indexPath, oldest.id)
        removed.push(oldest.id)
        total = await directorySize(runsDirectory)
      }
      return { removed }
    },
  }
}

function persistedTestRun(
  id: string,
  directory: string,
  startedAt: string,
  now: () => Date,
  artifactCapture: ArtifactCapturePolicy,
  onMaterialize: (manifest: TestRunManifest) => Promise<void>,
): PersistedTestRun {
  const eventsPath = join(directory, 'events.ndjson')
  const manifestPath = join(directory, 'manifest.json')
  const artifactsDirectory = join(directory, 'artifacts')

  return {
    id,
    async append(event) {
      const current = await readEvents(eventsPath)
      const versioned = {
        ...(await persistEventArtifacts(
          eventPayload(event),
          artifactCapture,
          artifactsDirectory,
        )),
        schemaVersion: 1 as const,
        sequence: current.length + 1,
      } as RunEvent
      await appendFile(eventsPath, `${JSON.stringify(versioned)}\n`)
      return versioned
    },
    async events() {
      return readEvents(eventsPath)
    },
    async materialize(input) {
      const recorded = await readEvents(eventsPath)
      const started = recorded.find((event) => event.type === 'run-started')
      const results = recorded.flatMap((event) =>
        event.type === 'scenario-finished' ? [event.result] : [],
      )
      const manifest: TestRunManifest = {
        schemaVersion: 1,
        id,
        startedAt:
          started?.type === 'run-started' ? started.run.startedAt : startedAt,
        ...(input?.finished === false
          ? {}
          : { finishedAt: now().toISOString() }),
        state: aggregateState(results),
        results,
      }
      await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
      await onMaterialize(manifest)
      return manifest
    },
  }
}

interface IndexedRun {
  id: string
  startedAt: string
  finishedAt: string | null
  state: TestResultState
  resultCount: number
}

function openIndex(path: string): Database {
  const db = new Database(path, { create: true })
  db.run(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      state TEXT NOT NULL,
      result_count INTEGER NOT NULL
    )
  `)
  return db
}

function upsertRun(db: Database, manifest: TestRunManifest): void {
  db.run(
    `INSERT INTO runs (id, started_at, finished_at, state, result_count)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       started_at = excluded.started_at,
       finished_at = excluded.finished_at,
       state = excluded.state,
       result_count = excluded.result_count`,
    [
      manifest.id,
      manifest.startedAt,
      manifest.finishedAt ?? null,
      manifest.state,
      manifest.results.length,
    ],
  )
}

function listRuns(db: Database): TestRunSummary[] {
  return db
    .query(
      'SELECT id, started_at AS startedAt, finished_at AS finishedAt, state, result_count AS resultCount FROM runs ORDER BY id',
    )
    .all()
    .map((row) => {
      const indexed = row as IndexedRun
      return {
        id: indexed.id,
        startedAt: indexed.startedAt,
        ...(indexed.finishedAt ? { finishedAt: indexed.finishedAt } : {}),
        state: indexed.state,
        resultCount: indexed.resultCount,
      }
    })
}

function aggregateState(results: TestResult[]): TestResultState {
  return results.reduce<TestResultState>(
    (state, result) =>
      stateRank[result.state] > stateRank[state] ? result.state : state,
    'skipped',
  )
}

function eventPayload(event: RunEvent | RunEventPayload): RunEventPayload {
  if ('schemaVersion' in event) {
    const {
      schemaVersion: _schemaVersion,
      sequence: _sequence,
      ...payload
    } = event
    return payload
  }
  return event
}

async function readEvents(path: string): Promise<RunEvent[]> {
  if (!(await Bun.file(path).exists())) return []
  const source = await Bun.file(path).text()
  return source
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as RunEvent)
}

async function persistEventArtifacts(
  event: RunEventPayload,
  policy: ArtifactCapturePolicy,
  artifactsDirectory: string,
): Promise<RunEventPayload> {
  if (event.type === 'scenario-finished') {
    return {
      ...event,
      result: await persistResultArtifacts(
        event.result,
        policy,
        artifactsDirectory,
      ),
    }
  }
  if (event.type === 'step-finished') {
    return {
      ...event,
      result: await persistStepArtifacts(
        event.result,
        policy,
        artifactsDirectory,
        event.result.step.text,
      ),
    }
  }
  return event
}

async function persistResultArtifacts(
  result: TestResult,
  policy: ArtifactCapturePolicy,
  artifactsDirectory: string,
): Promise<TestResult> {
  const capture = shouldCapture(policy, result.state) ? 'always' : 'off'
  const steps = await Promise.all(
    result.steps.map((step, index) =>
      persistStepArtifacts(
        step,
        capture,
        artifactsDirectory,
        `${result.scenario.name}-${index + 1}`,
      ),
    ),
  )
  return { ...result, steps }
}

async function persistStepArtifacts(
  step: TestStepResult,
  policy: ArtifactCapturePolicy,
  artifactsDirectory: string,
  name: string,
): Promise<TestStepResult> {
  if (!step.artifacts?.length) return step
  if (!shouldCapture(policy, step.state)) {
    const { artifacts: _artifacts, ...rest } = step
    return rest
  }
  await mkdir(artifactsDirectory, { recursive: true })
  const artifacts = await Promise.all(
    step.artifacts.map(async (artifact, index) => {
      const extension = extname(artifact.path) || '.bin'
      const filename =
        index === 0
          ? `${slug(name)}${extension}`
          : `${slug(name)}-${index + 1}${extension}`
      const path = join(artifactsDirectory, filename)
      await copyFile(artifact.path, path)
      return { ...artifact, path }
    }),
  )
  return { ...step, artifacts }
}

function shouldCapture(
  policy: ArtifactCapturePolicy,
  state: TestResultState,
): boolean {
  if (policy === 'always') return true
  if (policy === 'off') return false
  return state === 'failed' || state === 'passed-with-adaptation'
}

async function removeRun(
  runsDirectory: string,
  indexPath: string,
  id: string,
): Promise<void> {
  await rm(join(runsDirectory, id), { recursive: true, force: true })
  if (!(await Bun.file(indexPath).exists())) return
  const db = openIndex(indexPath)
  try {
    db.run('DELETE FROM runs WHERE id = ?', [id])
  } finally {
    db.close()
  }
}

async function directorySize(directory: string): Promise<number> {
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

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
