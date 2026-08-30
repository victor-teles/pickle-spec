import { ignoreTag } from '@pickle-spec/spec'
import { withSharedEvidenceObservations } from '../results/shared-evidence-observations'
import type {
  AttemptScenarioRun,
  RunEvent,
  ScenarioAttempt,
  ScenarioAttemptInput,
  StepExecution,
  TargetSession,
  TargetSessionCompletion,
  TestResultState,
  TestStepResult,
} from './run-scenario-types'
import { testRunSchemaVersion } from './run-scenario-types'
import { recordExecutionError } from './scenario/scenario-diagnostics'
import {
  type AttemptProgress,
  attemptIdentity,
  type EmitAttemptEvent,
  type RecordStep,
} from './scenario/scenario-execution-context'
import {
  attemptEvidence,
  createTestResult,
  durationMs,
  scenarioFinishedPayload,
} from './scenario/scenario-results'
import { nonemptyBindings } from './scenario/scenario-runtime'
import {
  executeTargetSession,
  recordStepExecution,
} from './scenario/scenario-target-session'

export * from './run-scenario-types'
export {
  createSyntheticTestResult,
  createTestResult,
  scenarioFinishedPayload,
  withFinalAttempt,
} from './scenario/scenario-results'

interface InitialAttemptOutcome {
  state: 'skipped' | 'cancelled'
  message: string
}

function initialAttemptOutcome(
  input: ScenarioAttemptInput,
): InitialAttemptOutcome | undefined {
  if (input.scenario.tags.includes(ignoreTag)) {
    return { state: 'skipped', message: 'Scenario is tagged @ignore' }
  }
  if (input.signal?.aborted) {
    return {
      state: 'cancelled',
      message: 'Scenario cancelled before the logical session started',
    }
  }
  return undefined
}

interface FinishAttemptInput {
  input: ScenarioAttemptInput
  now: () => Date
  scenarioStartedAt: string
  events: RunEvent[]
  completion: TargetSessionCompletion | undefined
  progress: AttemptProgress
  emit: EmitAttemptEvent
  state: TestResultState
  steps: TestStepResult[]
  message?: string
}

async function finishAttempt(
  context: FinishAttemptInput,
): Promise<AttemptScenarioRun> {
  const finishedAt = context.now().toISOString()
  const attempt: ScenarioAttempt = {
    attempt: context.input.attempt,
    startedAt: context.scenarioStartedAt,
    finishedAt,
    durationMs: durationMs(context.scenarioStartedAt, finishedAt),
    state: context.state,
    steps: context.steps,
    executionMode: context.progress.adaptiveEvaluated
      ? 'adaptive'
      : context.input.mode,
    inferenceCount: context.completion?.inferenceCount ?? 0,
    ...(context.input.adapter.fidelityPolicy
      ? { fidelityPolicy: context.input.adapter.fidelityPolicy }
      : {}),
    ...(context.message !== undefined ? { message: context.message } : {}),
    ...(context.progress.diagnostics.length > 0
      ? { diagnostics: context.progress.diagnostics }
      : {}),
    evidenceAvailability: attemptEvidence(
      context.input,
      context.steps,
      context.progress.evidenceAvailability,
      context.progress.diagnostics,
    ),
  }
  const result = createTestResult(context.input, [attempt])
  await context.emit(scenarioFinishedPayload(result), finishedAt)
  return {
    events: context.events,
    result,
    attempt,
    completion: context.completion,
    replayDiverged: context.progress.replayDiverged,
    runtimeValueExposed: context.progress.runtimeValueExposed,
    replayedStepCount: context.progress.replayedStepCount,
    adaptiveEvaluated: context.progress.adaptiveEvaluated,
  }
}

function createAttemptEmitter(
  input: ScenarioAttemptInput,
  now: () => Date,
  events: RunEvent[],
): EmitAttemptEvent {
  let sequence = 0
  return async (event, occurredAt = now().toISOString()) => {
    const versionedEvent = withSharedEvidenceObservations({
      ...event,
      schemaVersion: testRunSchemaVersion,
      sequence: ++sequence,
      occurredAt,
    } as RunEvent)
    events.push(versionedEvent)
    await input.onEvent?.(versionedEvent)
    return versionedEvent
  }
}

function initialAttemptProgress(): AttemptProgress {
  return {
    state: 'passed',
    replayDiverged: false,
    runtimeValueExposed: false,
    evidenceAvailability: [],
    diagnostics: [],
    replayedStepCount: 0,
    adaptiveEvaluated: false,
  }
}

