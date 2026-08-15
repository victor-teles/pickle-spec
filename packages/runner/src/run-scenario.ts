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

export interface StepExecution {
  state: TestResultState
  resolvedActions: ResolvedAction[]
  message?: string
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
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isCancellation(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (error instanceof Error && error.name === 'AbortError')
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

export async function runScenario(input: RunScenarioInput): Promise<ScenarioRun> {
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
        execution = await session.executeStep(step, input.signal)
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
