import type { ScenarioVariableBinding } from '@pickle-spec/spec'
import type {
  DiagnosticEntry,
  EvidenceAvailability,
  RunEvent,
  RunEventPayload,
  RunEventScope,
  ScenarioAttemptInput,
  StepExecution,
  TestResultState,
  TestStepResult,
} from '../run-scenario-types'
import { scenarioDefinitionId, scenarioIdentity } from './scenario-runtime'

export function attemptIdentity(
  input: ScenarioAttemptInput,
  stepIndex?: number,
) {
  const scenario = {
    ...scenarioIdentity(input.scenario),
    id: scenarioDefinitionId(input.specification, input.scenario),
  }
  const scope: RunEventScope = {
    scenarioId: scenario.id,
    examplesRowId: scenario.examplesRowId,
    executionTargetProfileId: input.executionTargetProfile.id,
    attempt: input.attempt,
    stepIndex,
  }
  return {
    scenario,
    executionTargetProfile: input.executionTargetProfile,
    scope,
  }
}

export interface AttemptProgress {
  state: TestResultState
  message?: string
  replayDiverged: boolean
  runtimeValueExposed: boolean
  evidenceAvailability: EvidenceAvailability[]
  diagnostics: DiagnosticEntry[]
  replayedStepCount: number
  adaptiveEvaluated: boolean
}

export type EmitAttemptEvent = (
  event: RunEventPayload,
  occurredAt?: string,
) => Promise<RunEvent>
export type RecordExecution = (
  stepIndex: number,
  startedAt: string,
  execution: StepExecution,
) => Promise<boolean>
export type UntimedTestStepResult = Omit<
  TestStepResult,
  'index' | 'startedAt' | 'finishedAt' | 'durationMs'
>
export type RecordStep = (
  stepIndex: number,
  startedAt: string,
  result: UntimedTestStepResult,
) => Promise<void>

export interface SessionExecutionContext {
  input: ScenarioAttemptInput
  bindings: readonly ScenarioVariableBinding[]
  progress: AttemptProgress
  latestOccurredAt: () => string
  emit: EmitAttemptEvent
  recordExecution: RecordExecution
  recordStep: RecordStep
}
