import type {
  RunEvent,
  RunEventPayload,
  TestResult,
  TestResultState,
  TestStepResult,
} from './run-scenario'

interface EventResultMappers {
  step(result: TestStepResult): TestStepResult
  scenario(result: TestResult): TestResult
}

function publicState(state: TestResultState): TestResultState {
  return state === 'passed-with-adaptation' ? 'passed' : state
}

export function withoutPrivateStepResultData(
  result: TestStepResult,
): TestStepResult {
  return {
    ...result,
    resolvedActions: result.resolvedActions.map(({ description }) => ({
      description,
    })),
  }
}

export function withoutPrivateTestResultData(result: TestResult): TestResult {
  return {
    ...result,
    steps: result.steps.map(withoutPrivateStepResultData),
  }
}

export function withoutPrivateRunEventPayloadData(
  event: RunEventPayload,
): RunEventPayload {
  return mapEventResults(event, {
    step: withoutPrivateStepResultData,
    scenario: withoutPrivateTestResultData,
  })
}

function publicStepResult(result: TestStepResult): TestStepResult {
  return {
    ...withoutPrivateStepResultData(result),
    state: publicState(result.state),
  }
}

export function publicTestResult(result: TestResult): TestResult {
  return {
    ...result,
    state: publicState(result.state),
    steps: result.steps.map(publicStepResult),
  }
}

export function publicRunEvent(event: RunEvent): RunEvent {
  return mapEventResults(event, {
    step: publicStepResult,
    scenario: publicTestResult,
  })
}

function mapEventResults(event: RunEvent, mappers: EventResultMappers): RunEvent
function mapEventResults(
  event: RunEventPayload,
  mappers: EventResultMappers,
): RunEventPayload
function mapEventResults(
  event: RunEvent | RunEventPayload,
  mappers: EventResultMappers,
): RunEvent | RunEventPayload {
  if (event.type === 'step-finished') {
    return { ...event, result: mappers.step(event.result) }
  }
  if (event.type === 'scenario-finished') {
    return { ...event, result: mappers.scenario(event.result) }
  }
  return event
}

export function publicTestRunState(state: TestResultState): TestResultState {
  return publicState(state)
}
