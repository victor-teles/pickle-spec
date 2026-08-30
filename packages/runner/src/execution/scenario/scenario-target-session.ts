import type { ScenarioVariableBinding } from '@pickle-spec/spec'
import type {
  ScenarioAttemptInput,
  ScenarioTargetSession,
  StepExecution,
  TargetSession,
  TargetSessionCompletion,
} from '../run-scenario-types'
import { executeWithDeadline, validateCompletion } from './scenario-deadlines'
import { recordExecutionError, stampDiagnostic } from './scenario-diagnostics'
import {
  type AttemptProgress,
  attemptIdentity,
  type RecordStep,
  type SessionExecutionContext,
} from './scenario-execution-context'
import { publicStepExecution, templateStepAt } from './scenario-runtime'
import { executeStepSession } from './scenario-step-session'

interface RecordExecutionInput {
  input: ScenarioAttemptInput
  bindings: readonly ScenarioVariableBinding[]
  progress: AttemptProgress
  recordStep: RecordStep
}

export async function recordStepExecution(
  context: RecordExecutionInput,
  stepIndex: number,
  startedAt: string,
  execution: StepExecution,
): Promise<boolean> {
  const progress = context.progress
  const templateStep = templateStepAt(context.input.scenario, stepIndex)
  const projected = publicStepExecution(execution, context.bindings)
  progress.runtimeValueExposed ||= projected.runtimeValueExposed
  progress.evidenceAvailability.push(
    ...(projected.execution.evidenceAvailability ?? []),
  )
  if (context.input.signal?.aborted) {
    progress.state = 'cancelled'
    progress.message = 'Scenario cancelled during step execution'
    await context.recordStep(stepIndex, startedAt, {
      step: templateStep,
      state: progress.state,
      resolvedActions: projected.execution.resolvedActions,
      message: progress.message,
    })
    return false
  }
  await context.recordStep(stepIndex, startedAt, {
    step: templateStep,
    state: projected.execution.state,
    resolvedActions: projected.execution.resolvedActions,
    message: projected.execution.message,
    artifacts: projected.execution.artifacts?.length
      ? projected.execution.artifacts
      : undefined,
    diagnostics: projected.execution.diagnostics?.length
      ? projected.execution.diagnostics.map((entry) =>
          stampDiagnostic(entry, context.input, stepIndex, templateStep),
        )
      : undefined,
    trace: projected.execution.trace?.length
      ? projected.execution.trace
      : undefined,
  })
  if (execution.replayDiverged) {
    progress.replayDiverged = true
    progress.state = 'failed'
    progress.message = projected.execution.message
    return false
  }
  if (execution.state === 'passed') return true
  progress.state = execution.state
  progress.message = projected.execution.message
  return false
}

async function executeTargetSessionSteps(
  session: TargetSession,
  scenarioWallStartedAt: number,
  context: SessionExecutionContext,
): Promise<void> {
  if (Boolean(session.executeScenario) === Boolean(session.executeStep)) {
    recordExecutionError(
      context.progress,
      new Error(
        'Target session must provide exactly one of executeStep or executeScenario',
      ),
      context.bindings,
      context.input,
      context.latestOccurredAt(),
      undefined,
    )
    return
  }
  if (session.executeScenario) {
    await executeScenarioSession(session, context)
    return
  }
  await executeStepSession(session, scenarioWallStartedAt, context)
}

async function completeTargetSession(
  session: TargetSession,
  context: SessionExecutionContext,
): Promise<TargetSessionCompletion | undefined> {
  if (
    context.progress.state === 'cancelled' ||
    context.input.signal?.aborted ||
    !session.complete
  ) {
    return undefined
  }
  try {
    return validateCompletion(await session.complete())
  } catch (error) {
    recordExecutionError(
      context.progress,
      error,
      context.bindings,
      context.input,
      context.latestOccurredAt(),
      undefined,
    )
    return undefined
  }
}

async function closeTargetSession(
  session: TargetSession,
  context: SessionExecutionContext,
): Promise<void> {
  try {
    await session.close()
  } catch (error) {
    recordExecutionError(
      context.progress,
      error,
      context.bindings,
      context.input,
      context.latestOccurredAt(),
      undefined,
    )
  }
}

export async function executeTargetSession(
  session: TargetSession,
  scenarioWallStartedAt: number,
  context: SessionExecutionContext,
): Promise<TargetSessionCompletion | undefined> {
  try {
    await executeTargetSessionSteps(session, scenarioWallStartedAt, context)
    if (
      context.progress.state === 'infrastructure-error' ||
      context.progress.state === 'cancelled'
    ) {
      return undefined
    }
    return await completeTargetSession(session, context)
  } finally {
    await closeTargetSession(session, context)
  }
}

async function executeScenarioSession(
  session: ScenarioTargetSession,
  context: SessionExecutionContext,
): Promise<void> {
  const { bindings, emit, input, progress, recordExecution } = context
  try {
    const scenarioExecution = await executeWithDeadline(
      (operationSignal) => session.executeScenario(operationSignal),
      input.signal,
      input.timeout?.scenarioMs,
      `Scenario exceeded its ${input.timeout?.scenarioMs}ms deadline`,
    )
    if (
      scenarioExecution.stepExecutions.length > input.scenario.steps.length ||
      (!scenarioExecution.replayDiverged &&
        scenarioExecution.stepExecutions.length !== input.scenario.steps.length)
    ) {
      throw new Error(
        'Scenario execution must return one result for every Scenario step',
      )
    }
    for (const [
      stepIndex,
      execution,
    ] of scenarioExecution.stepExecutions.entries()) {
      const started = await emit({
        type: 'step-started',
        step: templateStepAt(input.scenario, stepIndex),
        ...attemptIdentity(input, stepIndex),
      })
      if (!(await recordExecution(stepIndex, started.occurredAt, execution)))
        break
    }
    if (scenarioExecution.replayDiverged) {
      progress.replayDiverged = true
      progress.state = 'failed'
      progress.message ??= 'Replay diverged from the deterministic Scenario'
    } else if (input.mode === 'replay') {
      progress.replayedStepCount = input.scenario.steps.length
    }
  } catch (error) {
    recordExecutionError(
      progress,
      error,
      bindings,
      input,
      context.latestOccurredAt(),
      input.signal,
    )
  }
}
