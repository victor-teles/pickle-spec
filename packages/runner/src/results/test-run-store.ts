import { Database } from 'bun:sqlite'
import {
  appendFile,
  copyFile,
  mkdir,
  rename,
  rm,
  rmdir,
  stat,
} from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import type {
  EvidenceKind,
  ExecutionMode,
  RunEvent,
  RunEventPayload,
  ScenarioAttempt,
  TestArtifact,
  TestResult,
  TestResultState,
  TestStepResult,
} from '../execution/run-scenario'
import {
  finalScenarioAttempt,
  testRunSchemaVersion,
} from '../execution/run-scenario'
import type { CacheOutcome } from '../execution-cache/execution-cache'
import { resolveLocalProjectStorage } from '../storage/local-project-storage'
import { recordableRunEventPayloadData } from './public-results'
import { parseRunEvent, parseTestRunManifest } from './test-run-schema'

export type EvidencePersistencePolicy = 'off' | 'on-failure' | 'always'
export type ArtifactCapturePolicy = EvidencePersistencePolicy

export interface TestRunStoreOptions {
  root: string
  pickleHome?: string
  createId?: () => string
  now?: () => Date
  evidencePersistence?: EvidencePersistencePolicy
  evidencePersistenceByProfile?: Readonly<
    Record<string, EvidencePersistencePolicy>
  >
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
  evidencePersistence?: EvidencePersistencePolicy
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
  beforeBytes: number
  afterBytes: number
}

export interface TestRunStorageInspection {
  totalBytes: number
  warningThresholdBytes: number
  warning: boolean
  pinnedRunIds: string[]
}

export interface TestRunStore {
  create(options?: CreateTestRunOptions): Promise<PersistedTestRun>
  open(id: string): Promise<PersistedTestRun>
  list(): Promise<TestRunSummary[]>
  rebuildIndex(): Promise<void>
  inspectStorage(): Promise<TestRunStorageInspection>
  pin(id: string): Promise<void>
  unpin(id: string): Promise<void>
  applyRetention(policy?: RetentionPolicy): Promise<RetentionResult>
}

const indexSchemaVersion = 5

export const defaultRetention: Readonly<RetentionPolicy> = {}
export const defaultRunStorageWarningBytes = 5 * 1024 * 1024 * 1024

const stateRank: Record<TestResultState, number> = {
  skipped: 0,
  passed: 1,
  cancelled: 2,
  failed: 3,
  'infrastructure-error': 4,
}

type NodeError = Error & { code?: string }
type RunPinsFile = { schemaVersion: 1; runIds: string[] }
type SerializeOperation = <Value>(
  operation: () => Promise<Value>,
) => Promise<Value>

