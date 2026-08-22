import { ignoreTag, type ScenarioVariableBinding } from '@pickle-spec/spec'
import type { ExecutionCacheEnvelope } from './execution-cache'
import type {
  ExecutionMode,
  ExecutionTimeouts,
  RunEvent,
  RunEventPayload,
  RunScenarioInput,
  ScenarioRun,
  ScenarioTargetSession,
  StepExecution,
  StepTargetSession,
  TargetSession,
  TargetSessionCompletion,
  TestResult,
  TestResultState,
  TestStepResult,
} from './run-scenario-types'
import {
  nonemptyBindings,
  publicStepExecution,
  redactString,
  scenarioDefinitionId,
  scenarioIdentity,
  stringContainsBinding,
  templateStepAt,
} from './scenario-runtime'

export * from './run-scenario-types'

class ExecutionDeadlineError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ExecutionDeadlineError'
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return (
    Boolean(signal?.aborted) ||
    (error instanceof Error && error.name === 'AbortError')
  )
}

function validateCompletion(
  completion: TargetSessionCompletion,
): TargetSessionCompletion {
  if (
    !Number.isSafeInteger(completion.inferenceCount) ||
    completion.inferenceCount < 0
  ) {
    throw new Error(
      'Target session completion requires a non-negative integer inferenceCount',
    )
  }
  return completion
}

function executeWithDeadline<T>(
  operation: (signal?: AbortSignal) => Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
  timeoutMessage: string,
): Promise<T> {
  if (timeoutMs === undefined) return operation(signal)

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort()
      reject(new ExecutionDeadlineError(timeoutMessage))
    }, timeoutMs)
    operation(controller.signal)
      .then(resolve, reject)
      .finally(() => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', onAbort)
      })
  })
}

function stepDeadline(
  timeout: ExecutionTimeouts | undefined,
  scenarioStartedAt: number,
): { timeoutMs: number | undefined; timeoutMessage: string } {
  const scenarioRemaining =
    timeout?.scenarioMs === undefined
      ? undefined
      : timeout.scenarioMs - (Date.now() - scenarioStartedAt)
  const usesScenarioDeadline =
    scenarioRemaining !== undefined &&
    (timeout?.stepMs === undefined || scenarioRemaining <= timeout.stepMs)
  return {
    timeoutMs: usesScenarioDeadline
      ? Math.max(0, scenarioRemaining)
      : timeout?.stepMs,
    timeoutMessage: usesScenarioDeadline
      ? `Scenario exceeded its ${timeout?.scenarioMs}ms deadline`
      : `Step exceeded its ${timeout?.stepMs}ms deadline`,
  }
}

export interface ScenarioAttemptInput extends RunScenarioInput {
  mode: ExecutionMode
  cacheEntry?: ExecutionCacheEnvelope
}

export interface AttemptScenarioRun extends ScenarioRun {
  completion?: TargetSessionCompletion
  replayDiverged: boolean
  runtimeValueExposed: boolean
}

export function withAttemptMetadata(
  result: TestResult,
  attempt: number,
): TestResult {
  if (attempt === 1) return result
  return {
    ...result,
    attempts: attempt,
    flaky: result.state === 'passed',
  }
}

export function createTestResult(
  input: ScenarioAttemptInput,
  state: TestResultState,
  steps: TestStepResult[],
  durationMs: number,
  message?: string,
): TestResult {
  const scenarioId = scenarioDefinitionId(input.specification, input.scenario)
  return {
    schemaVersion: 1,
    specification: {
      name: input.specification.name,
      uri: input.specification.source.uri,
    },
    scenario: { ...scenarioIdentity(input.scenario), id: scenarioId },
    executionTargetProfile: input.executionTargetProfile,
    state,
    steps,
    executionMode: input.mode,
    durationMs,
    ...(input.adapter.fidelityPolicy
      ? { fidelityPolicy: input.adapter.fidelityPolicy }
      : {}),
    ...(message !== undefined ? { message } : {}),
  }
}

