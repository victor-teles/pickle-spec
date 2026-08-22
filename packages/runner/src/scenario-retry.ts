import type { RetryPolicy, TestResultState } from './run-scenario-types'

export interface ScenarioRetryInput {
  state: TestResultState
  replayDiverged?: boolean
  aborted: boolean
}

export interface ScenarioRetryTracker {
  shouldRetry(input: ScenarioRetryInput): boolean
}

export function createScenarioRetryTracker(
  policy: RetryPolicy | undefined,
): ScenarioRetryTracker {
  const infrastructureRetries = policy?.infrastructureErrors ?? 0
  const functionalRetries = policy?.functionalFailures ?? 0
  let infrastructureFailures = 0
  let functionalFailures = 0

  return {
    shouldRetry(input) {
      if (input.aborted || input.replayDiverged) return false
      if (
        input.state === 'infrastructure-error' &&
        infrastructureFailures < infrastructureRetries
      ) {
        infrastructureFailures++
        return true
      }
      if (input.state === 'failed' && functionalFailures < functionalRetries) {
        functionalFailures++
        return true
      }
      return false
    },
  }
}