function openAttemptSession(
  input: ScenarioAttemptInput,
): Promise<TargetSession> {
  return input.adapter.openSession({
    executionTargetProfile: input.executionTargetProfile,
    specification: input.specification,
    scenario: input.scenario,
    mode: input.mode,
    executionCache: input.cacheEntry
      ? {
          adapterPayload: input.cacheEntry.adapterPayload,
          requiredVariables: input.cacheEntry.requiredVariables,
        }
      : undefined,
    scenarioTemplate: input.scenario.template,
    runtimeBindings: input.scenario.runtimeBindings,
    signal: input.signal,
  })
}

function createStepRecorder(
  input: ScenarioAttemptInput,
  now: () => Date,
  emit: EmitAttemptEvent,
  steps: TestStepResult[],
): RecordStep {
  return async (stepIndex, startedAt, result) => {
    const finishedAt = now().toISOString()
    const timedResult: TestStepResult = {
      ...result,
      index: stepIndex,
      startedAt,
      finishedAt,
      durationMs: durationMs(startedAt, finishedAt),
    }
    steps.push(timedResult)
    await emit(
      {
        type: 'step-finished',
        result: timedResult,
        ...attemptIdentity(input, stepIndex),
      },
      finishedAt,
    )
  }
}

interface ExecuteOpenedAttemptInput {
  emit: EmitAttemptEvent
  events: RunEvent[]
  input: ScenarioAttemptInput
  now: () => Date
  progress: AttemptProgress
  scenarioStartedAt: string
  scenarioWallStartedAt: number
  session: TargetSession
}

async function startScenarioAttempt(
  input: ScenarioAttemptInput,
  emit: EmitAttemptEvent,
): Promise<string> {
  const started = await emit({
    type: 'scenario-started',
    ...attemptIdentity(input),
  })
  return started.occurredAt
}

async function executeOpenedAttempt(context: ExecuteOpenedAttemptInput) {
  const {
    emit,
    events,
    input,
    now,
    progress,
    scenarioStartedAt,
    scenarioWallStartedAt,
    session,
  } = context
  const steps: TestStepResult[] = []
  const recordStep = createStepRecorder(input, now, emit, steps)
  progress.state = input.signal?.aborted ? 'cancelled' : 'passed'
  progress.message = input.signal?.aborted
    ? 'Scenario cancelled before step execution started'
    : undefined
  const bindings = nonemptyBindings(input.scenario.runtimeBindings)
  const recordExecution = (
    stepIndex: number,
    startedAt: string,
    execution: StepExecution,
  ) =>
    recordStepExecution(
      { input, bindings, progress, recordStep },
      stepIndex,
      startedAt,
      execution,
    )
  const completion = await executeTargetSession(
    session,
    scenarioWallStartedAt,
    {
      input,
      bindings,
      progress,
      latestOccurredAt: () => events.at(-1)?.occurredAt ?? scenarioStartedAt,
      emit,
      recordExecution,
      recordStep,
    },
  )
  return { completion, steps }
}

export async function runScenarioAttempt(
  input: ScenarioAttemptInput,
): Promise<AttemptScenarioRun> {
  const now = input.now ?? (() => new Date())
  const scenarioWallStartedAt = Date.now()
  const events: RunEvent[] = []
  const emit = createAttemptEmitter(input, now, events)

  let completion: TargetSessionCompletion | undefined
  const progress = initialAttemptProgress()
  const scenarioStartedAt = await startScenarioAttempt(input, emit)

  const finish = async (
    state: TestResultState,
    steps: TestStepResult[],
    message?: string,
  ): Promise<AttemptScenarioRun> =>
    finishAttempt({
      input,
      now,
      scenarioStartedAt,
      events,
      completion,
      progress,
      emit,
      state,
      steps,
      message,
    })

  const initialOutcome = initialAttemptOutcome(input)
  if (initialOutcome)
    return finish(initialOutcome.state, [], initialOutcome.message)

  let session: TargetSession
  try {
    session = await openAttemptSession(input)
  } catch (error) {
    const bindings = nonemptyBindings(input.scenario.runtimeBindings)
    recordExecutionError(
      progress,
      error,
      bindings,
      input,
      scenarioStartedAt,
      input.signal,
    )
    return finish(progress.state, [], progress.message)
  }

  const executed = await executeOpenedAttempt({
    emit,
    events,
    input,
    now,
    progress,
    scenarioStartedAt,
    scenarioWallStartedAt,
    session,
  })
  completion = executed.completion

  return finish(progress.state, executed.steps, progress.message)
}
