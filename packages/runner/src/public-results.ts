import type {
  RunEvent,
  RunEventPayload,
  TestResult,
  TestResultState,
  TestStepResult,
} from './run-scenario'

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
  if (event.type === 'step-finished') {
    return { ...event, result: withoutPrivateStepResultData(event.result) }
  }
  if (event.type === 'scenario-finished') {
    return { ...event, result: withoutPrivateTestResultData(event.result) }
  }
  return event
}

function publicStepResult(result: TestStepResult): TestStepResult {
  return {
    ...withoutPrivateStepResultData(result),
    state: publicState(result.state),
  }
}

export function publicTestResult(result: TestResult): TestResult {
  return {
    ...withoutPrivateTestResultData(result),
    state: publicState(result.state),
    steps: result.steps.map(publicStepResult),
  }
}

export function publicRunEvent(event: RunEvent): RunEvent {
  if (event.type === 'step-finished') {
    return { ...event, result: publicStepResult(event.result) }
  }
  if (event.type === 'scenario-finished') {
    return { ...event, result: publicTestResult(event.result) }
  }
  return event
}

export function publicTestRunState(state: TestResultState): TestResultState {
  return publicState(state)
}
