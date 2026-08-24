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
} from './execution-cache'
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

export interface ExecutionTargetProfile {
  id: string
  adapter?: string
  capabilities?: readonly string[]
}

export interface ResolvedAction {
  description: string
  replay?: Record<string, unknown>
}

export interface TestArtifact {
  kind: 'screenshot' | 'trace' | 'recording' | 'device-log'
  path: string
  mediaType?: string
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

export const diagnosticLevels = ['debug', 'info', 'warning', 'error'] as const
export type DiagnosticLevel = (typeof diagnosticLevels)[number]

export const diagnosticOrigins = [
  'console',
  'network',
  'runner',
  'adapter',
] as const
export type DiagnosticOrigin = (typeof diagnosticOrigins)[number]

export interface DiagnosticEntry {
  occurredAt: string
  causalAt?: string
  level: DiagnosticLevel
  origin: DiagnosticOrigin
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

export interface StepExecutionContext {
  stepIndex: number
  templateStep: ScenarioStep
  runtimeBindings: readonly ScenarioVariableBinding[]
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
  cacheUncacheableReason?: ExecutionCacheUncacheableReason
  failureKind?: 'cache-miss'
  message?: string
  fidelityPolicy?: FidelityPolicy
  evidenceAvailability: EvidenceAvailability[]
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

export type RunEventPayload =
  | {
      type: 'run-started'
      run: {
        id: string
        startedAt: string
        sourceRunId?: string
        suite?: string
        applicationRevision?: string
      }
    }
  | {
      type: 'scenario-started'
      scenario: TestResult['scenario']
      executionTargetProfile: ExecutionTargetProfile
      scope: RunEventScope
    }
  | {
      type: 'step-started'
      step: ScenarioStep
      scenario: TestResult['scenario']
      executionTargetProfile: ExecutionTargetProfile
      scope: RunEventScope
    }
  | {
      type: 'step-finished'
      result: TestStepResult
      scenario: TestResult['scenario']
      executionTargetProfile: ExecutionTargetProfile
      scope: RunEventScope
    }
  | { type: 'cache-hit'; cacheKey: ExecutionCacheKey; scope: RunEventScope }
  | { type: 'cache-miss'; cacheKey: ExecutionCacheKey; scope: RunEventScope }
  | { type: 'cache-refresh'; cacheKey: ExecutionCacheKey; scope: RunEventScope }
  | {
      type: 'replay-diverged'
      cacheKey: ExecutionCacheKey
      scope: RunEventScope
    }
  | {
      type: 'adaptive-fallback-started'
      cacheKey: ExecutionCacheKey
      scope: RunEventScope
    }
  | { type: 'cache-written'; cacheKey: ExecutionCacheKey; scope: RunEventScope }
  | {
      type: 'cache-uncacheable'
      reason: ExecutionCacheUncacheableReason
      scope: RunEventScope
    }
  | {
      type: 'inference-count-updated'
      inferenceCount: number
      scope: RunEventScope
    }
  | {
      type: 'scenario-finished'
      specification: TestResult['specification']
      scenario: TestResult['scenario']
      executionTargetProfile: ExecutionTargetProfile
      scope: RunEventScope
      attempt: ScenarioAttempt
      scheduleIndex?: number
    }

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
