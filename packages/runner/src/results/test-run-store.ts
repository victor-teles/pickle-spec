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
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  sep as pathSeparator,
  relative,
} from 'node:path'
import type {
  EvidenceKind,
  ExecutionMode,
  RunEvent,
  RunEventPayload,
  RunEventScope,
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

function runStartedEvent(
  id: string,
  startedAt: string,
  options: CreateTestRunOptions,
): RunEventPayload {
  return {
    type: 'run-started',
    run: {
      id,
      startedAt,
      ...(options.sourceRunId ? { sourceRunId: options.sourceRunId } : {}),
      ...(options.suite ? { suite: options.suite } : {}),
      ...(options.applicationRevision
        ? { applicationRevision: options.applicationRevision }
        : {}),
      ...(options.evidencePersistence
        ? { evidencePersistence: options.evidencePersistence }
        : {}),
    },
  }
}

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

class LocalTestRunStore implements TestRunStore {
  private readonly createId: () => string
  private readonly now: () => Date
  private readonly evidencePersistence: EvidencePersistencePolicy
  private readonly evidencePersistenceByProfile: Readonly<
    Record<string, EvidencePersistencePolicy>
  >
  private readonly projectDirectory: string
  private readonly runsDirectory: string
  private readonly indexPath: string
  private readonly runPinsPath: string
  private readonly runOperationQueues = new Map<string, Promise<void>>()
  private managementOperationQueue = Promise.resolve()

  constructor(options: TestRunStoreOptions) {
    this.createId = options.createId ?? (() => crypto.randomUUID())
    this.now = options.now ?? (() => new Date())
    this.evidencePersistence =
      options.evidencePersistence ?? options.artifactCapture ?? 'on-failure'
    this.evidencePersistenceByProfile =
      options.evidencePersistenceByProfile ?? {}
    const storage = resolveLocalProjectStorage(options.root, options.pickleHome)
    this.projectDirectory = storage.projectDirectory
    this.runsDirectory = storage.runsDirectory
    this.indexPath = storage.runIndexPath
    this.runPinsPath = storage.runPinsPath
  }

  private incompatibleSchema = (version: unknown): never => {
    throw new Error(
      `Test run storage schema version ${String(version)} is unsupported. ` +
        `Pickle did not modify it. Remove the runs directory manually and retry: ${this.runsDirectory}`,
    )
  }

  private serializeRunOperation<Value>(
    id: string,
    operation: () => Promise<Value>,
  ): Promise<Value> {
    const pending = this.runOperationQueues.get(id) ?? Promise.resolve()
    const result = pending.then(operation)
    const tail = result.then(
      () => undefined,
      () => undefined,
    )
    this.runOperationQueues.set(id, tail)
    void tail.then(() => {
      if (this.runOperationQueues.get(id) === tail)
        this.runOperationQueues.delete(id)
    })
    return result
  }

  private serializeManagementOperation<Value>(
    operation: () => Promise<Value>,
  ): Promise<Value> {
    const result = this.managementOperationQueue.then(operation)
    this.managementOperationQueue = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  private async readPinnedRunIds(): Promise<Set<string>> {
    if (!(await Bun.file(this.runPinsPath).exists())) return new Set()
    const source: unknown = await Bun.file(this.runPinsPath).json()
    if (!isRunPinsFile(source)) {
      throw new Error('Pinned Test run metadata is invalid')
    }
    source.runIds.forEach(validateRunId)
    return new Set(source.runIds)
  }

  private async writePinnedRunIds(runIds: ReadonlySet<string>): Promise<void> {
    await mkdir(this.projectDirectory, { recursive: true })
    const temporaryPath = `${this.runPinsPath}.${crypto.randomUUID()}.tmp`
    const contents: RunPinsFile = {
      schemaVersion: 1,
      runIds: [...runIds].sort(),
    }
    try {
      await Bun.write(temporaryPath, `${JSON.stringify(contents, null, 2)}\n`)
      await rename(temporaryPath, this.runPinsPath)
    } finally {
      await rm(temporaryPath, { force: true })
    }
  }

  private async updatePin(id: string, pinned: boolean): Promise<void> {
    validateRunId(id)
    await this.serializeManagementOperation(async () => {
      const eventsPath = join(this.runsDirectory, id, 'events.ndjson')
      if (!(await Bun.file(eventsPath).exists())) {
        throw new Error(`Test run "${id}" was not found`)
      }
      const runIds = await this.readPinnedRunIds()
      if (pinned) runIds.add(id)
      else runIds.delete(id)
      await this.writePinnedRunIds(runIds)
    })
  }

  private async upsertManifest(manifest: TestRunManifest): Promise<void> {
    await mkdir(this.projectDirectory, { recursive: true })
    withIndex(this.indexPath, (db) => upsertRun(db, manifest))
  }

  private persistedRunFor(
    id: string,
    startedAt: string,
    metadata: CreateTestRunOptions = {},
  ): PersistedTestRun {
    return persistedTestRun(
      id,
      join(this.runsDirectory, id),
      startedAt,
      this.now,
      (profileId) =>
        metadata.evidencePersistence ??
        this.evidencePersistenceByProfile[profileId] ??
        this.evidencePersistence,
      (manifest) => this.upsertManifest(manifest),
      metadata,
      this.incompatibleSchema,
      (operation) => this.serializeRunOperation(id, operation),
    )
  }

  async open(id: string): Promise<PersistedTestRun> {
    validateRunId(id)
    const events = await this.serializeRunOperation(id, () =>
      readEvents(
        join(this.runsDirectory, id, 'events.ndjson'),
        this.incompatibleSchema,
      ),
    )
    const started = events.find((event) => event.type === 'run-started')
    const metadata =
      started?.type === 'run-started'
        ? {
            sourceRunId: started.run.sourceRunId,
            suite: started.run.suite,
            applicationRevision: started.run.applicationRevision,
            evidencePersistence: started.run.evidencePersistence,
          }
        : {}
    return this.persistedRunFor(
      id,
      startedAtFrom(events, this.now().toISOString()),
      metadata,
    )
  }

  private async manifestFor(id: string): Promise<TestRunManifest> {
    const manifestPath = join(this.runsDirectory, id, 'manifest.json')
    if (await Bun.file(manifestPath).exists()) {
      return parseTestRunManifest(
        await Bun.file(manifestPath).json(),
        this.incompatibleSchema,
      )
    }
    return (await this.open(id)).materialize({ finished: false })
  }

  private async loadManifests(): Promise<TestRunManifest[]> {
    const manifests: TestRunManifest[] = []
    if (!(await pathExists(this.runsDirectory))) return manifests
    const files = new Bun.Glob('*/events.ndjson').scan({
      cwd: this.runsDirectory,
      onlyFiles: true,
    })
    for await (const relativePath of files) {
      const id = dirname(relativePath)
      validateRunId(id)
      const manifest = await this.manifestFor(id)
      if (manifest.id !== id) {
        throw new Error(
          `Test run manifest identifier "${manifest.id}" does not match "${id}"`,
        )
      }
      manifests.push(manifest)
    }
    return manifests
  }

  private async rebuild(providedManifests?: TestRunManifest[]): Promise<void> {
    const manifests = providedManifests ?? (await this.loadManifests())
    await mkdir(this.projectDirectory, { recursive: true })
    withIndex(this.indexPath, (db) => {
      db.run('DELETE FROM runs')
      for (const manifest of manifests) upsertRun(db, manifest)
      db.run(`PRAGMA user_version = ${indexSchemaVersion}`)
    })
  }

  private async removeExpiredRuns(
    eligible: readonly TestRunManifest[],
    cutoff: number | undefined,
  ): Promise<string[]> {
    const removed: string[] = []
    if (cutoff === undefined) return removed
    for (const manifest of eligible) {
      if (!manifest.finishedAt || Date.parse(manifest.finishedAt) > cutoff)
        continue
      await removeRun(this.runsDirectory, this.indexPath, manifest.id)
      removed.push(manifest.id)
    }
    return removed
  }

  private async removeRunsOverLimit(
    eligible: readonly TestRunManifest[],
    maxBytes: number | undefined,
    removed: string[],
  ): Promise<number> {
    let total = await directorySize(this.runsDirectory)
    if (maxBytes === undefined) return total
    const removedRunIds = new Set(removed)
    const remaining = eligible.filter(
      (manifest) => !removedRunIds.has(manifest.id),
    )
    while (total > maxBytes) {
      const oldest = remaining.shift()
      if (!oldest) break
      await removeRun(this.runsDirectory, this.indexPath, oldest.id)
      removed.push(oldest.id)
      total = await directorySize(this.runsDirectory)
    }
    return total
  }

  private async applyRetentionPolicy(
    policy: RetentionPolicy,
  ): Promise<RetentionResult> {
    const beforeBytes = await directorySize(this.runsDirectory)
    if (policy.maxAgeMs === undefined && policy.maxBytes === undefined) {
      return { removed: [], beforeBytes, afterBytes: beforeBytes }
    }
    const cutoff =
      policy.maxAgeMs === undefined
        ? undefined
        : this.now().getTime() - policy.maxAgeMs
    const pinnedRunIds = await this.readPinnedRunIds()
    const eligible = (await this.loadManifests())
      .filter(
        (manifest) => manifest.finishedAt && !pinnedRunIds.has(manifest.id),
      )
      .sort(byOldest)
    const removed = await this.removeExpiredRuns(eligible, cutoff)
    const afterBytes = await this.removeRunsOverLimit(
      eligible,
      policy.maxBytes,
      removed,
    )
    return { removed, beforeBytes, afterBytes }
  }

  async create(metadata: CreateTestRunOptions = {}): Promise<PersistedTestRun> {
    await this.loadManifests()
    const id = this.createId()
    validateRunId(id)
    const startedAt = this.now().toISOString()
    await mkdir(this.runsDirectory, { recursive: true })
    const runDirectory = join(this.runsDirectory, id)
    try {
      await mkdir(runDirectory)
    } catch (error) {
      if (isAlreadyExists(error)) {
        throw new Error(`Test run "${id}" already exists`)
      }
      throw error
    }
    const run = this.persistedRunFor(id, startedAt, metadata)
    try {
      await run.append(runStartedEvent(id, startedAt, metadata))
      return run
    } catch (error) {
      await rm(runDirectory, { recursive: true, force: true })
      throw error
    }
  }

  async list(): Promise<TestRunSummary[]> {
    const manifests = await this.loadManifests()
    const storedIds = manifests.map((manifest) => manifest.id).sort()
    const indexedIds = (await Bun.file(this.indexPath).exists())
      ? withIndex(this.indexPath, listRunIds)
      : []
    if (
      !(await Bun.file(this.indexPath).exists()) ||
      indexVersion(this.indexPath) < indexSchemaVersion ||
      !sameStrings(storedIds, indexedIds)
    ) {
      await this.rebuild(manifests)
    }
    return withIndex(this.indexPath, listRuns)
  }

  rebuildIndex(): Promise<void> {
    return this.rebuild()
  }

  async inspectStorage(): Promise<TestRunStorageInspection> {
    const totalBytes = await directorySize(this.runsDirectory)
    const pinnedRunIds = [...(await this.readPinnedRunIds())].sort()
    return {
      totalBytes,
      warningThresholdBytes: defaultRunStorageWarningBytes,
      warning: totalBytes >= defaultRunStorageWarningBytes,
      pinnedRunIds,
    }
  }

  pin(id: string): Promise<void> {
    return this.updatePin(id, true)
  }

  unpin(id: string): Promise<void> {
    return this.updatePin(id, false)
  }

  applyRetention(policy: RetentionPolicy = {}): Promise<RetentionResult> {
    return this.serializeManagementOperation(() =>
      this.applyRetentionPolicy(policy),
    )
  }
}

export function openTestRunStore(options: TestRunStoreOptions): TestRunStore {
  return new LocalTestRunStore(options)
}

interface PersistedRunState {
  id: string
  startedAt: string
  now: () => Date
  evidencePersistenceFor: (profileId: string) => EvidencePersistencePolicy
  onMaterialize: (manifest: TestRunManifest) => Promise<void>
  metadata: CreateTestRunOptions
  incompatibleSchema: (version: unknown) => never
  serializeOperation: SerializeOperation
  eventsPath: string
  manifestPath: string
  artifactsDirectory: string
}

async function finalizedManifest(
  state: PersistedRunState,
): Promise<TestRunManifest | undefined> {
  if (!(await Bun.file(state.manifestPath).exists())) return undefined
  const manifest = parseTestRunManifest(
    await Bun.file(state.manifestPath).json(),
    state.incompatibleSchema,
  )
  return manifest.finishedAt ? manifest : undefined
}

async function appendPersistedEvent(
  state: PersistedRunState,
  event: RunEvent | RunEventPayload,
): Promise<RunEvent> {
  if (await finalizedManifest(state)) {
    throw new Error(`Test run "${state.id}" is finalized and cannot be changed`)
  }
  const current = await readEvents(state.eventsPath, state.incompatibleSchema)
  const recordable = recordableRunEventPayloadData(eventPayload(event))
  const profileId =
    'scope' in recordable ? recordable.scope.executionTargetProfileId : ''
  const policy = state.evidencePersistenceFor(profileId)
  const envelope = {
    schemaVersion: testRunSchemaVersion,
    sequence: current.length + 1,
    occurredAt:
      'occurredAt' in event ? event.occurredAt : state.now().toISOString(),
  } as const
  const persisted = await persistEventArtifacts(
    recordable,
    current,
    policy,
    state.artifactsDirectory,
    envelope.sequence,
  )
  const versioned = { ...persisted.event, ...envelope } as RunEvent
  try {
    await appendFile(state.eventsPath, `${JSON.stringify(versioned)}\n`)
  } catch (error) {
    await Promise.all(
      persisted.publishedPaths.map((path) => rm(path, { force: true })),
    )
    throw error
  }
  return shouldPersistEventEvidence(recordable, policy)
    ? versioned
    : ({ ...recordable, ...envelope } as RunEvent)
}

async function materializePersistedRun(
  state: PersistedRunState,
  input?: { finished?: boolean },
): Promise<TestRunManifest> {
  const finalized = await finalizedManifest(state)
  if (finalized) return finalized
  const recorded = await readEvents(state.eventsPath, state.incompatibleSchema)
  const results = materializeTestResults(recorded)
  const manifest: TestRunManifest = {
    schemaVersion: testRunSchemaVersion,
    id: state.id,
    startedAt: startedAtFrom(recorded, state.startedAt),
    ...(input?.finished === false
      ? {}
      : { finishedAt: state.now().toISOString() }),
    ...(state.metadata.sourceRunId
      ? { sourceRunId: state.metadata.sourceRunId }
      : {}),
    ...(state.metadata.suite ? { suite: state.metadata.suite } : {}),
    ...(state.metadata.applicationRevision
      ? { applicationRevision: state.metadata.applicationRevision }
      : {}),
    state: aggregateTestResultState(results),
    results,
  }
  await Bun.write(state.manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  await state.onMaterialize(manifest)
  return manifest
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
  const state: PersistedRunState = {
    id,
    startedAt,
    now,
    evidencePersistenceFor,
    onMaterialize,
    metadata,
    incompatibleSchema,
    serializeOperation,
    eventsPath: join(directory, 'events.ndjson'),
    manifestPath: join(directory, 'manifest.json'),
    artifactsDirectory: join(directory, 'artifacts'),
  }

  return {
    id,
    async append(event) {
      return serializeOperation(() => appendPersistedEvent(state, event))
    },
    async events() {
      return serializeOperation(() =>
        readEvents(state.eventsPath, incompatibleSchema),
      )
    },
    async materialize(input) {
      return serializeOperation(() => materializePersistedRun(state, input))
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

function testRunSummaryFrom(row: unknown): TestRunSummary {
  const indexed = row as IndexedRun
  const executionModes = JSON.parse(indexed.executionModes) as ExecutionMode[]
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
    ...(indexed.durationMs !== null ? { durationMs: indexed.durationMs } : {}),
    state: indexed.state,
    resultCount: indexed.resultCount,
    executionModes: executionModes.length > 0 ? executionModes : undefined,
    cacheOutcomes: cacheOutcomes.length > 0 ? cacheOutcomes : undefined,
    inferenceCount: indexed.inferenceCount ?? undefined,
  }
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

interface MaterializedResultGroup {
  order: number
  specification: TestResult['specification']
  scenario: TestResult['scenario']
  executionTargetProfile: TestResult['executionTargetProfile']
  attempts: Map<number, ScenarioAttempt>
}

function collectResultGroups(
  events: readonly RunEvent[],
): Map<string, MaterializedResultGroup> {
  const groups = new Map<string, MaterializedResultGroup>()
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
  return groups
}

function materializedResult(group: MaterializedResultGroup): TestResult {
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
    ...(attempts.length > 1 && final.state === 'passed' ? { flaky: true } : {}),
  }
}

export function materializeTestResults(
  events: readonly RunEvent[],
): TestResult[] {
  return [...collectResultGroups(events).values()]
    .sort(
      (left, right) =>
        left.order - right.order ||
        (left.scenario.id ?? left.scenario.name).localeCompare(
          right.scenario.id ?? right.scenario.name,
        ),
    )
    .map(materializedResult)
}

function manifestInferenceCount(manifest: TestRunManifest): number | undefined {
  const counts = manifest.results.flatMap((result) => {
    const count = finalScenarioAttempt(result).inferenceCount
    return count === undefined ? [] : [count]
  })
  return counts.length > 0
    ? counts.reduce((total, count) => total + count, 0)
    : undefined
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
  const inferenceCount = manifestInferenceCount(manifest)
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
    .map(testRunSummaryFrom)
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
  endSequence: number,
): Promise<PersistedEventEvidence> {
  if (event.type === 'action-finished') {
    return persistActionEventArtifacts(event, policy, artifactsDirectory)
  }
  if (event.type === 'scenario-finished') {
    const persisted = await persistAttemptArtifacts(
      event.attempt,
      event.scope,
      current,
      policy,
      artifactsDirectory,
    )
    return {
      event: {
        ...event,
        attempt: {
          ...persisted.attempt,
          steps: persisted.attempt.steps.map((step) =>
            stampArtifactEvidenceLinks(
              step,
              { ...event.scope, stepIndex: step.index },
              current,
              matchingStepFinishedSequence(current, {
                ...event.scope,
                stepIndex: step.index,
              }) ?? endSequence,
            ),
          ),
        },
      },
      publishedPaths: persisted.publishedPaths,
    }
  }
  if (event.type === 'step-finished') {
    const step = withPersistedActionArtifacts(
      event.result,
      event.scope,
      current,
    )
    const persisted = await persistStepArtifacts(
      step,
      policy,
      artifactsDirectory,
      artifactStepName(event.scope, event.result.index),
    )
    return {
      event: {
        ...event,
        result: stampArtifactEvidenceLinks(
          persisted.step,
          event.scope,
          current,
          endSequence,
        ),
      },
      publishedPaths: persisted.publishedPaths,
    }
  }
  return { event, publishedPaths: [] }
}

function withPersistedActionArtifacts(
  step: TestStepResult,
  scope: Extract<RunEventPayload, { type: 'step-finished' }>['scope'],
  current: readonly RunEvent[],
): TestStepResult {
  const artifactsBySourcePath = new Map<string, TestArtifact>()
  const resolvedActions = step.resolvedActions.map((resolvedAction) => {
    const evidence = resolvedAction.evidence
    if (!evidence) return resolvedAction
    const persisted = current.findLast(
      (event) =>
        event.type === 'action-finished' &&
        sameScope(event.scope, scope) &&
        event.action.id === evidence.id,
    )
    if (persisted?.type !== 'action-finished') return resolvedAction
    const screenshot = (
      source: typeof evidence.screenshots.before,
      retained: typeof evidence.screenshots.before,
    ): typeof evidence.screenshots.before => {
      if (source.state !== 'available' || retained.state !== 'available') {
        return retained
      }
      artifactsBySourcePath.set(source.artifact.path, retained.artifact)
      return retained
    }
    return {
      ...resolvedAction,
      evidence: {
        ...evidence,
        screenshots: {
          before: screenshot(
            evidence.screenshots.before,
            persisted.action.screenshots.before,
          ),
          after: screenshot(
            evidence.screenshots.after,
            persisted.action.screenshots.after,
          ),
        },
      },
    }
  })
  return {
    ...step,
    resolvedActions,
    artifacts: step.artifacts?.map(
      (artifact) => artifactsBySourcePath.get(artifact.path) ?? artifact,
    ),
  }
}

async function persistActionEventArtifacts(
  event: Extract<RunEventPayload, { type: 'action-finished' }>,
  policy: EvidencePersistencePolicy,
  artifactsDirectory: string,
): Promise<PersistedEventEvidence> {
  if (policy !== 'always') {
    return {
      event: {
        ...event,
        action: withoutProvisionalActionEvidence(event.action),
      },
      publishedPaths: [],
    }
  }
  const persisted = await persistActionArtifacts(event, artifactsDirectory)
  return {
    event: { ...event, action: persisted.action },
    publishedPaths: persisted.publishedPaths,
  }
}

function withoutProvisionalActionEvidence(
  action: Extract<RunEventPayload, { type: 'action-finished' }>['action'],
): Extract<RunEventPayload, { type: 'action-finished' }>['action'] {
  const withoutFile = (
    screenshot: typeof action.screenshots.before,
  ): typeof action.screenshots.before =>
    screenshot.state === 'available' ? { state: 'not-retained' } : screenshot
  return {
    ...action,
    screenshots: {
      before: withoutFile(action.screenshots.before),
      after: withoutFile(action.screenshots.after),
    },
    diagnostics: [],
    activity: [],
  }
}

async function persistActionArtifacts(
  event: Extract<RunEventPayload, { type: 'action-finished' }>,
  artifactsDirectory: string,
): Promise<{
  action: typeof event.action
  publishedPaths: string[]
}> {
  const artifacts = [
    event.action.screenshots.before,
    event.action.screenshots.after,
  ].flatMap((screenshot) =>
    screenshot.state === 'available' ? [screenshot.artifact] : [],
  )
  const syntheticStep: TestStepResult = {
    index: event.scope.stepIndex ?? 0,
    startedAt: event.action.startedAt,
    finishedAt: event.action.finishedAt,
    durationMs: event.action.durationMs,
    step: {
      keyword: 'When',
      text: event.action.description,
      type: 'action',
    },
    state: event.action.state,
    resolvedActions: [
      { description: event.action.description, evidence: event.action },
    ],
    artifacts,
  }
  const persisted = await copyStepArtifacts(
    syntheticStep,
    artifactsDirectory,
    join(
      artifactStepName(event.scope, event.scope.stepIndex ?? 0),
      `action-${event.action.ordinal}`,
    ),
  )
  const action = persisted.step.resolvedActions[0]?.evidence
  return {
    action: action ?? withoutProvisionalActionEvidence(event.action),
    publishedPaths: persisted.publishedPaths,
  }
}

function sameAttemptScope(
  left: RunEventScope,
  right: Extract<RunEventPayload, { type: 'step-finished' }>['scope'],
): boolean {
  return (
    left.scenarioId === right.scenarioId &&
    left.examplesRowId === right.examplesRowId &&
    left.executionTargetProfileId === right.executionTargetProfileId &&
    left.attempt === right.attempt
  )
}

function artifactStartSequence(
  artifact: TestArtifact,
  stepIndex: number,
  scope: Extract<RunEventPayload, { type: 'step-finished' }>['scope'],
  current: readonly RunEvent[],
): number | undefined {
  const started = current.filter(
    (event): event is Extract<RunEvent, { type: 'step-started' }> =>
      event.type === 'step-started' && sameAttemptScope(event.scope, scope),
  )
  if (artifact.kind === 'recording') return started[0]?.sequence
  return started.findLast((event) => event.scope.stepIndex === stepIndex)
    ?.sequence
}

function stampArtifactEvidenceLinks(
  step: TestStepResult,
  scope: Extract<RunEventPayload, { type: 'step-finished' }>['scope'],
  current: readonly RunEvent[],
  endSequence: number,
): TestStepResult {
  if (!step.artifacts?.length) return step
  return {
    ...step,
    artifacts: step.artifacts.map((artifact) => {
      const startSequence = artifactStartSequence(
        artifact,
        step.index,
        scope,
        current,
      )
      if (startSequence === undefined) return artifact
      return {
        ...artifact,
        evidenceLink: {
          stepIndex: step.index,
          eventRange: { startSequence, endSequence },
        },
      }
    }),
  }
}

function matchingStepFinishedSequence(
  current: readonly RunEvent[],
  scope: Extract<RunEventPayload, { type: 'step-finished' }>['scope'],
): number | undefined {
  return current.findLast(
    (event) => event.type === 'step-finished' && sameScope(event.scope, scope),
  )?.sequence
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

async function persistAttemptStep(
  step: TestStepResult,
  scope: Extract<RunEventPayload, { type: 'scenario-finished' }>['scope'],
  current: readonly RunEvent[],
  artifactsDirectory: string,
): Promise<PersistedStepEvidence> {
  const stepScope = { ...scope, stepIndex: step.index }
  const currentStep = withPersistedActionArtifacts(step, stepScope, current)
  const persisted = current.findLast(
    (event) =>
      event.type === 'step-finished' && sameScope(event.scope, stepScope),
  )
  const stepName = artifactStepName(scope, step.index)
  if (persisted?.type !== 'step-finished' || !persisted.result.artifacts) {
    return copyStepArtifacts(currentStep, artifactsDirectory, stepName)
  }
  if (persisted.result.artifacts.length === currentStep.artifacts?.length) {
    const copiedBySourcePath = new Map(
      (currentStep.artifacts ?? []).flatMap((artifact, index) => {
        const persistedArtifact = persisted.result.artifacts?.[index]
        return persistedArtifact ? [[artifact.path, persistedArtifact]] : []
      }),
    )
    return {
      step: {
        ...mapActionEvidenceArtifacts(currentStep, copiedBySourcePath),
        artifacts: persisted.result.artifacts,
      },
      publishedPaths: [],
      captureFailures: [],
    }
  }
  const artifacts = currentStep.artifacts?.map((artifact, index) => {
    const path = artifactDestination(
      artifact,
      index,
      artifactsDirectory,
      stepName,
    )
    return (
      persisted.result.artifacts?.find(
        (committed) => committed.path === path,
      ) ?? artifact
    )
  })
  return copyStepArtifacts(
    { ...currentStep, artifacts },
    artifactsDirectory,
    stepName,
  )
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
    attempt.steps.map((step) =>
      persistAttemptStep(step, scope, current, artifactsDirectory),
    ),
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

function withoutActionEvidenceFiles(step: TestStepResult): TestStepResult {
  return {
    ...step,
    resolvedActions: step.resolvedActions.map((action) => {
      if (!action.evidence) return action
      const unavailable = (state: typeof action.evidence.screenshots.before) =>
        state.state === 'available' ? { state: 'not-retained' as const } : state
      return {
        ...action,
        evidence: {
          ...action.evidence,
          screenshots: {
            before: unavailable(action.evidence.screenshots.before),
            after: unavailable(action.evidence.screenshots.after),
          },
          diagnostics: [],
          activity: [],
        },
      }
    }),
  }
}

function withoutStepEvidence(step: TestStepResult): TestStepResult {
  const {
    artifacts: _artifacts,
    diagnostics: _diagnostics,
    trace: _trace,
    ...rest
  } = step
  return withoutActionEvidenceFiles(rest)
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
  const copiedBySourcePath = new Map<string, TestArtifact>()
  try {
    for (const [index, artifact] of step.artifacts.entries()) {
      const copied = await copyStepArtifact(
        artifact,
        index,
        artifactsDirectory,
        stagingDirectory,
        name,
      )
      appendCopiedStepArtifact(
        copied,
        artifacts,
        publishedPaths,
        captureFailures,
      )
      if (copied.artifact) {
        copiedBySourcePath.set(artifact.path, copied.artifact)
      }
    }
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true })
    await rmdir(stagingRoot).catch(() => undefined)
  }
  return {
    step: {
      ...mapActionEvidenceArtifacts(step, copiedBySourcePath),
      artifacts: artifacts.length > 0 ? artifacts : undefined,
    },
    publishedPaths,
    captureFailures,
  }
}

function mapActionEvidenceArtifacts(
  step: TestStepResult,
  copiedBySourcePath: ReadonlyMap<string, TestArtifact>,
): TestStepResult {
  const screenshot = (
    value: NonNullable<
      TestStepResult['resolvedActions'][number]['evidence']
    >['screenshots']['before'],
  ) => {
    if (value.state !== 'available') return value
    const artifact = copiedBySourcePath.get(value.artifact.path)
    return artifact
      ? { state: 'available' as const, artifact }
      : { state: 'capture-failed' as const, message: 'Screenshot copy failed' }
  }
  return {
    ...step,
    resolvedActions: step.resolvedActions.map((action) =>
      action.evidence
        ? {
            ...action,
            evidence: {
              ...action.evidence,
              screenshots: {
                before: screenshot(action.evidence.screenshots.before),
                after: screenshot(action.evidence.screenshots.after),
              },
            },
          }
        : action,
    ),
  }
}

interface CopiedStepArtifact {
  artifact?: TestArtifact
  publishedPath?: string
  captureFailure?: EvidenceCaptureFailure
}

function appendCopiedStepArtifact(
  copied: CopiedStepArtifact,
  artifacts: TestArtifact[],
  publishedPaths: string[],
  captureFailures: EvidenceCaptureFailure[],
): void {
  if (copied.artifact) artifacts.push(copied.artifact)
  if (copied.publishedPath) publishedPaths.push(copied.publishedPath)
  if (copied.captureFailure) captureFailures.push(copied.captureFailure)
}

async function copyStepArtifact(
  artifact: TestArtifact,
  index: number,
  artifactsDirectory: string,
  stagingDirectory: string,
  name: string,
): Promise<CopiedStepArtifact> {
  const managedPath = relative(artifactsDirectory, artifact.path)
  if (
    managedPath !== '' &&
    managedPath !== '..' &&
    !managedPath.startsWith(`..${pathSeparator}`) &&
    !isAbsolute(managedPath)
  ) {
    return { artifact }
  }
  const path = artifactDestination(artifact, index, artifactsDirectory, name)
  if (artifact.path === path) return { artifact }
  const stagedPath = join(stagingDirectory, basename(path))
  try {
    await copyFile(artifact.path, stagedPath)
    if (await pathExists(path)) {
      throw new Error(`Test artifact destination already exists: ${path}`)
    }
    await rename(stagedPath, path)
    return { artifact: { ...artifact, path }, publishedPath: path }
  } catch (error) {
    return {
      captureFailure: {
        kind: artifact.kind,
        message: `${artifact.path}: ${errorMessage(error)}`,
      },
    }
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
  if (event.type === 'action-finished') return policy === 'always'
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
