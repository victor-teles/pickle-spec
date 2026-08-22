import { Database } from 'bun:sqlite'
import { appendFile, copyFile, mkdir, rm, stat } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import type { CacheOutcome } from './execution-cache'
import { resolveLocalProjectStorage } from './local-project-storage'
import { recordableRunEventPayloadData } from './public-results'
import type {
  ExecutionMode,
  RunEvent,
  RunEventPayload,
  ScenarioAttempt,
  TestResult,
  TestResultState,
  TestStepResult,
} from './run-scenario'
import { finalScenarioAttempt, testRunSchemaVersion } from './run-scenario'
import { parseRunEvent, parseTestRunManifest } from './test-run-schema'

export type ArtifactCapturePolicy = 'off' | 'on-failure' | 'always'

export interface TestRunStoreOptions {
  root: string
  pickleHome?: string
  createId?: () => string
  now?: () => Date
  artifactCapture?: ArtifactCapturePolicy
}

export interface TestRunManifest {
  schemaVersion: typeof testRunSchemaVersion
  id: string
  startedAt: string
  finishedAt?: string
  sourceRunId?: string
  suite?: string
  applicationRevision?: string
  state: TestResultState
  results: TestResult[]
}

export interface CreateTestRunOptions {
  sourceRunId?: string
  suite?: string
  applicationRevision?: string
}

export interface TestRunSummary {
  id: string
  startedAt: string
  finishedAt?: string
  sourceRunId?: string
  suite?: string
  executionTargetProfileIds: string[]
  specificationUris: string[]
  applicationRevision?: string
  durationMs?: number
  state: TestResultState
  resultCount: number
  executionModes?: ExecutionMode[]
  cacheOutcomes?: CacheOutcome[]
  inferenceCount?: number
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
  create(options?: CreateTestRunOptions): Promise<PersistedTestRun>
  open(id: string): Promise<PersistedTestRun>
  list(): Promise<TestRunSummary[]>
  rebuildIndex(): Promise<void>
  applyRetention(policy?: RetentionPolicy): Promise<RetentionResult>
}

const dayMs = 24 * 60 * 60 * 1000
const indexSchemaVersion = 5

export const defaultRetention = {
  maxAgeMs: 30 * dayMs,
  maxBytes: 2 * 1024 * 1024 * 1024,
}

const stateRank: Record<TestResultState, number> = {
  skipped: 0,
  passed: 1,
  cancelled: 2,
  failed: 3,
  'infrastructure-error': 4,
}

type NodeError = Error & { code?: string }
type SerializeOperation = <Value>(
  operation: () => Promise<Value>,
) => Promise<Value>

