import type {
  ExecutionMode,
  RunEvent,
  RunEventPayload,
  TestResult,
  TestResultState,
  testRunSchemaVersion,
} from '../../execution/run-scenario'
import type { CacheOutcome } from '../../execution-cache/execution-cache'
import type {
  ArtifactCapturePolicy,
  EvidencePersistencePolicy,
} from './test-run-evidence'

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
