import type {
  Scenario,
  ScenarioStep,
  ScenarioTemplate,
  ScenarioVariableBinding,
  Specification,
} from '@pickle-spec/spec'
import type {
  CacheOutcome,
  ExecutionCacheAdapter,
  ExecutionCacheKey,
  ExecutionCacheStore,
  ExecutionCacheUncacheableReason,
} from '../execution-cache/execution-cache'
export type TestResultState =
  | 'passed'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'infrastructure-error'

export function isEvidenceState(state: TestResultState): boolean {
  return state === 'failed' || state === 'infrastructure-error'
}

export type ExecutionMode = 'adaptive' | 'replay'

export const testRunSchemaVersion = 2 as const
export const sharedEvidenceObservationVersion = 1 as const
export const actionEvidenceVersion = 1 as const

export interface ExecutionTargetProfile {
  id: string
  adapter?: string
  capabilities?: readonly string[]
}

export interface ResolvedAction {
  description: string
  replay?: Record<string, unknown>
  evidence?: ActionEvidence
}

export interface ActionTargetState {
  format: 'summary'
  summary: string
  location?: string
}

export type ActionScreenshot =
  | { state: 'available'; artifact: TestArtifact }
  | {
      state: Exclude<EvidenceAvailabilityState, 'available'>
      message?: string
    }

export interface ActionSourceEvidence {
  uri: string
  language: string
  line?: number
  column?: number
  excerpt: string
}

export interface ActionEvidence {
  version: typeof actionEvidenceVersion
  id: string
  ordinal: number
  description: string
  startedAt: string
  finishedAt: string
  durationMs: number
  state: 'passed' | 'failed'
  message?: string
  source: ActionSourceEvidence
  target: {
    before: ActionTargetState
    after: ActionTargetState
  }
  screenshots: {
    before: ActionScreenshot
    after: ActionScreenshot
  }
  diagnostics: DiagnosticEntry[]
  activity: TraceEntry[]
}

export interface ActionEvidenceInput {
  description: string
  startedAt: string
  finishedAt: string
  state: 'passed' | 'failed'
  message?: string
  target: ActionEvidence['target']
  screenshots: ActionEvidence['screenshots']
  diagnostics?: DiagnosticEntry[]
  activity?: TraceEntry[]
}

export interface RunEventRange {
  startSequence: number
  endSequence: number
}

export interface ArtifactEvidenceLink {
  stepIndex: number
  eventRange: RunEventRange
}

export interface TestArtifact {
  kind: 'screenshot' | 'trace' | 'recording' | 'device-log'
  path: string
  mediaType?: string
  name?: string
  capturedAt?: string
  sizeBytes?: number
  evidenceLink?: ArtifactEvidenceLink
}

export const evidenceKinds = [
  'screenshot',
  'trace',
  'recording',
  'device-log',
  'diagnostics',
] as const

export type EvidenceKind = (typeof evidenceKinds)[number]

export type EvidenceAvailabilityState =
  | 'available'
  | 'not-requested'
  | 'not-supported'
  | 'not-retained'
  | 'capture-failed'
  | 'missing'

export interface EvidenceAvailability {
  kind: EvidenceKind
  state: EvidenceAvailabilityState
  message?: string
}

export interface ApplicationOutputEvidenceAvailability {
  stream: 'stdout' | 'stderr'
  state: EvidenceAvailabilityState
  message?: string
}

export const diagnosticLevels = ['debug', 'info', 'warning', 'error'] as const
export type DiagnosticLevel = (typeof diagnosticLevels)[number]

export const diagnosticOrigins = [
  'console',
  'network',
  'runner',
  'adapter',
  'application',
] as const
export type DiagnosticOrigin = (typeof diagnosticOrigins)[number]

export interface DiagnosticEntry {
  occurredAt: string
  causalAt?: string
  level: DiagnosticLevel
  origin: DiagnosticOrigin
  stream?: 'stdout' | 'stderr'
  message: string
  scenarioId?: string
  scenarioName?: string
  stepIndex?: number
  stepText?: string
  executionTargetProfileId?: string
}

export const traceActivityKinds = [
  'resolved-action',
  'browser-activity',
] as const
export type TraceActivityKind = (typeof traceActivityKinds)[number]

export interface TraceEntry {
  occurredAt: string
  causalAt?: string
  kind: TraceActivityKind
  description: string
}

export interface SharedEvidenceTiming {
  occurredAt: string
  precision: 'exact' | 'step-finish' | 'attempt-finish'
  startedAt?: string
  finishedAt?: string
  durationMs?: number
  causalAt?: string
}

export interface SharedEvidenceVersionObservation {
  subject: 'contract' | 'application' | 'scenario' | 'adapter'
  label: string
  value: string
}

