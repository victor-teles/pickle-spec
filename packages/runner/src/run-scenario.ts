import {
  ignoreTag,
  resolveScenarioId,
  type Scenario,
  type ScenarioStep,
  type ScenarioTemplate,
  type ScenarioVariableBinding,
  type Specification,
  scenarioRevision,
} from '@pickle-spec/spec'
import type {
  CacheOutcome,
  ExecutionCacheAdapter,
  ExecutionCacheEnvelope,
  ExecutionCacheKey,
  ExecutionCacheStore,
  ExecutionCacheUncacheableReason,
} from './execution-cache'
import {
  type ExecutionPlan,
  type ExecutionPlanStore,
  type PlanApplicability,
  planApplies,
} from './execution-plan'
import {
  nonemptyBindings,
  publicStepExecution,
  redactString,
  scenarioIdentity,
  stringContainsBinding,
  templateStepAt,
} from './scenario-runtime'

export type TestResultState =
  | 'passed'
  | 'passed-with-adaptation'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'infrastructure-error'

export function isEvidenceState(state: TestResultState): boolean {
  return (
    state === 'failed' ||
    state === 'infrastructure-error' ||
    state === 'passed-with-adaptation'
  )
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

export type TargetSessionCacheCandidate =
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
  cacheCandidate?: TargetSessionCacheCandidate
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
  plan?: ExecutionPlan
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
  planFormatVersion?: string
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
  plans?: ExecutionPlanStore
  executionCache?: ScenarioExecutionCache
  cachePolicy?: ExecutionCachePolicy
  applicationRevision?: string
  ci?: boolean
  signal?: AbortSignal
  onEvent?: (event: RunEvent) => void | Promise<void>
}

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
  plan?: ExecutionPlan
  cacheEntry?: ExecutionCacheEnvelope
}

export interface AttemptScenarioRun extends ScenarioRun {
  completion?: TargetSessionCompletion
  replayDiverged: boolean
  runtimeValueExposed: boolean
}

function planQuery(input: RunScenarioInput): PlanApplicability {
  return {
    scenarioId:
      input.scenario.id ??
      resolveScenarioId(
        input.specification.source.uri,
        input.specification.name,
        input.scenario.template?.name ?? input.scenario.name,
        input.scenario.tags,
      ),
    scenarioRevision: scenarioRevision(input.scenario),
    executionTargetProfileId: input.executionTargetProfile.id,
    planFormatVersion: input.adapter.planFormatVersion ?? '1',
    ...(input.applicationRevision !== undefined
      ? { applicationRevision: input.applicationRevision }
      : {}),
  }
}

async function selectPlan(input: RunScenarioInput): Promise<{
  mode: ExecutionMode
  plan?: ExecutionPlan
  query: PlanApplicability
}> {
  const query = planQuery(input)
  const found = await input.plans?.findApproved(query)
  const plan = found && planApplies(found, query) ? found : undefined
  if (plan && input.applicationRevision === undefined && input.ci) {
    throw new Error(
      'CI Replay requires applicationRevision. Set applicationRevision or --application-revision.',
    )
  }
  return {
    mode: plan ? 'replay' : 'adaptive',
    ...(plan ? { plan } : {}),
    query,
  }
}

function candidatePlan(
  query: PlanApplicability,
  steps: TestStepResult[],
): ExecutionPlan {
  return {
    schemaVersion: 1,
    ...query,
    steps: steps.map((step) => ({ resolvedActions: step.resolvedActions })),
  }
}

function shouldSaveCandidate(
  state: TestResultState,
  mode: ExecutionMode,
): boolean {
  return (
    state === 'passed-with-adaptation' ||
    (state === 'passed' && mode === 'adaptive')
  )
}

export function withAttemptMetadata(
  result: TestResult,
  attempt: number,
): TestResult {
  if (attempt === 1) return result
  return {
    ...result,
    attempts: attempt,
    flaky:
      result.state === 'passed' || result.state === 'passed-with-adaptation',
  }
}