function attemptIdentity(input: ScenarioAttemptInput) {
  return {
    scenario: {
      ...scenarioIdentity(input.scenario),
      id: scenarioDefinitionId(input.specification, input.scenario),
    },
    executionTargetProfile: input.executionTargetProfile,
  }
}

interface AttemptProgress {
  state: TestResultState
  message?: string
  replayDiverged: boolean
  runtimeValueExposed: boolean
}

type EmitAttemptEvent = (event: RunEventPayload) => Promise<void>
type RecordExecution = (
  stepIndex: number,
  execution: StepExecution,
) => Promise<boolean>
type RecordStep = (result: TestStepResult) => Promise<void>

interface SessionExecutionContext {
  input: ScenarioAttemptInput
  bindings: readonly ScenarioVariableBinding[]
  progress: AttemptProgress
  emit: EmitAttemptEvent
  recordExecution: RecordExecution
  recordStep: RecordStep
}

function recordExecutionError(
  progress: AttemptProgress,
  error: unknown,
  bindings: readonly ScenarioVariableBinding[],
  signal?: AbortSignal,
): void {
  const rawMessage = errorMessage(error)
  progress.runtimeValueExposed ||= stringContainsBinding(rawMessage, bindings)
  progress.state = isCancellation(error, signal)
    ? 'cancelled'
    : 'infrastructure-error'
  progress.message = redactString(rawMessage, bindings)
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
      await emit({
        type: 'step-started',
        step: templateStepAt(input.scenario, stepIndex),
        ...attemptIdentity(input),
      })
      if (!(await recordExecution(stepIndex, execution))) break
    }
    if (scenarioExecution.replayDiverged) {
      progress.replayDiverged = true
      progress.state = 'failed'
      progress.message ??= 'Replay diverged from the deterministic Scenario'
    }
  } catch (error) {
    recordExecutionError(progress, error, bindings, input.signal)
  }
}

async function executeStepSession(
  session: StepTargetSession,
  scenarioStartedAt: number,
  context: SessionExecutionContext,
): Promise<void> {
  const { bindings, emit, input, progress, recordExecution, recordStep } =
    context
  for (const [stepIndex, step] of input.scenario.steps.entries()) {
    if (input.signal?.aborted) {
      progress.state = 'cancelled'
      progress.message = 'Scenario cancelled before the next step started'
      break
    }

    const templateStep = templateStepAt(input.scenario, stepIndex)
    await emit({
      type: 'step-started',
      step: templateStep,
      ...attemptIdentity(input),
    })
    let execution: StepExecution
    try {
      const deadline = stepDeadline(input.timeout, scenarioStartedAt)
      execution = await executeWithDeadline(
        (operationSignal) =>
          session.executeStep(step, operationSignal, {
            stepIndex,
            templateStep,
            runtimeBindings: input.scenario.runtimeBindings ?? [],
          }),
        input.signal,
        deadline.timeoutMs,
        deadline.timeoutMessage,
      )
    } catch (error) {
      recordExecutionError(progress, error, bindings, input.signal)
      await recordStep({
        step: templateStep,
        state: progress.state,
        resolvedActions: [],
        message: progress.message,
      })
      break
    }
    if (!(await recordExecution(stepIndex, execution))) break
  }
}