export function openTestRunStore(options: TestRunStoreOptions): TestRunStore {
  const createId = options.createId ?? (() => crypto.randomUUID())
  const now = options.now ?? (() => new Date())
  const evidencePersistence =
    options.evidencePersistence ?? options.artifactCapture ?? 'on-failure'
  const evidencePersistenceByProfile =
    options.evidencePersistenceByProfile ?? {}
  const storage = resolveLocalProjectStorage(options.root, options.pickleHome)
  const projectDirectory = storage.projectDirectory
  const runsDirectory = storage.runsDirectory
  const indexPath = storage.runIndexPath
  const runPinsPath = storage.runPinsPath
  const incompatibleSchema = (version: unknown): never => {
    throw new Error(
      `Test run storage schema version ${String(version)} is unsupported. ` +
        `Pickle did not modify it. Remove the runs directory manually and retry: ${runsDirectory}`,
    )
  }
  const runOperationQueues = new Map<string, Promise<void>>()
  let managementOperationQueue = Promise.resolve()

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

  function serializeManagementOperation<Value>(
    operation: () => Promise<Value>,
  ): Promise<Value> {
    const result = managementOperationQueue.then(operation)
    managementOperationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  async function readPinnedRunIds(): Promise<Set<string>> {
    if (!(await Bun.file(runPinsPath).exists())) return new Set()
    const source: unknown = await Bun.file(runPinsPath).json()
    if (!isRunPinsFile(source)) {
      throw new Error('Pinned Test run metadata is invalid')
    }
    source.runIds.forEach(validateRunId)
    return new Set(source.runIds)
  }

  async function writePinnedRunIds(runIds: ReadonlySet<string>): Promise<void> {
    await mkdir(projectDirectory, { recursive: true })
    const temporaryPath = `${runPinsPath}.${crypto.randomUUID()}.tmp`
    const contents: RunPinsFile = {
      schemaVersion: 1,
      runIds: [...runIds].sort(),
    }
    try {
      await Bun.write(temporaryPath, `${JSON.stringify(contents, null, 2)}\n`)
      await rename(temporaryPath, runPinsPath)
    } finally {
      await rm(temporaryPath, { force: true })
    }
  }

  async function updatePin(id: string, pinned: boolean): Promise<void> {
    validateRunId(id)
    await serializeManagementOperation(async () => {
      if (
        !(await Bun.file(join(runsDirectory, id, 'events.ndjson')).exists())
      ) {
        throw new Error(`Test run "${id}" was not found`)
      }
      const runIds = await readPinnedRunIds()
      if (pinned) runIds.add(id)
      else runIds.delete(id)
      await writePinnedRunIds(runIds)
    })
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
      (executionTargetProfileId) =>
        metadata.evidencePersistence ??
        evidencePersistenceByProfile[executionTargetProfileId] ??
        evidencePersistence,
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
    const runEvidencePersistence =
      started?.type === 'run-started'
        ? started.run.evidencePersistence
        : undefined
    return persistedRunFor(id, startedAtFrom(events, now().toISOString()), {
      sourceRunId,
      suite,
      applicationRevision,
      evidencePersistence: runEvidencePersistence,
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

  async function removeExpiredRuns(
    eligible: readonly TestRunManifest[],
    cutoff: number | undefined,
  ): Promise<string[]> {
    const removed: string[] = []
    if (cutoff === undefined) return removed
    for (const manifest of eligible) {
      if (!manifest.finishedAt || Date.parse(manifest.finishedAt) > cutoff)
        continue
      await removeRun(runsDirectory, indexPath, manifest.id)
      removed.push(manifest.id)
    }
    return removed
  }

  async function removeRunsOverLimit(
    eligible: readonly TestRunManifest[],
    maxBytes: number | undefined,
    removed: string[],
  ): Promise<number> {
    let total = await directorySize(runsDirectory)
    if (maxBytes === undefined) return total

    const removedRunIds = new Set(removed)
    const remaining = eligible.filter(
      (manifest) => !removedRunIds.has(manifest.id),
    )
    while (total > maxBytes) {
      const oldest = remaining.shift()
      if (!oldest) break
      await removeRun(runsDirectory, indexPath, oldest.id)
      removed.push(oldest.id)
      total = await directorySize(runsDirectory)
    }
    return total
  }

  async function applyRetentionPolicy(
    policy: RetentionPolicy,
  ): Promise<RetentionResult> {
    const beforeBytes = await directorySize(runsDirectory)
    if (policy.maxAgeMs === undefined && policy.maxBytes === undefined) {
      return { removed: [], beforeBytes, afterBytes: beforeBytes }
    }

    const cutoff =
      policy.maxAgeMs === undefined
        ? undefined
        : now().getTime() - policy.maxAgeMs
    const pinnedRunIds = await readPinnedRunIds()
    const eligible = (await loadManifests())
      .filter(
        (manifest) => manifest.finishedAt && !pinnedRunIds.has(manifest.id),
      )
      .sort(byOldest)
    const removed = await removeExpiredRuns(eligible, cutoff)
    const afterBytes = await removeRunsOverLimit(
      eligible,
      policy.maxBytes,
      removed,
    )
    return { removed, beforeBytes, afterBytes }
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
            ...(options.evidencePersistence
              ? { evidencePersistence: options.evidencePersistence }
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
    async inspectStorage() {
      const totalBytes = await directorySize(runsDirectory)
      const pinnedRunIds = [...(await readPinnedRunIds())].sort()
      return {
        totalBytes,
        warningThresholdBytes: defaultRunStorageWarningBytes,
        warning: totalBytes >= defaultRunStorageWarningBytes,
        pinnedRunIds,
      }
    },
    pin(id) {
      return updatePin(id, true)
    },
    unpin(id) {
      return updatePin(id, false)
    },
    applyRetention(policy: RetentionPolicy = {}) {
      return serializeManagementOperation(() => applyRetentionPolicy(policy))
    },
  }
}

function persistedTestRun(
  id: string,
  directory: string,
  startedAt: string,
  now: () => Date,
  evidencePersistenceFor: (
    executionTargetProfileId: string,
  ) => EvidencePersistencePolicy,
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
        const recordable = recordableRunEventPayloadData(eventPayload(event))
        const policy =
          'scope' in recordable
            ? evidencePersistenceFor(recordable.scope.executionTargetProfileId)
            : evidencePersistenceFor('')
        const envelope = {
          schemaVersion: testRunSchemaVersion,
          sequence: current.length + 1,
          occurredAt:
            'occurredAt' in event ? event.occurredAt : now().toISOString(),
        } as const
        const persisted = await persistEventArtifacts(
          recordable,
          current,
          policy,
          artifactsDirectory,
        )
        const versioned = {
          ...persisted.event,
          ...envelope,
        } as RunEvent
        try {
          await appendFile(eventsPath, `${JSON.stringify(versioned)}\n`)
        } catch (error) {
          await Promise.all(
            persisted.publishedPaths.map((path) => rm(path, { force: true })),
          )
          throw error
        }
        return !shouldPersistEventEvidence(recordable, policy)
          ? ({ ...recordable, ...envelope } as RunEvent)
          : versioned
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
  policy: EvidencePersistencePolicy,
  artifactsDirectory: string,
): Promise<PersistedEventEvidence> {
  if (event.type === 'scenario-finished') {
    const persisted = await persistAttemptArtifacts(
      event.attempt,
      event.scope,
      current,
      policy,
      artifactsDirectory,
    )
    return {
      event: { ...event, attempt: persisted.attempt },
      publishedPaths: persisted.publishedPaths,
    }
  }
  if (event.type === 'step-finished') {
    const persisted = await persistStepArtifacts(
      event.result,
      policy,
      artifactsDirectory,
      artifactStepName(event.scope, event.result.index),
    )
    return {
      event: { ...event, result: persisted.step },
      publishedPaths: persisted.publishedPaths,
    }
  }
  return { event, publishedPaths: [] }
}

type EvidenceCaptureFailure = {
  kind: EvidenceKind
  message: string
}

type PersistedEventEvidence = {
  event: RunEventPayload
  publishedPaths: string[]
}

type PersistedAttemptEvidence = {
  attempt: ScenarioAttempt
  publishedPaths: string[]
}

type PersistedStepEvidence = {
  step: TestStepResult
  publishedPaths: string[]
  captureFailures: EvidenceCaptureFailure[]
}

async function persistAttemptArtifacts(
  attempt: ScenarioAttempt,
  scope: Extract<RunEventPayload, { type: 'scenario-finished' }>['scope'],
  current: readonly RunEvent[],
  policy: EvidencePersistencePolicy,
  artifactsDirectory: string,
): Promise<PersistedAttemptEvidence> {
  if (!shouldPersistEvidence(policy, attempt.state)) {
    return { attempt: withoutAttemptEvidence(attempt), publishedPaths: [] }
  }
  const steps = await Promise.all(
    attempt.steps.map(async (step) => {
      const persisted = current.findLast(
        (event) =>
          event.type === 'step-finished' &&
          sameScope(event.scope, { ...scope, stepIndex: step.index }),
      )
      if (persisted?.type === 'step-finished' && persisted.result.artifacts) {
        if (persisted.result.artifacts.length === step.artifacts?.length) {
          return {
            step: { ...step, artifacts: persisted.result.artifacts },
            publishedPaths: [],
            captureFailures: [],
          }
        }
        const artifacts = step.artifacts?.map((artifact, index) => {
          const path = artifactDestination(
            artifact,
            index,
            artifactsDirectory,
            artifactStepName(scope, step.index),
          )
          return (
            persisted.result.artifacts?.find(
              (committed) => committed.path === path,
            ) ?? artifact
          )
        })
        return copyStepArtifacts(
          { ...step, artifacts },
          artifactsDirectory,
          artifactStepName(scope, step.index),
        )
      }
      return copyStepArtifacts(
        step,
        artifactsDirectory,
        artifactStepName(scope, step.index),
      )
    }),
  )
  const captureFailures = steps.flatMap((step) => step.captureFailures)
  return {
    attempt: {
      ...attempt,
      steps: steps.map((step) => step.step),
      evidenceAvailability: attempt.evidenceAvailability.map((availability) => {
        const failures = captureFailures.filter(
          (failure) => failure.kind === availability.kind,
        )
        return failures.length > 0
          ? {
              ...availability,
              state: 'capture-failed' as const,
              message: failures.map((failure) => failure.message).join('; '),
            }
          : availability
      }),
    },
    publishedPaths: steps.flatMap((step) => step.publishedPaths),
  }
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
  policy: EvidencePersistencePolicy,
  artifactsDirectory: string,
  name: string,
): Promise<PersistedStepEvidence> {
  if (!shouldPersistEvidence(policy, step.state)) {
    return {
      step: withoutStepEvidence(step),
      publishedPaths: [],
      captureFailures: [],
    }
  }
  if (!step.artifacts?.length) {
    return { step, publishedPaths: [], captureFailures: [] }
  }
  return copyStepArtifacts(step, artifactsDirectory, name)
}

function withoutStepEvidence(step: TestStepResult): TestStepResult {
  const {
    artifacts: _artifacts,
    diagnostics: _diagnostics,
    trace: _trace,
    ...rest
  } = step
  return rest
}

function withoutAttemptEvidence(attempt: ScenarioAttempt): ScenarioAttempt {
  const kinds = new Set(
    attempt.steps.flatMap((step) => [
      ...(step.artifacts ?? []).map((artifact) => artifact.kind),
      ...(step.diagnostics?.length ? ['diagnostics' as const] : []),
      ...(step.trace?.length ? ['trace' as const] : []),
    ]),
  )
  if (attempt.diagnostics?.length) kinds.add('diagnostics')
  const { diagnostics: _diagnostics, ...attemptWithoutDiagnostics } = attempt
  return {
    ...attemptWithoutDiagnostics,
    steps: attempt.steps.map(withoutStepEvidence),
    evidenceAvailability: attempt.evidenceAvailability.map((availability) => {
      const wasCaptured = kinds.has(availability.kind)
      return wasCaptured && availability.state === 'available'
        ? { ...availability, state: 'not-retained' }
        : availability
    }),
    applicationOutputAvailability: attempt.applicationOutputAvailability?.map(
      (availability) =>
        availability.state === 'available'
          ? { ...availability, state: 'not-retained' as const }
          : availability,
    ),
  }
}

async function copyStepArtifacts(
  step: TestStepResult,
  artifactsDirectory: string,
  name: string,
): Promise<PersistedStepEvidence> {
  if (!step.artifacts?.length) {
    return { step, publishedPaths: [], captureFailures: [] }
  }
  const stagingRoot = join(dirname(artifactsDirectory), '.evidence-staging')
  const stagingDirectory = join(stagingRoot, crypto.randomUUID())
  try {
    await Promise.all([
      mkdir(artifactsDirectory, { recursive: true }),
      mkdir(stagingDirectory, { recursive: true }),
    ])
  } catch (error) {
    await rm(stagingDirectory, { recursive: true, force: true })
    await rmdir(stagingRoot).catch(() => undefined)
    return captureFailedStep(step, error)
  }
  const publishedPaths: string[] = []
  const captureFailures: EvidenceCaptureFailure[] = []
  const artifacts: TestArtifact[] = []
  try {
    for (const [index, artifact] of step.artifacts.entries()) {
      const path = artifactDestination(
        artifact,
        index,
        artifactsDirectory,
        name,
      )
      const filename = basename(path)
      if (artifact.path === path) {
        artifacts.push(artifact)
        continue
      }
      const stagedPath = join(stagingDirectory, filename)
      try {
        await copyFile(artifact.path, stagedPath)
        if (await pathExists(path)) {
          throw new Error(`Test artifact destination already exists: ${path}`)
        }
        await rename(stagedPath, path)
        publishedPaths.push(path)
        artifacts.push({ ...artifact, path })
      } catch (error) {
        captureFailures.push({
          kind: artifact.kind,
          message: `${artifact.path}: ${errorMessage(error)}`,
        })
      }
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true })
    await rmdir(stagingRoot).catch(() => undefined)
  }
  return {
    step: {
      ...step,
      artifacts: artifacts.length > 0 ? artifacts : undefined,
    },
    publishedPaths,
    captureFailures,
  }
}

function artifactDestination(
  artifact: TestArtifact,
  index: number,
  artifactsDirectory: string,
  name: string,
): string {
  const extension = extname(artifact.path) || '.bin'
  const filename =
    index === 0
      ? `${slug(name)}${extension}`
      : `${slug(name)}-${index + 1}${extension}`
  return join(artifactsDirectory, filename)
}

function captureFailedStep(
  step: TestStepResult,
  error: unknown,
): PersistedStepEvidence {
  const { artifacts: _artifacts, ...stepWithoutArtifacts } = step
  return {
    step: stepWithoutArtifacts,
    publishedPaths: [],
    captureFailures: (step.artifacts ?? []).map((artifact) => ({
      kind: artifact.kind,
      message: `${artifact.path}: ${errorMessage(error)}`,
    })),
  }
}

function shouldPersistEvidence(
  policy: EvidencePersistencePolicy,
  state: TestResultState,
): boolean {
  if (policy === 'always') return true
  if (policy === 'off') return false
  return state === 'failed' || state === 'infrastructure-error'
}

function shouldPersistEventEvidence(
  event: RunEventPayload,
  policy: EvidencePersistencePolicy,
): boolean {
  if (event.type === 'step-finished') {
    return shouldPersistEvidence(policy, event.result.state)
  }
  if (event.type === 'scenario-finished') {
    return shouldPersistEvidence(policy, event.attempt.state)
  }
  return true
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

function isRunPinsFile(value: unknown): value is RunPinsFile {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<RunPinsFile>
  return (
    candidate.schemaVersion === 1 &&
    Array.isArray(candidate.runIds) &&
    candidate.runIds.every((id: unknown) => typeof id === 'string')
  )
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && (error as NodeError).code === 'EEXIST'
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
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

export function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}