export function createTestResult(
  input: ScenarioAttemptInput,
  state: TestResultState,
  steps: TestStepResult[],
  durationMs: number,
  message?: string,
): TestResult {
  const scenarioId = planQuery(input).scenarioId
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
      id: planQuery(input).scenarioId,
    },
    executionTargetProfile: input.executionTargetProfile,
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
  let replayDiverged = false
  let runtimeValueExposed = false
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
      replayDiverged,
      runtimeValueExposed,
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
      ...(input.plan ? { plan: input.plan } : {}),
      ...(input.cacheEntry
        ? {
            executionCache: {
              adapterPayload: input.cacheEntry.adapterPayload,
              requiredVariables: input.cacheEntry.requiredVariables,
            },
          }
        : {}),
      ...(input.scenario.template
        ? { scenarioTemplate: input.scenario.template }
        : {}),
      ...(input.scenario.runtimeBindings
        ? { runtimeBindings: input.scenario.runtimeBindings }
        : {}),
      signal: input.signal,
    })
  } catch (error) {
    const bindings = nonemptyBindings(input.scenario.runtimeBindings)
    const rawMessage = errorMessage(error)
    runtimeValueExposed ||= stringContainsBinding(rawMessage, bindings)
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
  let state: TestResultState = input.signal?.aborted ? 'cancelled' : 'passed'
  let message: string | undefined = input.signal?.aborted
    ? 'Scenario cancelled before step execution started'
    : undefined
  const bindings = nonemptyBindings(input.scenario.runtimeBindings)

  const recordExecution = async (
    stepIndex: number,
    execution: StepExecution,
  ): Promise<boolean> => {
    const templateStep = templateStepAt(input.scenario, stepIndex)
    const projected = publicStepExecution(execution, bindings)
    runtimeValueExposed ||= projected.runtimeValueExposed
    if (input.signal?.aborted) {
      state = 'cancelled'
      message = 'Scenario cancelled during step execution'
      await recordStep({
        step: templateStep,
        state,
        resolvedActions: projected.execution.resolvedActions,
        message,
      })
      return false
    }
    await recordStep({
      step: templateStep,
      state: projected.execution.state,
      resolvedActions: projected.execution.resolvedActions,
      ...(projected.execution.message
        ? { message: projected.execution.message }
        : {}),
      ...(projected.execution.artifacts?.length
        ? { artifacts: projected.execution.artifacts }
        : {}),
    })

    if (execution.replayDiverged) {
      replayDiverged = true
      state = 'failed'
      message = projected.execution.message
      return false
    }
    if (execution.state === 'passed-with-adaptation') {
      state = 'passed-with-adaptation'
      return true
    }
    if (execution.state !== 'passed') {
      state = execution.state
      message = projected.execution.message
      return false
    }
    return true
  }

  try {
    if (!session.executeScenario && !session.executeStep) {
      state = 'infrastructure-error'
      message =
        'Target session must provide executeStep or executeScenario execution'
    } else if (session.executeScenario) {
      try {
        const executeScenario = session.executeScenario
        const scenarioExecution = await executeWithDeadline(
          (operationSignal) => executeScenario(operationSignal),
          input.signal,
          input.timeout?.scenarioMs,
          `Scenario exceeded its ${input.timeout?.scenarioMs}ms deadline`,
        )
        if (
          scenarioExecution.stepExecutions.length >
            input.scenario.steps.length ||
          (!scenarioExecution.replayDiverged &&
            scenarioExecution.stepExecutions.length !==
              input.scenario.steps.length)
        ) {
          throw new Error(
            'Scenario execution must return one result for every Scenario step',
          )
        }
        for (const [
          stepIndex,
          execution,
        ] of scenarioExecution.stepExecutions.entries()) {
          const templateStep = templateStepAt(input.scenario, stepIndex)
          await emit({
            type: 'step-started',
            step: templateStep,
            ...attemptIdentity(input),
          })
          if (!(await recordExecution(stepIndex, execution))) break
        }
        if (scenarioExecution.replayDiverged) {
          replayDiverged = true
          state = 'failed'
          message ??= 'Replay diverged from the deterministic Scenario'
        }
      } catch (error) {
        const rawMessage = errorMessage(error)
        runtimeValueExposed ||= stringContainsBinding(rawMessage, bindings)
        state = isCancellation(error, input.signal)
          ? 'cancelled'
          : 'infrastructure-error'
        message = redactString(rawMessage, bindings)
      }
    } else if (session.executeStep) {
      for (const [stepIndex, step] of input.scenario.steps.entries()) {
        if (input.signal?.aborted) {
          state = 'cancelled'
          message = 'Scenario cancelled before the next step started'
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
          const rawMessage = errorMessage(error)
          runtimeValueExposed ||= stringContainsBinding(rawMessage, bindings)
          state = isCancellation(error, input.signal)
            ? 'cancelled'
            : 'infrastructure-error'
          message = redactString(rawMessage, bindings)
          await recordStep({
            step: templateStep,
            state,
            resolvedActions: [],
            message,
          })
          break
        }
        if (!(await recordExecution(stepIndex, execution))) break
      }
    }
    if (state === 'passed' && !input.signal?.aborted && session.complete) {
      try {
        completion = validateCompletion(await session.complete())
      } catch (error) {
        const rawMessage = errorMessage(error)
        runtimeValueExposed ||= stringContainsBinding(rawMessage, bindings)
        state = 'infrastructure-error'
        message = redactString(rawMessage, bindings)
      }
    }
  } finally {
    try {
      await session.close()
    } catch (error) {
      const bindings = nonemptyBindings(input.scenario.runtimeBindings)
      const rawMessage = errorMessage(error)
      runtimeValueExposed ||= stringContainsBinding(rawMessage, bindings)
      state = 'infrastructure-error'
      message = redactString(rawMessage, bindings)
    }
  }

  return finish(state, steps, message)
}