export interface SharedEvidenceActivity {
  kind: TraceActivityKind
  description: string
}

export interface SharedEvidenceOutcome {
  state?: TestResultState
  level?: DiagnosticLevel
  message?: string
}

export interface SharedEvidenceCost {
  inferenceCount: number
}

export const sharedEvidenceCacheDecisionTypes = [
  'cache-hit',
  'cache-miss',
  'cache-refresh',
  'replay-diverged',
  'adaptive-fallback-started',
  'cache-written',
  'cache-uncacheable',
] as const
export type SharedEvidenceCacheDecisionType =
  (typeof sharedEvidenceCacheDecisionTypes)[number]

export interface SharedEvidenceExecution {
  mode?: ExecutionMode
  cacheOutcome?: CacheOutcome
  cacheDecision?: {
    type: SharedEvidenceCacheDecisionType
    reason?: ExecutionCacheUncacheableReason
    cacheKey?: ExecutionCacheKey
  }
}

export interface SharedEvidenceObservation {
  version: typeof sharedEvidenceObservationVersion
  kind: 'activity' | 'diagnostic' | 'artifact' | 'outcome' | 'cache'
  summary: string
  timing: SharedEvidenceTiming
  versions?: readonly SharedEvidenceVersionObservation[]
  activity?: SharedEvidenceActivity
  outcome?: SharedEvidenceOutcome
  cost?: SharedEvidenceCost
  artifact?: TestArtifact
  execution?: SharedEvidenceExecution
}

export interface StepExecution {
  state: TestResultState
  resolvedActions: ResolvedAction[]
  replayDiverged?: boolean
  message?: string
  artifacts?: TestArtifact[]
  evidenceAvailability?: EvidenceAvailability[]
  diagnostics?: DiagnosticEntry[]
  trace?: TraceEntry[]
}

export type StepEvaluation = 'replay' | 'adaptive'

export interface StepExecutionContext {
  stepIndex: number
  templateStep: ScenarioStep
  runtimeBindings: readonly ScenarioVariableBinding[]
  evaluation?: StepEvaluation
  recordAction?: (input: ActionEvidenceInput) => Promise<ActionEvidence>
}

export type TargetSessionReplayRepresentation =
  | {
      cacheable: true
      adapterPayload: unknown
      requiredVariables: readonly string[]
    }
  | {
      cacheable: false
      reason: ExecutionCacheUncacheableReason
    }

export interface TargetSessionCompletion {
  inferenceCount: number
  evaluationModel?: string
  replayRepresentation?: TargetSessionReplayRepresentation
}

export interface ScenarioExecution {
  stepExecutions: StepExecution[]
  replayDiverged?: boolean
}

interface TargetSessionLifecycle {
  complete?(): Promise<TargetSessionCompletion>
  close(): Promise<void>
}

export interface StepTargetSession extends TargetSessionLifecycle {
  executeStep(
    step: ScenarioStep,
    signal?: AbortSignal,
    context?: StepExecutionContext,
  ): Promise<StepExecution>
  executeScenario?: never
}

export interface ScenarioTargetSession extends TargetSessionLifecycle {
  executeStep?: never
  executeScenario(signal?: AbortSignal): Promise<ScenarioExecution>
}

export type TargetSession = StepTargetSession | ScenarioTargetSession

export interface ReplayCacheInput {
  adapterPayload: unknown
  requiredVariables: readonly string[]
}

export interface OpenSessionInput {
  executionTargetProfile: ExecutionTargetProfile
  specification: Specification
  scenario: Scenario
  mode?: ExecutionMode
  executionCache?: ReplayCacheInput
  scenarioTemplate?: ScenarioTemplate
  runtimeBindings?: readonly ScenarioVariableBinding[]
  signal?: AbortSignal
}

export interface FidelityPolicy {
  profile: 'default' | 'fast'
  tradeOffs: readonly string[]
}

export interface ExecutionTargetAdapter<
  Session extends TargetSession = TargetSession,
> {
  capabilities?: readonly string[]
  executionCache?: ExecutionCacheAdapter
  fidelityPolicy?: FidelityPolicy
  openSession(input: OpenSessionInput): Promise<Session>
  dispose?(): Promise<void>
}

export type StepExecutionTargetAdapter =
  ExecutionTargetAdapter<StepTargetSession>

export interface ScenarioIdentity {
  name: string
  id?: string
  examplesId?: string
  examplesRowId?: string
}

export interface TestStepResult {
  index: number
  startedAt: string
  finishedAt: string
  durationMs: number
  step: ScenarioStep
  state: TestResultState
  resolvedActions: ResolvedAction[]
  message?: string
  artifacts?: TestArtifact[]
  diagnostics?: DiagnosticEntry[]
  trace?: TraceEntry[]
}

