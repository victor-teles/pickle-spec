import type { ScenarioStep, ScenarioVariableBinding } from '@pickle-spec/spec'
import type {
  DiagnosticEntry,
  ScenarioAttemptInput,
} from '../run-scenario-types'
import { errorMessage, isCancellation } from './scenario-deadlines'
import type { AttemptProgress } from './scenario-execution-context'
import {
  redactString,
  scenarioDefinitionId,
  stringContainsBinding,
  templateStepAt,
} from './scenario-runtime'

export function stampDiagnostic(
  entry: DiagnosticEntry,
  input: ScenarioAttemptInput,
  stepIndex?: number,
  step?: ScenarioStep,
): DiagnosticEntry {
  return {
    ...entry,
    scenarioId:
      entry.scenarioId ??
      scenarioDefinitionId(input.specification, input.scenario),
    scenarioName: entry.scenarioName ?? input.scenario.name,
    stepIndex: entry.stepIndex ?? stepIndex,
    stepText:
      entry.stepText ??
      (step ? `${step.keyword.trim()} ${step.text}` : undefined),
    executionTargetProfileId:
      entry.executionTargetProfileId ?? input.executionTargetProfile.id,
  }
}

export function runnerDiagnostic(
  input: ScenarioAttemptInput,
  message: string,
  occurredAt: string,
  stepIndex?: number,
  step?: ScenarioStep,
): DiagnosticEntry {
  return stampDiagnostic(
    {
      occurredAt,
      level: 'error',
      origin: 'runner',
      message,
    },
    input,
    stepIndex,
    step,
  )
}

export function recordExecutionError(
  progress: AttemptProgress,
  error: unknown,
  bindings: readonly ScenarioVariableBinding[],
  input: ScenarioAttemptInput,
  occurredAt: string,
  signal?: AbortSignal,
  stepIndex?: number,
): void {
  const attemptProgress = progress
  const rawMessage = errorMessage(error)
  attemptProgress.runtimeValueExposed ||= stringContainsBinding(
    rawMessage,
    bindings,
  )
  attemptProgress.state = isCancellation(error, signal)
    ? 'cancelled'
    : 'infrastructure-error'
  attemptProgress.message = redactString(rawMessage, bindings)
  attemptProgress.diagnostics.push(
    runnerDiagnostic(
      input,
      attemptProgress.message,
      occurredAt,
      stepIndex,
      stepIndex === undefined
        ? undefined
        : templateStepAt(input.scenario, stepIndex),
    ),
  )
}
