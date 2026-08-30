import type { ScenarioStep } from '@pickle-spec/spec'
import {
  cachedStepPrefixFrom,
  evaluationAt,
  type GapCursor,
  gapCursor,
  reseatGap,
} from '../../execution-cache/cached-step-prefix'
import type {
  ActionEvidence,
  ActionEvidenceInput,
  ExecutionCachePolicy,
  ScenarioAttemptInput,
  StepEvaluation,
  StepExecution,
  StepTargetSession,
} from '../run-scenario-types'
import { executeWithDeadline, stepDeadline } from './scenario-deadlines'
import { recordExecutionError } from './scenario-diagnostics'
import {
  attemptIdentity,
  type SessionExecutionContext,
} from './scenario-execution-context'
import { publicActionEvidence, templateStepAt } from './scenario-runtime'

async function executeEvaluatedStep(input: {
  session: StepTargetSession
  scenarioStartedAt: number
  context: SessionExecutionContext
  stepIndex: number
  step: ScenarioStep
  templateStep: ScenarioStep
  evaluation: StepEvaluation
  startedAt: string
  recordAction: (input: ActionEvidenceInput) => Promise<ActionEvidence>
}): Promise<StepExecution | undefined> {
  const { bindings, progress, recordStep } = input.context
  try {
    const deadline = stepDeadline(
      input.context.input.timeout,
      input.scenarioStartedAt,
    )
    return await executeWithDeadline(
      (operationSignal) =>
        input.session.executeStep(input.step, operationSignal, {
          stepIndex: input.stepIndex,
          templateStep: input.templateStep,
          runtimeBindings: input.context.input.scenario.runtimeBindings ?? [],
          evaluation: input.evaluation,
          recordAction: input.recordAction,
        }),
      input.context.input.signal,
      deadline.timeoutMs,
      deadline.timeoutMessage,
    )
  } catch (error) {
    recordExecutionError(
      progress,
      error,
      bindings,
      input.context.input,
      input.startedAt,
      input.context.input.signal,
      input.stepIndex,
    )
    await recordStep(input.stepIndex, input.startedAt, {
      step: input.templateStep,
      state: progress.state,
      resolvedActions: [],
      message: progress.message,
    })
    return undefined
  }
}

function gherkinSourceEvidence(
  input: ScenarioAttemptInput,
  stepIndex: number,
): ActionEvidence['source'] {
  const step = templateStepAt(input.scenario, stepIndex)
  return {
    uri: input.specification.source.uri,
    language: input.specification.source.language,
    line: step.source?.line,
    column: step.source?.column,
    excerpt: step.source?.excerpt ?? `${step.keyword} ${step.text}`.trim(),
  }
}

function createActionRecorder(
  context: SessionExecutionContext,
  stepIndex: number,
): (input: ActionEvidenceInput) => Promise<ActionEvidence> {
  let ordinal = 0
  return async (input) => {
    const actionOrdinal = ordinal++
    const action = publicActionEvidence(
      input,
      {
        id: `step-${stepIndex + 1}-action-${actionOrdinal + 1}`,
        ordinal: actionOrdinal,
        source: gherkinSourceEvidence(context.input, stepIndex),
      },
      context.bindings,
    )
    const emitted = await context.emit(
      {
        type: 'action-finished',
        action,
        ...attemptIdentity(context.input, stepIndex),
      },
      action.finishedAt,
    )
    return emitted.type === 'action-finished' ? emitted.action : action
  }
}

async function advanceGapStep(input: {
  session: StepTargetSession
  scenarioStartedAt: number
  context: SessionExecutionContext
  stepIndex: number
  step: ScenarioStep
  cursor: GapCursor
  cachePolicy: ExecutionCachePolicy
}): Promise<{ cursor: GapCursor; stop: boolean }> {
  const { context, stepIndex } = input
  const { emit, input: attempt, progress, recordExecution } = context
  if (attempt.signal?.aborted) {
    progress.state = 'cancelled'
    progress.message = 'Scenario cancelled before the next step started'
    return { cursor: input.cursor, stop: true }
  }
  const templateStep = templateStepAt(attempt.scenario, stepIndex)
  const started = await emit({
    type: 'step-started',
    step: templateStep,
    ...attemptIdentity(attempt, stepIndex),
  })
  let evaluation = evaluationAt(input.cursor, stepIndex)
  if (evaluation === 'adaptive') progress.adaptiveEvaluated = true
  const stepInput = {
    session: input.session,
    scenarioStartedAt: input.scenarioStartedAt,
    context,
    stepIndex,
    step: input.step,
    templateStep,
    startedAt: started.occurredAt,
    recordAction: createActionRecorder(context, stepIndex),
  }
  let execution = await executeEvaluatedStep({ ...stepInput, evaluation })
  if (!execution) return { cursor: input.cursor, stop: true }
  let cursor = input.cursor
  if (
    evaluation === 'replay' &&
    execution.replayDiverged &&
    input.cachePolicy !== 'cache-only'
  ) {
    cursor = reseatGap(cursor, stepIndex)
    evaluation = 'adaptive'
    progress.adaptiveEvaluated = true
    execution = await executeEvaluatedStep({ ...stepInput, evaluation })
    if (!execution) return { cursor, stop: true }
  }
  const recorded = await recordExecution(
    stepIndex,
    started.occurredAt,
    execution,
  )
  return { cursor, stop: !recorded }
}

export async function executeStepSession(
  session: StepTargetSession,
  scenarioStartedAt: number,
  context: SessionExecutionContext,
): Promise<void> {
  const { input, progress } = context
  const adapter = input.adapter.executionCache
  const prefix =
    input.cacheEntry && adapter
      ? cachedStepPrefixFrom(
          input.cacheEntry,
          input.scenario.steps.length,
          adapter,
        )
      : undefined
  let cursor = gapCursor(prefix)
  const cachePolicy = input.cachePolicy ?? 'prefer-cache'
  for (const [stepIndex, step] of input.scenario.steps.entries()) {
    const advanced = await advanceGapStep({
      session,
      scenarioStartedAt,
      context,
      stepIndex,
      step,
      cursor,
      cachePolicy,
    })
    cursor = advanced.cursor
    if (advanced.stop) break
  }
  progress.replayedStepCount = cursor.replayUntil
}
