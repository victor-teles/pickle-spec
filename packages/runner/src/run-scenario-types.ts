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

export interface StepExecution {
  state: TestResultState
  resolvedActions: ResolvedAction[]
  replayDiverged?: boolean
  message?: string
  artifacts?: TestArtifact[]
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
  step: ScenarioStep
  state: TestResultState
  resolvedActions: ResolvedAction[]
  message?: string
  artifacts?: TestArtifact[]
}

export interface TestResult {
  schemaVersion: 1
  specification: {
    name: string
    uri: string
  }
  scenario: ScenarioIdentity
  executionTargetProfile: ExecutionTargetProfile
  state: TestResultState
  steps: TestStepResult[]
  executionMode?: ExecutionMode
  cacheOutcome?: CacheOutcome
  inferenceCount?: number
  cacheUncacheableReason?: ExecutionCacheUncacheableReason
  failureKind?: 'cache-miss'
  message?: string
  attempts?: number
  flaky?: boolean
  durationMs?: number
  fidelityPolicy?: FidelityPolicy
}

interface RunEventEnvelope {
  schemaVersion: 1
  sequence: number
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
      executionTargetProfile?: ExecutionTargetProfile
    }
  | {
      type: 'step-started'
      step: ScenarioStep
      scenario?: TestResult['scenario']
      executionTargetProfile?: ExecutionTargetProfile
    }
  | {
      type: 'step-finished'
      result: TestStepResult
      scenario?: TestResult['scenario']
      executionTargetProfile?: ExecutionTargetProfile
    }
  | { type: 'cache-hit'; cacheKey: ExecutionCacheKey }
  | { type: 'cache-miss'; cacheKey: ExecutionCacheKey }
  | { type: 'cache-refresh'; cacheKey: ExecutionCacheKey }
  | { type: 'replay-diverged'; cacheKey: ExecutionCacheKey }
  | { type: 'adaptive-fallback-started'; cacheKey: ExecutionCacheKey }
  | { type: 'cache-written'; cacheKey: ExecutionCacheKey }
  | {
      type: 'cache-uncacheable'
      reason: ExecutionCacheUncacheableReason
    }
  | { type: 'inference-count-updated'; inferenceCount: number }
  | { type: 'scenario-finished'; result: TestResult; scheduleIndex?: number }

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
  signal?: AbortSignal
  onEvent?: (event: RunEvent) => void | Promise<void>
}
