import {
  resolveScenarioId,
  type Scenario,
  type ScenarioStep,
  type Specification,
  scenarioRevision,
} from '@pickle-spec/spec'
import {
  type ExecutionPlan,
  type ExecutionPlanStore,
  type PlanApplicability,
  planApplies,
} from './execution-plan'

export type TestResultState =
  | 'passed'
  | 'passed-with-adaptation'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'infrastructure-error'

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
  message?: string
  artifacts?: TestArtifact[]
}

export interface TargetSession {
  executeStep(step: ScenarioStep, signal?: AbortSignal): Promise<StepExecution>
  close(): Promise<void>
}

export interface OpenSessionInput {
  executionTargetProfile: ExecutionTargetProfile
  specification: Specification
  scenario: Scenario
  mode?: ExecutionMode
  plan?: ExecutionPlan
  signal?: AbortSignal
}

export interface ExecutionTargetAdapter {
  capabilities?: readonly string[]
  planFormatVersion?: string
  openSession(input: OpenSessionInput): Promise<TargetSession>
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
  scenario: {
    name: string
  }
  executionTargetProfile: ExecutionTargetProfile
  state: TestResultState
  steps: TestStepResult[]
  executionMode?: ExecutionMode
  message?: string
  attempts?: number
  flaky?: boolean
}

interface RunEventEnvelope {
  schemaVersion: 1
  sequence: number
}

export type RunEventPayload =
  | { type: 'run-started'; run: { id: string; startedAt: string } }
  | { type: 'scenario-started'; scenario: TestResult['scenario'] }
  | { type: 'step-started'; step: ScenarioStep }
  | { type: 'step-finished'; result: TestStepResult }
  | { type: 'scenario-finished'; result: TestResult }

export type RunEvent = RunEventEnvelope & RunEventPayload

export interface ScenarioRun {
  events: RunEvent[]
  result: TestResult
}

export interface RetryPolicy {
  infrastructureErrors: number
}

export interface ExecutionTimeouts {
  stepMs?: number
  scenarioMs?: number
}

export interface ExecutionPolicy {
  retry?: RetryPolicy
  timeout?: ExecutionTimeouts
}

