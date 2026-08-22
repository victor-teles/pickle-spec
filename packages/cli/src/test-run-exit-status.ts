import type { TestResult } from '@pickle-spec/runner'
import type { ProjectPolicy } from './config'

type AdaptedResultsPolicy = NonNullable<ProjectPolicy['adaptedResults']>

export type TestRunExitStatus = {
  exitCode: 0 | 1 | 130
  interrupted: boolean
  rejectedAdaptedResults: number
}

type TestRunExitOptions = {
  interrupted?: boolean
}

export function evaluateTestRunExitStatus(
  results: readonly TestResult[],
  adaptedResultsPolicy: AdaptedResultsPolicy = 'accept',
  options: TestRunExitOptions = {},
): TestRunExitStatus {
  const states = results.map((result) => result.state)
  const rejectedAdaptedResults =
    adaptedResultsPolicy === 'reject'
      ? states.filter((state) => state === 'passed-with-adaptation').length
      : 0

  if (options.interrupted) {
    return { exitCode: 130, interrupted: true, rejectedAdaptedResults }
  }
  if (rejectedAdaptedResults > 0) {
    return { exitCode: 1, interrupted: false, rejectedAdaptedResults }
  }
  if (states.includes('cancelled')) {
    return { exitCode: 130, interrupted: false, rejectedAdaptedResults }
  }
  if (states.includes('failed') || states.includes('infrastructure-error')) {
    return { exitCode: 1, interrupted: false, rejectedAdaptedResults }
  }
  return { exitCode: 0, interrupted: false, rejectedAdaptedResults }
}
