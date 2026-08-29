import type {
  RunEvent,
  ScenarioRun,
  ScheduledTestResult,
  TestResult,
} from '@pickle-spec/runner'
import type { RunReporter } from './run-reporter'
import type { TestRunExitStatus } from './test-run-exit-status'

export type ReporterFailure = {
  error: unknown
}

export interface RunReportingSession {
  start(): void
  prepare(schedule: readonly ScheduledTestResult[]): void
  event(event: RunEvent): void
  complete(result: TestResult): void
  refresh(): void
  finish(
    runs: readonly ScenarioRun[],
    durationMs: number,
    exitStatus: TestRunExitStatus,
  ): void
  failure(): ReporterFailure | undefined
  fail(error: unknown, durationMs: number): ReporterFailure | undefined
}

export function createRunReportingSession(
  reporter: RunReporter,
): RunReportingSession {
  let reporterFailure: ReporterFailure | undefined

  function capture(operation: () => void): void {
    if (reporterFailure) return
    try {
      operation()
    } catch (error) {
      reporterFailure = { error }
    }
  }

  return {
    start: () => capture(reporter.start),
    prepare: (schedule) => capture(() => reporter.prepare?.(schedule)),
    event: (event) => capture(() => reporter.event(event)),
    complete: (result) => capture(() => reporter.complete?.(result)),
    refresh: () => capture(() => reporter.refresh?.()),
    finish: (runs, durationMs, exitStatus) =>
      capture(() => reporter.finish(runs, durationMs, exitStatus)),
    failure: () => reporterFailure,
    fail(error, durationMs) {
      try {
        reporter.fail?.(error, durationMs)
        return
      } catch (reporterRecoveryError) {
        return { error: reporterRecoveryError }
      }
    },
  }
}