export function openTestRunStore(options: TestRunStoreOptions): TestRunStore {
  const createId = options.createId ?? (() => crypto.randomUUID())
  const now = options.now ?? (() => new Date())
  const artifactCapture = options.artifactCapture ?? 'on-failure'
  const storage = resolveLocalProjectStorage(options.root, options.pickleHome)
  const projectDirectory = storage.projectDirectory
  const runsDirectory = storage.runsDirectory
  const indexPath = storage.runIndexPath
  const incompatibleSchema = (version: unknown): never => {
    throw new Error(
      `Test run storage schema version ${String(version)} is unsupported. ` +
        `Pickle did not modify it. Remove the runs directory manually and retry: ${runsDirectory}`,
    )
  }
  const runOperationQueues = new Map<string, Promise<void>>()

  function serializeRunOperation<Value>(
    id: string,
    operation: () => Promise<Value>,
  ): Promise<Value> {
    const pending = runOperationQueues.get(id) ?? Promise.resolve()
    const result = pending.then(operation)
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    runOperationQueues.set(id, tail)
    void tail.then(() => {
      if (runOperationQueues.get(id) === tail) runOperationQueues.delete(id)
    })
    return result
  }

  async function upsertManifest(manifest: TestRunManifest): Promise<void> {
    await mkdir(projectDirectory, { recursive: true })
    withIndex(indexPath, (db) => upsertRun(db, manifest))
  }

  function persistedRunFor(
    id: string,
    startedAt: string,
    metadata: CreateTestRunOptions = {},
  ): PersistedTestRun {
    return persistedTestRun(
      id,
      join(runsDirectory, id),
      startedAt,
      now,
      artifactCapture,
      upsertManifest,
      metadata,
      incompatibleSchema,
      (operation) => serializeRunOperation(id, operation),
    )
  }

  async function openRun(id: string): Promise<PersistedTestRun> {
    validateRunId(id)
    const events = await serializeRunOperation(id, () =>
      readEvents(join(runsDirectory, id, 'events.ndjson'), incompatibleSchema),
    )
    const started = events.find((event) => event.type === 'run-started')
    const sourceRunId =
      started?.type === 'run-started' ? started.run.sourceRunId : undefined
    const suite =
      started?.type === 'run-started' ? started.run.suite : undefined
    const applicationRevision =
      started?.type === 'run-started'
        ? started.run.applicationRevision
        : undefined
    return persistedRunFor(id, startedAtFrom(events, now().toISOString()), {
      sourceRunId,
      suite,
      applicationRevision,
    })
  }

  async function manifestFor(id: string): Promise<TestRunManifest> {
    const manifestPath = join(runsDirectory, id, 'manifest.json')
    if (await Bun.file(manifestPath).exists()) {
      return parseTestRunManifest(
        await Bun.file(manifestPath).json(),
        incompatibleSchema,
      )
    }
    return (await openRun(id)).materialize({ finished: false })
  }

  async function loadManifests(): Promise<TestRunManifest[]> {
    const manifests: TestRunManifest[] = []
    if (!(await pathExists(runsDirectory))) return manifests
    const files = new Bun.Glob('*/events.ndjson').scan({
      cwd: runsDirectory,
      onlyFiles: true,
    })
    for await (const relativePath of files) {
      const id = dirname(relativePath)
      validateRunId(id)
      const manifest = await manifestFor(id)
      if (manifest.id !== id) {
        throw new Error(
          `Test run manifest identifier "${manifest.id}" does not match "${id}"`,
        )
      }
      manifests.push(manifest)
    }
    return manifests
  }

  async function rebuild(providedManifests?: TestRunManifest[]) {
    const manifests = providedManifests ?? (await loadManifests())
    await mkdir(projectDirectory, { recursive: true })
    withIndex(indexPath, (db) => {
      db.run('DELETE FROM runs')
      for (const manifest of manifests) upsertRun(db, manifest)
      db.run(`PRAGMA user_version = ${indexSchemaVersion}`)
    })
  }

  return {
    async create(options: CreateTestRunOptions = {}) {
      await loadManifests()
      const id = createId()
      validateRunId(id)
      const startedAt = now().toISOString()
      await mkdir(runsDirectory, { recursive: true })
      const runDirectory = join(runsDirectory, id)
      try {
        await mkdir(runDirectory)
      } catch (error) {
        if (isAlreadyExists(error)) {
          throw new Error(`Test run "${id}" already exists`)
        }
        throw error
      }
      const run = persistedRunFor(id, startedAt, options)
      try {
        await run.append({
          type: 'run-started',
          run: {
            id,
            startedAt,
            ...(options.sourceRunId
              ? { sourceRunId: options.sourceRunId }
              : {}),
            ...(options.suite ? { suite: options.suite } : {}),
            ...(options.applicationRevision
              ? { applicationRevision: options.applicationRevision }
              : {}),
          },
        })
        return run
      } catch (error) {
        await rm(runDirectory, { recursive: true, force: true })
        throw error
      }
    },
    open: openRun,
    async list() {
      const manifests = await loadManifests()
      const storedIds = manifests.map((manifest) => manifest.id).sort()
      const indexedIds = (await Bun.file(indexPath).exists())
        ? withIndex(indexPath, listRunIds)
        : []
      if (
        !(await Bun.file(indexPath).exists()) ||
        indexVersion(indexPath) < indexSchemaVersion ||
        !sameStrings(storedIds, indexedIds)
      ) {
        await rebuild(manifests)
      }
      return withIndex(indexPath, listRuns)
    },
    rebuildIndex: rebuild,
    async applyRetention(policy: RetentionPolicy = {}) {
      const maxAgeMs = policy.maxAgeMs ?? defaultRetention.maxAgeMs
      const maxBytes = policy.maxBytes ?? defaultRetention.maxBytes
      const cutoff = now().getTime() - maxAgeMs
      const manifests = await loadManifests()
      const removed: string[] = []
      const retained: TestRunManifest[] = []

      for (const manifest of manifests) {
        if (Date.parse(manifest.startedAt) <= cutoff) {
          await removeRun(runsDirectory, indexPath, manifest.id)
          removed.push(manifest.id)
        } else {
          retained.push(manifest)
        }
      }

      retained.sort(byOldest)
      let total = await directorySize(runsDirectory)
      while (retained.length > 1 && total > maxBytes) {
        const oldest = retained.shift()
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
  metadata: CreateTestRunOptions,
  incompatibleSchema: (version: unknown) => never,
  serializeOperation: SerializeOperation,
): PersistedTestRun {
  const eventsPath = join(directory, 'events.ndjson')
  const manifestPath = join(directory, 'manifest.json')
  const artifactsDirectory = join(directory, 'artifacts')
  async function finalizedManifest(): Promise<TestRunManifest | undefined> {
    if (!(await Bun.file(manifestPath).exists())) return undefined
    const manifest = parseTestRunManifest(
      await Bun.file(manifestPath).json(),
      incompatibleSchema,
    )
    return manifest.finishedAt ? manifest : undefined
  }

  return {
    id,
    async append(event) {
      return serializeOperation(async () => {
        if (await finalizedManifest()) {
          throw new Error(`Test run "${id}" is finalized and cannot be changed`)
        }
        const current = await readEvents(eventsPath, incompatibleSchema)
        const versioned = {
          ...(await persistEventArtifacts(
            recordableRunEventPayloadData(eventPayload(event)),
            current,
            artifactCapture,
            artifactsDirectory,
          )),
          schemaVersion: testRunSchemaVersion,
          sequence: current.length + 1,
          occurredAt:
            'occurredAt' in event ? event.occurredAt : now().toISOString(),
        } as RunEvent
        await appendFile(eventsPath, `${JSON.stringify(versioned)}\n`)
        return versioned
      })
    },
    async events() {
      return serializeOperation(() =>
        readEvents(eventsPath, incompatibleSchema),
      )
    },
    async materialize(input) {
      return serializeOperation(async () => {
        const finalized = await finalizedManifest()
        if (finalized) return finalized
        const recorded = await readEvents(eventsPath, incompatibleSchema)
        const results = materializeTestResults(recorded)
        const manifest: TestRunManifest = {
          schemaVersion: testRunSchemaVersion,
          id,
          startedAt: startedAtFrom(recorded, startedAt),
          ...(input?.finished === false
            ? {}
            : { finishedAt: now().toISOString() }),
          ...(metadata.sourceRunId
            ? { sourceRunId: metadata.sourceRunId }
            : {}),
          ...(metadata.suite ? { suite: metadata.suite } : {}),
          ...(metadata.applicationRevision
            ? { applicationRevision: metadata.applicationRevision }
            : {}),
          state: aggregateTestResultState(results),
          results,
        }
        await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
        await onMaterialize(manifest)
        return manifest
      })
    },
  }
}

interface IndexedRun {
  id: string
  startedAt: string
  finishedAt: string | null
  sourceRunId: string | null
  suite: string | null
  executionTargetProfileIds: string
  specificationUris: string
  applicationRevision: string | null
  durationMs: number | null
  state: TestResultState
  resultCount: number
  executionModes: string
  cacheOutcomes: string
  inferenceCount: number | null
}

type IndexColumn = { name: string }
type IndexedSchemaVersion = Record<'user_version', number>

function openIndex(path: string): Database {
  const db = new Database(path, { create: true })
  db.run(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      source_run_id TEXT,
      suite TEXT,
      execution_target_profile_ids TEXT NOT NULL DEFAULT '[]',
      specification_uris TEXT NOT NULL DEFAULT '[]',
      application_revision TEXT,
      duration_ms INTEGER,
      state TEXT NOT NULL,
      result_count INTEGER NOT NULL,
      execution_modes TEXT NOT NULL DEFAULT '[]',
      cache_outcomes TEXT NOT NULL DEFAULT '[]',
      inference_count INTEGER
    )
  `)
  const columns = new Set(
    db
      .query('PRAGMA table_info(runs)')
      .all()
      .map((row) => (row as IndexColumn).name),
  )
  const additions = [
    ['source_run_id', 'TEXT'],
    ['suite', 'TEXT'],
    ['execution_target_profile_ids', "TEXT NOT NULL DEFAULT '[]'"],
    ['specification_uris', "TEXT NOT NULL DEFAULT '[]'"],
    ['application_revision', 'TEXT'],
    ['duration_ms', 'INTEGER'],
    ['execution_modes', "TEXT NOT NULL DEFAULT '[]'"],
    ['cache_outcomes', "TEXT NOT NULL DEFAULT '[]'"],
    ['inference_count', 'INTEGER'],
  ] as const
  for (const [name, definition] of additions) {
    if (!columns.has(name))
      db.run(`ALTER TABLE runs ADD COLUMN ${name} ${definition}`)
  }
  return db
}

function withIndex<Value>(path: string, use: (db: Database) => Value): Value {
  const db = openIndex(path)
  try {
    return use(db)
  } finally {
    db.close()
  }
}

function indexVersion(path: string): number {
  return withIndex(path, (db) => {
    const row = db.query('PRAGMA user_version').get() as IndexedSchemaVersion
    return row.user_version
  })
}

function startedAtFrom(events: readonly RunEvent[], fallback: string): string {
  const started = events.find((event) => event.type === 'run-started')
  return started?.type === 'run-started' ? started.run.startedAt : fallback
}

function byOldest(left: TestRunManifest, right: TestRunManifest): number {
  return (
    Date.parse(left.startedAt) - Date.parse(right.startedAt) ||
    left.id.localeCompare(right.id)
  )
}

export function materializeTestResults(
  events: readonly RunEvent[],
): TestResult[] {
  type Group = {
    order: number
    specification: TestResult['specification']
    scenario: TestResult['scenario']
    executionTargetProfile: TestResult['executionTargetProfile']
    attempts: Map<number, ScenarioAttempt>
  }
  const groups = new Map<string, Group>()
  for (const event of events) {
    if (event.type !== 'scenario-finished') continue
    const key = [
      event.scope.scenarioId,
      event.scope.examplesRowId ?? '',
      event.scope.executionTargetProfileId,
    ].join('\u0000')
    const group = groups.get(key) ?? {
      order: event.scheduleIndex ?? Number.MAX_SAFE_INTEGER,
      specification: event.specification,
      scenario: event.scenario,
      executionTargetProfile: event.executionTargetProfile,
      attempts: new Map<number, ScenarioAttempt>(),
    }
    group.order = Math.min(
      group.order,
      event.scheduleIndex ?? Number.MAX_SAFE_INTEGER,
    )
    if (group.attempts.has(event.attempt.attempt)) {
      throw new Error(
        `Duplicate Scenario attempt ${event.attempt.attempt} for ` +
          `Scenario "${event.scenario.name}" and execution target ` +
          `profile "${event.executionTargetProfile.id}"`,
      )
    }
    group.attempts.set(event.attempt.attempt, event.attempt)
    groups.set(key, group)
  }
  return [...groups.values()]
    .sort(
      (left, right) =>
        left.order - right.order ||
        (left.scenario.id ?? left.scenario.name).localeCompare(
          right.scenario.id ?? right.scenario.name,
        ),
    )
    .map((group) => {
      const attempts = [...group.attempts.values()].sort(
        (left, right) => left.attempt - right.attempt,
      )
      const first = attempts[0]
      const final = attempts.at(-1)
      if (!first || !final) {
        throw new Error('A Test result requires at least one Scenario attempt')
      }
      return {
        schemaVersion: testRunSchemaVersion,
        specification: group.specification,
        scenario: group.scenario,
        executionTargetProfile: group.executionTargetProfile,
        state: final.state,
        startedAt: first.startedAt,
        finishedAt: final.finishedAt,
        durationMs: Math.max(
          0,
          Date.parse(final.finishedAt) - Date.parse(first.startedAt),
        ),
        attempts,
        ...(attempts.length > 1 && final.state === 'passed'
          ? { flaky: true }
          : {}),
      }
    })
}

function upsertRun(db: Database, manifest: TestRunManifest): void {
  const executionTargetProfileIds = [
    ...new Set(
      manifest.results.map((result) => result.executionTargetProfile.id),
    ),
  ].sort()
  const specificationUris = [
    ...new Set(manifest.results.map((result) => result.specification.uri)),
  ].sort()
  const durationMs = manifest.finishedAt
    ? Date.parse(manifest.finishedAt) - Date.parse(manifest.startedAt)
    : undefined
  const executionModes = [
    ...new Set(
      manifest.results.flatMap((result) =>
        result.attempts.flatMap((attempt) =>
          attempt.executionMode ? [attempt.executionMode] : [],
        ),
      ),
    ),
  ].sort()
  const cacheOutcomes = [
    ...new Set(
      manifest.results.flatMap((result) =>
        result.attempts.flatMap((attempt) =>
          attempt.cacheOutcome ? [attempt.cacheOutcome] : [],
        ),
      ),
    ),
  ].sort()
  const inferenceCounts = manifest.results.flatMap((result) => {
    const inferenceCount = finalScenarioAttempt(result).inferenceCount
    return inferenceCount === undefined ? [] : [inferenceCount]
  })
  const inferenceCount =
    inferenceCounts.length > 0
      ? inferenceCounts.reduce((total, count) => total + count, 0)
      : undefined
  db.run(
    `INSERT INTO runs (
       id, started_at, finished_at, source_run_id, suite,
       execution_target_profile_ids, specification_uris,
       application_revision, duration_ms,
       state, result_count, execution_modes, cache_outcomes, inference_count
     )
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       started_at = excluded.started_at,
       finished_at = excluded.finished_at,
       source_run_id = excluded.source_run_id,
       suite = excluded.suite,
       execution_target_profile_ids = excluded.execution_target_profile_ids,
       specification_uris = excluded.specification_uris,
       application_revision = excluded.application_revision,
       duration_ms = excluded.duration_ms,
       state = excluded.state,
       result_count = excluded.result_count,
       execution_modes = excluded.execution_modes,
       cache_outcomes = excluded.cache_outcomes,
       inference_count = excluded.inference_count`,
    [
      manifest.id,
      manifest.startedAt,
      manifest.finishedAt ?? null,
      manifest.sourceRunId ?? null,
      manifest.suite ?? null,
      JSON.stringify(executionTargetProfileIds),
      JSON.stringify(specificationUris),
      manifest.applicationRevision ?? null,
      durationMs ?? null,
      manifest.state,
      manifest.results.length,
      JSON.stringify(executionModes),
      JSON.stringify(cacheOutcomes),
      inferenceCount ?? null,
    ],
  )
}

function listRuns(db: Database): TestRunSummary[] {
  return db
    .query(
      `SELECT id, started_at AS startedAt, finished_at AS finishedAt,
        source_run_id AS sourceRunId, suite,
        execution_target_profile_ids AS executionTargetProfileIds,
        specification_uris AS specificationUris,
        application_revision AS applicationRevision, duration_ms AS durationMs,
        state, result_count AS resultCount,
        execution_modes AS executionModes,
        cache_outcomes AS cacheOutcomes,
        inference_count AS inferenceCount
       FROM runs ORDER BY id`,
    )
    .all()
    .map((row) => {
      const indexed = row as IndexedRun
      const executionModes = JSON.parse(
        indexed.executionModes,
      ) as ExecutionMode[]
      const cacheOutcomes = JSON.parse(indexed.cacheOutcomes) as CacheOutcome[]
      return {
        id: indexed.id,
        startedAt: indexed.startedAt,
        ...(indexed.finishedAt ? { finishedAt: indexed.finishedAt } : {}),
        ...(indexed.sourceRunId ? { sourceRunId: indexed.sourceRunId } : {}),
        ...(indexed.suite ? { suite: indexed.suite } : {}),
        executionTargetProfileIds: JSON.parse(
          indexed.executionTargetProfileIds,
        ) as string[],
        specificationUris: JSON.parse(indexed.specificationUris) as string[],
        ...(indexed.applicationRevision
          ? { applicationRevision: indexed.applicationRevision }
          : {}),
        ...(indexed.durationMs !== null
          ? { durationMs: indexed.durationMs }
          : {}),
        state: indexed.state,
        resultCount: indexed.resultCount,
        executionModes: executionModes.length > 0 ? executionModes : undefined,
        cacheOutcomes: cacheOutcomes.length > 0 ? cacheOutcomes : undefined,
        inferenceCount: indexed.inferenceCount ?? undefined,
      }
    })
}

function listRunIds(db: Database): string[] {
  return db
    .query('SELECT id FROM runs ORDER BY id')
    .all()
    .map((row) => (row as Pick<IndexedRun, 'id'>).id)
}

function sameStrings(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  )
}

export function aggregateTestResultState(
  results: readonly TestResult[],
): TestResultState {
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
      occurredAt: _occurredAt,
      ...payload
    } = event
    return payload
  }
  return event
}

async function readEvents(
  path: string,
  incompatibleSchema: (version: unknown) => never,
): Promise<RunEvent[]> {
  if (!(await Bun.file(path).exists())) return []
  const source = await Bun.file(path).text()
  return source
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => parseRunEvent(JSON.parse(line), incompatibleSchema))
}

async function persistEventArtifacts(
  event: RunEventPayload,
  current: readonly RunEvent[],
  policy: ArtifactCapturePolicy,
  artifactsDirectory: string,
): Promise<RunEventPayload> {
  if (event.type === 'scenario-finished') {
    return {
      ...event,
      attempt: await persistAttemptArtifacts(
        event.attempt,
        event.scope,
        current,
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
        artifactStepName(event.scope, event.result.index),
      ),
    }
  }
  return event
}

async function persistAttemptArtifacts(
  attempt: ScenarioAttempt,
  scope: Extract<RunEventPayload, { type: 'scenario-finished' }>['scope'],
  current: readonly RunEvent[],
  policy: ArtifactCapturePolicy,
  artifactsDirectory: string,
): Promise<ScenarioAttempt> {
  if (!shouldCapture(policy, attempt.state)) {
    return withoutAttemptArtifacts(attempt)
  }
  const steps = await Promise.all(
    attempt.steps.map(async (step) => {
      const persisted = current.findLast(
        (event) =>
          event.type === 'step-finished' &&
          sameScope(event.scope, { ...scope, stepIndex: step.index }),
      )
      if (persisted?.type === 'step-finished' && persisted.result.artifacts) {
        return { ...step, artifacts: persisted.result.artifacts }
      }
      return copyStepArtifacts(
        step,
        artifactsDirectory,
        artifactStepName(scope, step.index),
      )
    }),
  )
  return { ...attempt, steps }
}

function sameScope(
  left: Extract<RunEventPayload, { type: 'step-finished' }>['scope'],
  right: Extract<RunEventPayload, { type: 'step-finished' }>['scope'],
): boolean {
  return (
    left.scenarioId === right.scenarioId &&
    left.examplesRowId === right.examplesRowId &&
    left.executionTargetProfileId === right.executionTargetProfileId &&
    left.attempt === right.attempt &&
    left.stepIndex === right.stepIndex
  )
}

function artifactStepName(
  scope: Extract<RunEventPayload, { type: 'step-finished' }>['scope'],
  stepIndex: number,
): string {
  return join(
    slug(scope.scenarioId),
    ...(scope.examplesRowId
      ? [`examples-row-${slug(scope.examplesRowId)}`]
      : []),
    slug(scope.executionTargetProfileId),
    `attempt-${scope.attempt}`,
    `step-${stepIndex + 1}`,
  )
}

async function persistStepArtifacts(
  step: TestStepResult,
  policy: ArtifactCapturePolicy,
  artifactsDirectory: string,
  name: string,
): Promise<TestStepResult> {
  if (!step.artifacts?.length) return step
  if (!shouldCapture(policy, step.state)) return withoutArtifacts(step)
  return copyStepArtifacts(step, artifactsDirectory, name)
}

function withoutArtifacts(step: TestStepResult): TestStepResult {
  if (!step.artifacts) return step
  const { artifacts: _artifacts, ...rest } = step
  return rest
}

function withoutAttemptArtifacts(attempt: ScenarioAttempt): ScenarioAttempt {
  const kinds = new Set(
    attempt.steps.flatMap((step) =>
      (step.artifacts ?? []).map((artifact) => artifact.kind),
    ),
  )
  return {
    ...attempt,
    steps: attempt.steps.map(withoutArtifacts),
    evidenceAvailability: attempt.evidenceAvailability.map((availability) => {
      const wasCaptured =
        availability.kind !== 'diagnostics' && kinds.has(availability.kind)
      return wasCaptured && availability.state === 'available'
        ? { ...availability, state: 'not-retained' }
        : availability
    }),
  }
}

async function copyStepArtifacts(
  step: TestStepResult,
  artifactsDirectory: string,
  name: string,
): Promise<TestStepResult> {
  if (!step.artifacts?.length) return step
  await mkdir(artifactsDirectory, { recursive: true })
  const artifacts = await Promise.all(
    step.artifacts.map(async (artifact, index) => {
      const extension = extname(artifact.path) || '.bin'
      const filename =
        index === 0
          ? `${slug(name)}${extension}`
          : `${slug(name)}-${index + 1}${extension}`
      const path = join(artifactsDirectory, filename)
      if (artifact.path !== path) await copyFile(artifact.path, path)
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
  return state === 'failed' || state === 'infrastructure-error'
}

async function removeRun(
  runsDirectory: string,
  indexPath: string,
  id: string,
): Promise<void> {
  await rm(join(runsDirectory, id), { recursive: true, force: true })
  if (!(await Bun.file(indexPath).exists())) return
  withIndex(indexPath, (db) => db.run('DELETE FROM runs WHERE id = ?', [id]))
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

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && (error as NodeError).code === 'EEXIST'
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
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

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