export interface ScenarioAttempt {
  attempt: number
  startedAt: string
  finishedAt: string
  durationMs: number
  state: TestResultState
  steps: TestStepResult[]
  executionMode?: ExecutionMode
  cacheOutcome?: CacheOutcome
  inferenceCount?: number
  prefixStepCount?: number
  cacheUncacheableReason?: ExecutionCacheUncacheableReason
  failureKind?: 'cache-miss'
  message?: string
  fidelityPolicy?: FidelityPolicy
  evidenceAvailability: EvidenceAvailability[]
  applicationOutputAvailability?: ApplicationOutputEvidenceAvailability[]
  diagnostics?: DiagnosticEntry[]
}

export interface TestResult {
  schemaVersion: typeof testRunSchemaVersion
  specification: {
    name: string
    uri: string
  }
  scenario: ScenarioIdentity
  executionTargetProfile: ExecutionTargetProfile
  state: TestResultState
  startedAt: string
  finishedAt: string
  durationMs: number
  attempts: ScenarioAttempt[]
  flaky?: boolean
}

export function finalScenarioAttempt(result: TestResult): ScenarioAttempt {
  const attempt = result.attempts.at(-1)
  if (!attempt) {
    throw new Error('A Test result requires at least one Scenario attempt')
  }
  return attempt
}

interface RunEventEnvelope {
  schemaVersion: typeof testRunSchemaVersion
  sequence: number
  occurredAt: string
}

export interface RunEventScope {
  scenarioId: string
  examplesRowId?: string
  executionTargetProfileId: string
  attempt: number
  stepIndex?: number
}

type RunEventWithObservations<Event extends { type: string }> = Event & {
  observations?: SharedEvidenceObservation[]
}

export type RunEventPayload =
  | RunEventWithObservations<{
      type: 'run-started'
      run: {
        id: string
        startedAt: string
        sourceRunId?: string
        suite?: string
        applicationRevision?: string
        evidencePersistence?: 'off' | 'on-failure' | 'always'
      }
    }>
  | RunEventWithObservations<{
      type: 'scenario-started'
      scenario: TestResult['scenario']
      executionTargetProfile: ExecutionTargetProfile
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'step-started'
      step: ScenarioStep
      scenario: TestResult['scenario']
      executionTargetProfile: ExecutionTargetProfile
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'step-finished'
      result: TestStepResult
      scenario: TestResult['scenario']
      executionTargetProfile: ExecutionTargetProfile
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'action-finished'
      action: ActionEvidence
      scenario: TestResult['scenario']
      executionTargetProfile: ExecutionTargetProfile
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'cache-hit'
      cacheKey: ExecutionCacheKey
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'cache-miss'
      cacheKey: ExecutionCacheKey
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'cache-refresh'
      cacheKey: ExecutionCacheKey
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'replay-diverged'
      cacheKey: ExecutionCacheKey
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'adaptive-fallback-started'
      cacheKey: ExecutionCacheKey
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'cache-written'
      cacheKey: ExecutionCacheKey
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'cache-uncacheable'
      reason: ExecutionCacheUncacheableReason
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'inference-count-updated'
      inferenceCount: number
      scope: RunEventScope
    }>
  | RunEventWithObservations<{
      type: 'scenario-finished'
      specification: TestResult['specification']
      scenario: TestResult['scenario']
      executionTargetProfile: ExecutionTargetProfile
      scope: RunEventScope
      attempt: ScenarioAttempt
      scheduleIndex?: number
    }>

export type RunEvent = RunEventEnvelope & RunEventPayload

export interface ScenarioRun {
  events: RunEvent[]
  result: TestResult
}

export interface RetryPolicy {
  infrastructureErrors: number
  functionalFailures?: number
}

export interface ExecutionTimeouts {
  stepMs?: number
  scenarioMs?: number
}

export interface ExecutionPolicy {
  retry?: RetryPolicy
  timeout?: ExecutionTimeouts
}

export type ExecutionCachePolicy = 'prefer-cache' | 'refresh' | 'cache-only'

export interface ScenarioExecutionCache {
  store: ExecutionCacheStore
  projectKey: string
  sourceRunId: string
}

export interface RunScenarioInput extends ExecutionPolicy {
  specification: Specification
  scenario: Scenario
  executionTargetProfile: ExecutionTargetProfile
  adapter: ExecutionTargetAdapter
  executionCache?: ScenarioExecutionCache
  cachePolicy?: ExecutionCachePolicy
  applicationRevision?: string
  now?: () => Date
  signal?: AbortSignal
  onEvent?: (event: RunEvent) => void | Promise<void>
}