export interface RunScenarioInput extends ExecutionPolicy {
  specification: Specification
  scenario: Scenario
  executionTargetProfile: ExecutionTargetProfile
  adapter: ExecutionTargetAdapter
  plans?: ExecutionPlanStore
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

interface ScenarioAttemptInput extends RunScenarioInput {
  mode: ExecutionMode
  plan?: ExecutionPlan
}

function planQuery(input: RunScenarioInput): PlanApplicability {
  return {
    scenarioId:
      input.scenario.id ??
      resolveScenarioId(
        input.specification.source.uri,
        input.specification.name,
        input.scenario.name,
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

function withAttemptMetadata(result: TestResult, attempt: number): TestResult {
  if (attempt === 1) return result
  return {
    ...result,
    attempts: attempt,
    flaky:
      result.state === 'passed' || result.state === 'passed-with-adaptation',
  }
}

function createTestResult(
  input: ScenarioAttemptInput,
  state: TestResultState,
  steps: TestStepResult[],
  message?: string,
): TestResult {
  return {
    schemaVersion: 1,
    specification: {
      name: input.specification.name,
      uri: input.specification.source.uri,
    },
    scenario: { name: input.scenario.name },
    executionTargetProfile: input.executionTargetProfile,
    state,
    steps,
    executionMode: input.mode,
    ...(message !== undefined ? { message } : {}),
  }
}

async function runScenarioAttempt(
  input: ScenarioAttemptInput,
): Promise<ScenarioRun> {
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

  const finish = async (
    state: TestResultState,
    steps: TestStepResult[],
    message?: string,
  ): Promise<ScenarioRun> => {
    const result = createTestResult(input, state, steps, message)
    await emit({ type: 'scenario-finished', result })
    return { events, result }
  }

  await emit({
    type: 'scenario-started',
    scenario: { name: input.scenario.name },
  })

  if (input.scenario.tags.includes('@ignore')) {
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
      signal: input.signal,
    })
  } catch (error) {
    return finish(
      isCancellation(error, input.signal)
        ? 'cancelled'
        : 'infrastructure-error',
      [],
      errorMessage(error),
    )
  }

  const steps: TestStepResult[] = []
  const recordStep = async (result: TestStepResult): Promise<void> => {
    steps.push(result)
    await emit({ type: 'step-finished', result })
  }
  let state: TestResultState = input.signal?.aborted ? 'cancelled' : 'passed'
  let message: string | undefined = input.signal?.aborted
    ? 'Scenario cancelled before step execution started'
    : undefined

  try {
    for (const step of input.scenario.steps) {
      if (input.signal?.aborted) {
        state = 'cancelled'
        message = 'Scenario cancelled before the next step started'
        break
      }

      await emit({ type: 'step-started', step })
      let execution: StepExecution
      try {
        const deadline = stepDeadline(input.timeout, scenarioStartedAt)
        execution = await executeWithDeadline(
          (operationSignal) => session.executeStep(step, operationSignal),
          input.signal,
          deadline.timeoutMs,
          deadline.timeoutMessage,
        )
      } catch (error) {
        state = isCancellation(error, input.signal)
          ? 'cancelled'
          : 'infrastructure-error'
        message = errorMessage(error)
        await recordStep({
          step,
          state,
          resolvedActions: [],
          message,
        })
        break
      }

      if (input.signal?.aborted) {
        state = 'cancelled'
        message = 'Scenario cancelled during step execution'
        await recordStep({
          step,
          state,
          resolvedActions: execution.resolvedActions,
          message,
        })
        break
      }

      await recordStep({
        step,
        state: execution.state,
        resolvedActions: execution.resolvedActions,
        ...(execution.message ? { message: execution.message } : {}),
        ...(execution.artifacts?.length
          ? { artifacts: execution.artifacts }
          : {}),
      })

      if (execution.state === 'passed-with-adaptation') {
        state = 'passed-with-adaptation'
        continue
      }

      if (execution.state !== 'passed') {
        state = execution.state
        message = execution.message
        break
      }
    }
  } finally {
    try {
      await session.close()
    } catch (error) {
      state = 'infrastructure-error'
      message = errorMessage(error)
    }
  }

  return finish(state, steps, message)
}

export async function runScenario(
  input: RunScenarioInput,
): Promise<ScenarioRun> {
  const events: RunEvent[] = []
  const maximumAttempts = (input.retry?.infrastructureErrors ?? 0) + 1
  const selected = await selectPlan(input)

  for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
    const run = await runScenarioAttempt({
      ...input,
      mode: selected.mode,
      ...(selected.plan ? { plan: selected.plan } : {}),
      // Collect attempt events locally so retries can be resequenced.
      onEvent: undefined,
      // Attempts own one logical session; retries are orchestrated here.
      retry: undefined,
    })
    const shouldRetry =
      run.result.state === 'infrastructure-error' &&
      attempt < maximumAttempts &&
      !input.signal?.aborted
    const result = withAttemptMetadata(run.result, attempt)

    for (const event of run.events) {
      const versionedEvent = {
        ...event,
        sequence: events.length + 1,
        ...(event.type === 'scenario-finished' && !shouldRetry
          ? { result }
          : {}),
      } as RunEvent
      events.push(versionedEvent)
      await input.onEvent?.(versionedEvent)
    }

    if (shouldRetry) continue
    if (input.plans && shouldSaveCandidate(result.state, selected.mode)) {
      await input.plans.saveCandidate(
        candidatePlan(selected.query, result.steps),
      )
    }
    return { events, result }
  }

  throw new Error('Runner exhausted attempts without producing a test result')
}
