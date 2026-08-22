import type { TestResult } from '@pickle-spec/runner'

export type TestRunExitStatus = {
  exitCode: 0 | 1 | 130
  interrupted: boolean
}

type TestRunExitOptions = {
  interrupted?: boolean
}

export function evaluateTestRunExitStatus(
  results: readonly TestResult[],
  options: TestRunExitOptions = {},
): TestRunExitStatus {
  const states = results.map((result) => result.state)

  if (options.interrupted) {
    return { exitCode: 130, interrupted: true }
  }
  if (states.includes('cancelled')) {
    return { exitCode: 130, interrupted: false }
  }
  if (states.includes('failed') || states.includes('infrastructure-error')) {
    return { exitCode: 1, interrupted: false }
  }
  return { exitCode: 0, interrupted: false }
}