export async function runScenarioAttempt(
  input: ScenarioAttemptInput,
): Promise<AttemptScenarioRun> {
  const scenarioStartedAt = Date.now()
  const events: RunEvent[] = []
  let sequence = 0
  const emit = async (event: RunEventPayload): Promise<void> => {
    const versionedEvent = {
      ...event,
      schemaVersion: 1 as const,
      sequence: ++sequence,
    } as RunEvent
    events.push(versionedEvent)
    await input.onEvent?.(versionedEvent)
  }

  let completion: TargetSessionCompletion | undefined
  const progress: AttemptProgress = {
    state: 'passed',
    replayDiverged: false,
    runtimeValueExposed: false,
  }
  const finish = async (
    state: TestResultState,
    steps: TestStepResult[],
    message?: string,
  ): Promise<AttemptScenarioRun> => {
    const result = createTestResult(
      input,
      state,
      steps,
      Math.max(0, Date.now() - scenarioStartedAt),
      message,
    )
    await emit({ type: 'scenario-finished', result })
    return {
      events,
      result,
      completion,
      replayDiverged: progress.replayDiverged,
      runtimeValueExposed: progress.runtimeValueExposed,
    }
  }

  await emit({
    type: 'scenario-started',
    ...attemptIdentity(input),
  })

  if (input.scenario.tags.includes(ignoreTag)) {
    return finish('skipped', [], 'Scenario is tagged @ignore')
  }

  if (input.signal?.aborted) {
    return finish(
      'cancelled',
      [],
      'Scenario cancelled before the logical session started',
    )
  }

  let session: TargetSession
  try {
    session = await input.adapter.openSession({
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
  } catch (error) {
    const bindings = nonemptyBindings(input.scenario.runtimeBindings)
    const rawMessage = errorMessage(error)
    progress.runtimeValueExposed ||= stringContainsBinding(rawMessage, bindings)
    return finish(
      isCancellation(error, input.signal)
        ? 'cancelled'
        : 'infrastructure-error',
      [],
      redactString(rawMessage, bindings),
    )
  }

  const steps: TestStepResult[] = []
  const recordStep = async (result: TestStepResult): Promise<void> => {
    steps.push(result)
    await emit({ type: 'step-finished', result, ...attemptIdentity(input) })
  }
  progress.state = input.signal?.aborted ? 'cancelled' : 'passed'
  progress.message = input.signal?.aborted
    ? 'Scenario cancelled before step execution started'
    : undefined
  const bindings = nonemptyBindings(input.scenario.runtimeBindings)

  const recordExecution = async (
    stepIndex: number,
    execution: StepExecution,
  ): Promise<boolean> => {
    const templateStep = templateStepAt(input.scenario, stepIndex)
    const projected = publicStepExecution(execution, bindings)
    progress.runtimeValueExposed ||= projected.runtimeValueExposed
    if (input.signal?.aborted) {
      progress.state = 'cancelled'
      progress.message = 'Scenario cancelled during step execution'
      await recordStep({
        step: templateStep,
        state: progress.state,
        resolvedActions: projected.execution.resolvedActions,
        message: progress.message,
      })
      return false
    }
    await recordStep({
      step: templateStep,
      state: projected.execution.state,
      resolvedActions: projected.execution.resolvedActions,
      message: projected.execution.message,
      artifacts: projected.execution.artifacts?.length
        ? projected.execution.artifacts
        : undefined,
    })

    if (execution.replayDiverged) {
      progress.replayDiverged = true
      progress.state = 'failed'
      progress.message = projected.execution.message
      return false
    }
    if (execution.state !== 'passed') {
      progress.state = execution.state
      progress.message = projected.execution.message
      return false
    }
    return true
  }

  const executionContext: SessionExecutionContext = {
    input,
    bindings,
    progress,
    emit,
    recordExecution,
    recordStep,
  }

  try {
    if (Boolean(session.executeScenario) === Boolean(session.executeStep)) {
      progress.state = 'infrastructure-error'
      progress.message =
        'Target session must provide exactly one of executeStep or executeScenario'
    } else if (session.executeScenario) {
      await executeScenarioSession(session, executionContext)
    } else {
      await executeStepSession(session, scenarioStartedAt, executionContext)
    }
    if (
      progress.state === 'passed' &&
      !input.signal?.aborted &&
      session.complete
    ) {
      try {
        completion = validateCompletion(await session.complete())
      } catch (error) {
        const rawMessage = errorMessage(error)
        progress.runtimeValueExposed ||= stringContainsBinding(
          rawMessage,
          bindings,
        )
        progress.state = 'infrastructure-error'
        progress.message = redactString(rawMessage, bindings)
      }
    }
  } finally {
    try {
      await session.close()
    } catch (error) {
      const bindings = nonemptyBindings(input.scenario.runtimeBindings)
      const rawMessage = errorMessage(error)
      progress.runtimeValueExposed ||= stringContainsBinding(
        rawMessage,
        bindings,
      )
      progress.state = 'infrastructure-error'
      progress.message = redactString(rawMessage, bindings)
    }
  }

  return finish(progress.state, steps, progress.message)
}
