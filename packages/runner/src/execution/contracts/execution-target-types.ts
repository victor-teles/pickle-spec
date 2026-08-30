import type {
  Scenario,
  ScenarioStep,
  ScenarioTemplate,
  ScenarioVariableBinding,
  Specification,
} from '@pickle-spec/spec'
import type {
  ExecutionCacheAdapter,
  ExecutionCacheUncacheableReason,
} from '../../execution-cache/execution-cache'
import type {
  ActionEvidence,
  ActionEvidenceInput,
  DiagnosticEntry,
  EvidenceAvailability,
  ExecutionMode,
  ResolvedAction,
  TestArtifact,
  TestResultState,
  TraceEntry,
} from './run-evidence-types'

export interface ExecutionTargetProfile {
  id: string
  adapter?: string
  capabilities?: readonly string[]
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
