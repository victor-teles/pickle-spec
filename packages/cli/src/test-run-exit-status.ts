import type { TestResult } from '@pickle-spec/runner'
import type { ProjectPolicy } from './config'

type AdaptedResultsPolicy = NonNullable<ProjectPolicy['adaptedResults']>

export type TestRunExitStatus = {
  exitCode: 0 | 1 | 130
  rejectedAdaptedResults: number
}

export function evaluateTestRunExitStatus(
  results: readonly TestResult[],
  adaptedResultsPolicy: AdaptedResultsPolicy = 'accept',
): TestRunExitStatus {
  const states = results.map((result) => result.state)
  const rejectedAdaptedResults =
    adaptedResultsPolicy === 'reject'
      ? states.filter((state) => state === 'passed-with-adaptation').length
      : 0

  if (rejectedAdaptedResults > 0) {
    return { exitCode: 1, rejectedAdaptedResults }
  }
  if (states.includes('cancelled')) {
    return { exitCode: 130, rejectedAdaptedResults }
  }
  if (states.includes('failed') || states.includes('infrastructure-error')) {
    return { exitCode: 1, rejectedAdaptedResults }
  }
  return { exitCode: 0, rejectedAdaptedResults }
}
