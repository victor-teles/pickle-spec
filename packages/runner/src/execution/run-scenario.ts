import {
  ignoreTag,
  type ScenarioStep,
  type ScenarioVariableBinding,
} from '@pickle-spec/spec'
import { persistedEvidenceKinds } from '../evidence/evidence'
import type { ExecutionCacheEnvelope } from '../execution-cache/execution-cache'
import type {
  DiagnosticEntry,
  EvidenceAvailability,
  ExecutionMode,
  ExecutionTimeouts,
  RunEvent,
  RunEventPayload,
  RunEventScope,
  RunScenarioInput,
  ScenarioAttempt,
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
import { evidenceKinds, testRunSchemaVersion } from './run-scenario-types'
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
  attempt: number
  cacheEntry?: ExecutionCacheEnvelope
}

export interface AttemptScenarioRun extends ScenarioRun {
  attempt: ScenarioAttempt
  completion?: TargetSessionCompletion
  replayDiverged: boolean
  runtimeValueExposed: boolean
}

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

function stampDiagnostic(
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

function runnerDiagnostic(
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

const evidenceCapabilities = {
  screenshot: 'screenshots',
  trace: 'traces',
  recording: 'recordings',
  'device-log': 'device-logs',
  diagnostics: 'diagnostics',
} as const

function attemptEvidence(
  input: ScenarioAttemptInput,
  steps: readonly TestStepResult[],
  reported: readonly EvidenceAvailability[] = [],
  diagnostics: readonly DiagnosticEntry[] = [],
): EvidenceAvailability[] {
  const available = persistedEvidenceKinds(steps, diagnostics)
  const capabilities = new Set(
    input.executionTargetProfile.capabilities ?? input.adapter.capabilities,
  )
  return evidenceKinds.map((kind) => {
    if (available.has(kind)) {
      return { kind, state: 'available' }
    }
    const adapterAvailability = reported.findLast(
      (availability) => availability.kind === kind,
    )
    return (
      adapterAvailability ?? {
        kind,
        state: capabilities.has(evidenceCapabilities[kind])
          ? 'not-requested'
          : 'not-supported',
      }
    )
  })
}

export function createTestResult(
  input: ScenarioAttemptInput,
  attempts: ScenarioAttempt[],
): TestResult {
  const first = attempts[0]
  const final = attempts.at(-1)
  if (!first || !final) {
    throw new Error('A Test result requires at least one Scenario attempt')
  }
  const scenarioId = scenarioDefinitionId(input.specification, input.scenario)
  return {
    schemaVersion: testRunSchemaVersion,
    specification: {
      name: input.specification.name,
      uri: input.specification.source.uri,
    },
    scenario: { ...scenarioIdentity(input.scenario), id: scenarioId },
    executionTargetProfile: input.executionTargetProfile,
    state: final.state,
    startedAt: first.startedAt,
    finishedAt: final.finishedAt,
    durationMs: durationMs(first.startedAt, final.finishedAt),
    attempts,
    ...(attempts.length > 1 && final.state === 'passed' ? { flaky: true } : {}),
  }
}

export function createSyntheticTestResult(
  input: RunScenarioInput,
  mode: ExecutionMode,
  state: TestResultState,
  message?: string,
): TestResult {
  const occurredAt = (input.now ?? (() => new Date()))().toISOString()
  const attemptInput: ScenarioAttemptInput = {
    ...input,
    mode,
    attempt: 1,
  }
  const attempt: ScenarioAttempt = {
    attempt: 1,
    startedAt: occurredAt,
    finishedAt: occurredAt,
    durationMs: 0,
    state,
    steps: [],
    executionMode: mode,
    inferenceCount: 0,
    ...(input.adapter.fidelityPolicy
      ? { fidelityPolicy: input.adapter.fidelityPolicy }
      : {}),
    ...(message !== undefined ? { message } : {}),
    evidenceAvailability: attemptEvidence(attemptInput, []),
  }
  return createTestResult(attemptInput, [attempt])
}

export function withFinalAttempt(
  result: TestResult,
  update: Partial<ScenarioAttempt>,
): TestResult {
  const attempts = result.attempts.map((attempt, index) =>
    index === result.attempts.length - 1 ? { ...attempt, ...update } : attempt,
  )
  const final = attempts.at(-1)!
  return {
    ...result,
    state: final.state,
    finishedAt: final.finishedAt,
    durationMs: durationMs(result.startedAt, final.finishedAt),
    attempts,
    flaky: attempts.length > 1 && final.state === 'passed' ? true : undefined,
  }
}

export function scenarioFinishedPayload(result: TestResult): RunEventPayload {
  const attempt = result.attempts.at(-1)
  if (!attempt) throw new Error('A Test result requires a Scenario attempt')
  return {
    type: 'scenario-finished',
    specification: result.specification,
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
    scope: {
      scenarioId: result.scenario.id!,
      examplesRowId: result.scenario.examplesRowId,
      executionTargetProfileId: result.executionTargetProfile.id,
      attempt: attempt.attempt,
    },
    attempt,
  }
}

function attemptIdentity(input: ScenarioAttemptInput, stepIndex?: number) {
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

function durationMs(startedAt: string, finishedAt: string): number {
  return Math.max(0, Date.parse(finishedAt) - Date.parse(startedAt))
}

interface AttemptProgress {
  state: TestResultState
  message?: string
  replayDiverged: boolean
  runtimeValueExposed: boolean
  evidenceAvailability: EvidenceAvailability[]
  diagnostics: DiagnosticEntry[]
}

type EmitAttemptEvent = (
  event: RunEventPayload,
  occurredAt?: string,
) => Promise<RunEvent>
type RecordExecution = (
  stepIndex: number,
  startedAt: string,
  execution: StepExecution,
) => Promise<boolean>
type UntimedTestStepResult = Omit<
  TestStepResult,
  'index' | 'startedAt' | 'finishedAt' | 'durationMs'
>
type RecordStep = (
  stepIndex: number,
  startedAt: string,
  result: UntimedTestStepResult,
) => Promise<void>

interface SessionExecutionContext {
  input: ScenarioAttemptInput
  bindings: readonly ScenarioVariableBinding[]
  progress: AttemptProgress
  latestOccurredAt: () => string
  emit: EmitAttemptEvent
  recordExecution: RecordExecution
  recordStep: RecordStep
}

function recordExecutionError(
  progress: AttemptProgress,
  error: unknown,
  bindings: readonly ScenarioVariableBinding[],
  input: ScenarioAttemptInput,
  occurredAt: string,
  signal?: AbortSignal,
  stepIndex?: number,
): void {
  const rawMessage = errorMessage(error)
  progress.runtimeValueExposed ||= stringContainsBinding(rawMessage, bindings)
  progress.state = isCancellation(error, signal)
    ? 'cancelled'
    : 'infrastructure-error'
  progress.message = redactString(rawMessage, bindings)
  progress.diagnostics.push(
    runnerDiagnostic(
      input,
      progress.message,
      occurredAt,
      stepIndex,
      stepIndex === undefined
        ? undefined
        : templateStepAt(input.scenario, stepIndex),
    ),
  )
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
    const started = await emit({
      type: 'step-started',
      step: templateStep,
      ...attemptIdentity(input, stepIndex),
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
      recordExecutionError(
        progress,
        error,
        bindings,
        input,
        started.occurredAt,
        input.signal,
        stepIndex,
      )
      await recordStep(stepIndex, started.occurredAt, {
        step: templateStep,
        state: progress.state,
        resolvedActions: [],
        message: progress.message,
      })
      break
    }
    if (!(await recordExecution(stepIndex, started.occurredAt, execution)))
      break
  }
}

export async function runScenarioAttempt(
  input: ScenarioAttemptInput,
): Promise<AttemptScenarioRun> {
  const now = input.now ?? (() => new Date())
  const scenarioWallStartedAt = Date.now()
  const events: RunEvent[] = []
  let sequence = 0
  const emit = async (
    event: RunEventPayload,
    occurredAt = now().toISOString(),
  ): Promise<RunEvent> => {
    const versionedEvent = {
      ...event,
      schemaVersion: testRunSchemaVersion,
      sequence: ++sequence,
      occurredAt,
    } as RunEvent
    events.push(versionedEvent)
    await input.onEvent?.(versionedEvent)
    return versionedEvent
  }

  let completion: TargetSessionCompletion | undefined
  const progress: AttemptProgress = {
    state: 'passed',
    replayDiverged: false,
    runtimeValueExposed: false,
    evidenceAvailability: [],
    diagnostics: [],
  }
  const started = await emit({
    type: 'scenario-started',
    ...attemptIdentity(input),
  })
  const scenarioStartedAt = started.occurredAt

  const finish = async (
    state: TestResultState,
    steps: TestStepResult[],
    message?: string,
  ): Promise<AttemptScenarioRun> => {
    const finishedAt = now().toISOString()
    const attempt: ScenarioAttempt = {
      attempt: input.attempt,
      startedAt: scenarioStartedAt,
      finishedAt,
      durationMs: durationMs(scenarioStartedAt, finishedAt),
      state,
      steps,
      executionMode: input.mode,
      inferenceCount: completion?.inferenceCount ?? 0,
      ...(input.adapter.fidelityPolicy
        ? { fidelityPolicy: input.adapter.fidelityPolicy }
        : {}),
      ...(message !== undefined ? { message } : {}),
      ...(progress.diagnostics.length > 0
        ? { diagnostics: progress.diagnostics }
        : {}),
      evidenceAvailability: attemptEvidence(
        input,
        steps,
        progress.evidenceAvailability,
        progress.diagnostics,
      ),
    }
    const result = createTestResult(input, [attempt])
    await emit(scenarioFinishedPayload(result), finishedAt)
    return {
      events,
      result,
      attempt,
      completion,
      replayDiverged: progress.replayDiverged,
      runtimeValueExposed: progress.runtimeValueExposed,
    }
  }

  const initialOutcome = initialAttemptOutcome(input)
  if (initialOutcome)
    return finish(initialOutcome.state, [], initialOutcome.message)

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

  const steps: TestStepResult[] = []
  const recordStep: RecordStep = async (stepIndex, startedAt, result) => {
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
  progress.state = input.signal?.aborted ? 'cancelled' : 'passed'
  progress.message = input.signal?.aborted
    ? 'Scenario cancelled before step execution started'
    : undefined
  const bindings = nonemptyBindings(input.scenario.runtimeBindings)

  const recordExecution = async (
    stepIndex: number,
    startedAt: string,
    execution: StepExecution,
  ): Promise<boolean> => {
    const templateStep = templateStepAt(input.scenario, stepIndex)
    const projected = publicStepExecution(execution, bindings)
    progress.runtimeValueExposed ||= projected.runtimeValueExposed
    progress.evidenceAvailability.push(
      ...(projected.execution.evidenceAvailability ?? []),
    )
    if (input.signal?.aborted) {
      progress.state = 'cancelled'
      progress.message = 'Scenario cancelled during step execution'
      await recordStep(stepIndex, startedAt, {
        step: templateStep,
        state: progress.state,
        resolvedActions: projected.execution.resolvedActions,
        message: progress.message,
      })
      return false
    }
    await recordStep(stepIndex, startedAt, {
      step: templateStep,
      state: projected.execution.state,
      resolvedActions: projected.execution.resolvedActions,
      message: projected.execution.message,
      artifacts: projected.execution.artifacts?.length
        ? projected.execution.artifacts
        : undefined,
      diagnostics: projected.execution.diagnostics?.length
        ? projected.execution.diagnostics.map((entry) =>
            stampDiagnostic(entry, input, stepIndex, templateStep),
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
    latestOccurredAt: () => events.at(-1)?.occurredAt ?? scenarioStartedAt,
    emit,
    recordExecution,
    recordStep,
  }

  try {
    if (Boolean(session.executeScenario) === Boolean(session.executeStep)) {
      recordExecutionError(
        progress,
        new Error(
          'Target session must provide exactly one of executeStep or executeScenario',
        ),
        bindings,
        input,
        executionContext.latestOccurredAt(),
        undefined,
      )
    } else if (session.executeScenario) {
      await executeScenarioSession(session, executionContext)
    } else {
      await executeStepSession(session, scenarioWallStartedAt, executionContext)
    }
    if (
      progress.state === 'passed' &&
      !input.signal?.aborted &&
      session.complete
    ) {
      try {
        completion = validateCompletion(await session.complete())
      } catch (error) {
        recordExecutionError(
          progress,
          error,
          bindings,
          input,
          executionContext.latestOccurredAt(),
          undefined,
        )
      }
    }
  } finally {
    try {
      await session.close()
    } catch (error) {
      recordExecutionError(
        progress,
        error,
        bindings,
        input,
        executionContext.latestOccurredAt(),
        undefined,
      )
    }
  }

  return finish(progress.state, steps, progress.message)
}