export async function runLegacyScenario(
  input: RunScenarioInput,
): Promise<ScenarioRun> {
  const events: RunEvent[] = []
  const infrastructureRetries = input.retry?.infrastructureErrors ?? 0
  const functionalRetries = input.retry?.functionalFailures ?? 0
  let infrastructureFailures = 0
  let functionalFailures = 0
  const selected = await selectPlan(input)

  for (let attempt = 1; ; attempt++) {
    const run = await runScenarioAttempt({
      ...input,
      mode: selected.mode,
      ...(selected.plan ? { plan: selected.plan } : {}),
      onEvent: async (event) => {
        if (event.type === 'scenario-finished') return
        const versionedEvent = {
          ...event,
          sequence: events.length + 1,
        } as RunEvent
        events.push(versionedEvent)
        await input.onEvent?.(versionedEvent)
      },
      retry: undefined,
    })
    const shouldRetryInfrastructure =
      run.result.state === 'infrastructure-error' &&
      infrastructureFailures < infrastructureRetries &&
      !input.signal?.aborted
    const shouldRetryFunctional =
      run.result.state === 'failed' &&
      functionalFailures < functionalRetries &&
      !input.signal?.aborted
    const shouldRetry = shouldRetryInfrastructure || shouldRetryFunctional
    const result = withAttemptMetadata(run.result, attempt)

    for (const event of run.events) {
      if (event.type !== 'scenario-finished') continue
      const versionedEvent = {
        ...event,
        sequence: events.length + 1,
        ...(shouldRetry ? {} : { result }),
      } as RunEvent
      events.push(versionedEvent)
      await input.onEvent?.(versionedEvent)
    }

    if (shouldRetryInfrastructure) {
      infrastructureFailures++
      continue
    }
    if (shouldRetryFunctional) {
      functionalFailures++
      continue
    }
    if (input.plans && shouldSaveCandidate(result.state, selected.mode)) {
      await input.plans.saveCandidate(
        candidatePlan(selected.query, result.steps),
      )
    }
    return { events, result }
  }
}
