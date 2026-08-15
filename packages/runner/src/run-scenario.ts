import type { Scenario, ScenarioStep, Specification } from '@pickle-spec/spec'

export type TestResultState =
  | 'passed'
  | 'passed-with-adaptation'
  | 'failed'
  | 'skipped'
  | 'cancelled'
  | 'infrastructure-error'

export interface ExecutionTargetProfile {
  id: string
}

export interface ResolvedAction {
  description: string
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
  signal?: AbortSignal
}

export interface ExecutionTargetAdapter {
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
  message?: string
  attempts?: number
  flaky?: boolean
}

interface RunEventEnvelope {
  schemaVersion: 1
  sequence: number
}

type RunEventPayload =
  | { type: 'scenario-started'; scenario: TestResult['scenario'] }
  | { type: 'step-started'; step: ScenarioStep }
  | { type: 'step-finished'; result: TestStepResult }
  | { type: 'scenario-finished'; result: TestResult }

export type RunEvent = RunEventEnvelope & RunEventPayload

export interface ScenarioRun {
  events: RunEvent[]
  result: TestResult
}

export interface RunScenarioInput {
  specification: Specification
  scenario: Scenario
  executionTargetProfile: ExecutionTargetProfile
  adapter: ExecutionTargetAdapter
  signal?: AbortSignal
  onEvent?: (event: RunEvent) => void | Promise<void>
  retry?: {
    infrastructureErrors: number
  }
  timeout?: {
    stepMs?: number
    scenarioMs?: number
  }
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
  return Boolean(signal?.aborted) || (error instanceof Error && error.name === 'AbortError')
}

function executeWithDeadline<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  signal: AbortSignal | undefined,
  timeoutMs: number | undefined,
  timeoutMessage: string,
): Promise<T> {
  if (timeoutMs === undefined) {
    return operation(signal ?? new AbortController().signal)
  }

  const controller = new AbortController()
  const onAbort = () => controller.abort()
  signal?.addEventListener('abort', onAbort, { once: true })

  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      controller.abort()
      reject(new ExecutionDeadlineError(timeoutMessage))
    }, timeoutMs)
    operation(controller.signal).then(resolve, reject).finally(() => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    })
  })
}

function createTestResult(
  input: RunScenarioInput,
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
    ...(message !== undefined ? { message } : {}),
  }
}

async function runScenarioAttempt(input: RunScenarioInput): Promise<ScenarioRun> {
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

  await emit({
    type: 'scenario-started',
    scenario: { name: input.scenario.name },
  })

  if (input.scenario.tags.includes('@ignore')) {
    const result = createTestResult(input, 'skipped', [], 'Scenario is tagged @ignore')
    await emit({ type: 'scenario-finished', result })
    return { events, result }
  }

  if (input.signal?.aborted) {
    const result = createTestResult(
      input,
      'cancelled',
      [],
      'Scenario cancelled before the logical session started',
    )
    await emit({ type: 'scenario-finished', result })
    return { events, result }
  }

  let session: TargetSession
  try {
    session = await input.adapter.openSession({
      executionTargetProfile: input.executionTargetProfile,
      specification: input.specification,
      scenario: input.scenario,
      signal: input.signal,
    })
  } catch (error) {
    const result = createTestResult(
      input,
      isCancellation(error, input.signal) ? 'cancelled' : 'infrastructure-error',
      [],
      errorMessage(error),
    )
    await emit({ type: 'scenario-finished', result })
    return { events, result }
  }
  const steps: TestStepResult[] = []
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
        const scenarioRemaining = input.timeout?.scenarioMs === undefined
          ? undefined
          : input.timeout.scenarioMs - (Date.now() - scenarioStartedAt)
        const usesScenarioDeadline = scenarioRemaining !== undefined
          && (input.timeout?.stepMs === undefined || scenarioRemaining <= input.timeout.stepMs)
        const timeoutMs = usesScenarioDeadline ? Math.max(0, scenarioRemaining) : input.timeout?.stepMs
        const timeoutMessage = usesScenarioDeadline
          ? `Scenario exceeded its ${input.timeout!.scenarioMs}ms deadline`
          : `Step exceeded its ${input.timeout!.stepMs}ms deadline`
        execution = await executeWithDeadline(
          operationSignal => session.executeStep(step, operationSignal),
          input.signal,
          timeoutMs,
          timeoutMessage,
        )
      } catch (error) {
        state = isCancellation(error, input.signal) ? 'cancelled' : 'infrastructure-error'
        message = errorMessage(error)
        const result: TestStepResult = {
          step,
          state,
          resolvedActions: [],
          message,
        }
        steps.push(result)
        await emit({ type: 'step-finished', result })
        break
      }

      if (input.signal?.aborted) {
        state = 'cancelled'
        message = 'Scenario cancelled during step execution'
        const result: TestStepResult = {
          step,
          state,
          resolvedActions: execution.resolvedActions,
          message,
        }
        steps.push(result)
        await emit({ type: 'step-finished', result })
        break
      }

      const result: TestStepResult = {
        step,
        state: execution.state,
        resolvedActions: execution.resolvedActions,
        ...(execution.message ? { message: execution.message } : {}),
        ...(execution.artifacts?.length ? { artifacts: execution.artifacts } : {}),
      }
      steps.push(result)
      await emit({ type: 'step-finished', result })

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

  const result = createTestResult(input, state, steps, message)

  await emit({ type: 'scenario-finished', result })

  return { events, result }
}

export async function runScenario(input: RunScenarioInput): Promise<ScenarioRun> {
  const events: RunEvent[] = []
  const maximumAttempts = (input.retry?.infrastructureErrors ?? 0) + 1

  for (let attempt = 1; attempt <= maximumAttempts; attempt++) {
    const run = await runScenarioAttempt({ ...input, onEvent: undefined, retry: undefined })
    const shouldRetry = run.result.state === 'infrastructure-error'
      && attempt < maximumAttempts
      && !input.signal?.aborted

    const result: TestResult = attempt === 1
      ? run.result
      : {
          ...run.result,
          attempts: attempt,
          flaky: run.result.state === 'passed' || run.result.state === 'passed-with-adaptation',
        }

    for (const event of run.events) {
      const versionedEvent = {
        ...event,
        sequence: events.length + 1,
        ...(event.type === 'scenario-finished' && !shouldRetry ? { result } : {}),
      } as RunEvent
      events.push(versionedEvent)
      await input.onEvent?.(versionedEvent)
    }

    if (!shouldRetry) return { events, result }
  }

  throw new Error('Runner exhausted attempts without producing a test result')
}
