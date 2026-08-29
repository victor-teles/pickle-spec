import {
  publicRunEvent,
  publicTestResult,
  type RunEvent,
  type ScenarioRun,
  type ScheduledTestResult,
  type TestResult,
} from '@pickle-spec/runner'
import {
  createProcessTerminalSurface,
  type InteractiveTerminalSurface,
} from '../terminal/terminal-surface'
import { createLiveRunReporter } from './live-run-reporter'
import {
  clockLabel,
  diagnosticLines,
  groupResults,
  interruptionLines,
  renderTestResult,
  summaryLines,
  type WriteLine,
  writeWrapped,
} from './run-report'
import {
  claimScheduleIndex,
  createScheduleIndexQueues,
  orderedScheduleFromResults,
  type ScheduleIndexQueue,
} from './run-schedule'
import type { TestRunExitStatus } from './test-run-exit-status'

export type RunReporterName = 'default' | 'ndjson'

export interface RunReporter {
  start(): void
  prepare?(schedule: readonly ScheduledTestResult[]): void
  event(event: RunEvent): void
  complete?(result: TestResult): void
  fail?(error: unknown, durationMs: number): void
  refresh?(): void
  finish(
    runs: readonly ScenarioRun[],
    durationMs: number,
    exitStatus: TestRunExitStatus,
  ): void
}

type RunReporterOptions = {
  write?: WriteLine
  projectRoot?: string
  version?: string
  color?: boolean
  columns?: number
  interactive?: boolean
  terminal?: InteractiveTerminalSurface
  now?: () => Date
  scheduleRefresh?: (refresh: () => void) => () => void
}

interface BufferedReporterState {
  color: boolean
  completedResults: Array<TestResult | undefined>
  multipleProfiles: boolean
  now: () => Date
  options: RunReporterOptions
  projectRoot: string
  scheduleIndexQueues: Map<string, ScheduleIndexQueue>
  startTime: string
  version: string
  write: WriteLine
}

function prepareBufferedReporter(
  state: BufferedReporterState,
  schedule: readonly ScheduledTestResult[],
): void {
  const reporter = state
  reporter.completedResults = Array.from({ length: schedule.length })
  reporter.scheduleIndexQueues = createScheduleIndexQueues(schedule)
  reporter.multipleProfiles =
    new Set(schedule.map((result) => result.executionTargetProfile.id)).size > 1
}

function writeBufferedResult(
  state: BufferedReporterState,
  result: TestResult,
): void {
  const lines = renderTestResult(
    result,
    `${result.specification.uri} > ${result.scenario.name}`,
    {
      color: state.color,
      columns: state.options.columns,
      multipleProfiles: state.multipleProfiles,
    },
  )
  for (const line of lines) state.write(line)
}

function completeBufferedResult(
  state: BufferedReporterState,
  result: TestResult,
): void {
  const reporter = state
  const scheduleIndex = claimScheduleIndex(state.scheduleIndexQueues, result)
  if (scheduleIndex === undefined) return
  reporter.completedResults[scheduleIndex] = result
  writeBufferedResult(reporter, result)
}

function finishBufferedReport(
  state: BufferedReporterState,
  runs: readonly ScenarioRun[],
  durationMs: number,
  exitStatus: TestRunExitStatus,
): void {
  const results = runs.map((run) => run.result)
  if (state.completedResults.length === 0) {
    prepareBufferedReporter(state, orderedScheduleFromResults(results))
  }
  if (state.completedResults.some((result) => !result)) {
    for (const result of results) completeBufferedResult(state, result)
  }
  const lines = [
    ...diagnosticLines(results, {
      projectRoot: state.projectRoot,
      color: state.color,
      columns: state.options.columns,
      multipleProfiles: state.multipleProfiles,
    }),
    ...interruptionLines(exitStatus, state.options.columns),
    ...summaryLines(
      groupResults(results),
      results,
      state.startTime,
      durationMs,
    ),
  ]
  for (const line of lines) state.write(line)
}

function startBufferedReporter(state: BufferedReporterState): void {
  const reporter = state
  reporter.startTime = clockLabel(reporter.now())
  reporter.write('')
  const bannerPrefix = ` RUN  pickle ${reporter.version} `
  writeWrapped(
    reporter.write,
    bannerPrefix,
    reporter.projectRoot,
    ' '.repeat(bannerPrefix.length),
    reporter.options.columns,
  )
  reporter.write('')
}

function createBufferedRunReporter(options: RunReporterOptions): RunReporter {
  const state: BufferedReporterState = {
    color: options.color ?? false,
    completedResults: [],
    multipleProfiles: false,
    now: options.now ?? (() => new Date()),
    options,
    projectRoot: options.projectRoot ?? process.cwd(),
    scheduleIndexQueues: new Map(),
    startTime: '',
    version: options.version ?? 'unknown',
    write: options.write ?? console.log,
  }
  return {
    start: () => startBufferedReporter(state),
    prepare: (schedule) => prepareBufferedReporter(state, schedule),
    event() {},
    complete: (result) => completeBufferedResult(state, result),
    finish: (runs, durationMs, exitStatus) =>
      finishBufferedReport(state, runs, durationMs, exitStatus),
  }
}

function createDefaultReporter(options: RunReporterOptions): RunReporter {
  const terminal =
    options.terminal ??
    (options.interactive
      ? createProcessTerminalSurface(process.stdout, [process.stderr])
      : undefined)
  if (!terminal) return createBufferedRunReporter(options)

  return createLiveRunReporter({
    terminal,
    projectRoot: options.projectRoot ?? process.cwd(),
    version: options.version ?? 'unknown',
    color: options.color ?? false,
    now: options.now ?? (() => new Date()),
    scheduleRefresh: options.scheduleRefresh,
  })
}

function createNdjsonReporter(write: WriteLine): RunReporter {
  return {
    start() {},
    event(event) {
      if (event.type === 'run-started') return
      write(JSON.stringify({ kind: 'run-event', event: publicRunEvent(event) }))
    },
    finish(runs) {
      for (const run of runs) {
        write(
          JSON.stringify({
            kind: 'test-result',
            result: publicTestResult(run.result),
          }),
        )
      }
    },
  }
}

export function terminalReporterCapabilities(
  isTerminal: boolean | undefined,
  columns: number | undefined,
  noColor: string | undefined,
  term?: string,
): Pick<RunReporterOptions, 'color' | 'columns' | 'interactive'> {
  const interactive = Boolean(isTerminal) && term !== 'dumb'
  return {
    color: interactive && noColor === undefined,
    columns,
    interactive,
  }
}

export function createRunReporter(
  name: RunReporterName,
  options: RunReporterOptions = {},
): RunReporter {
  return name === 'ndjson'
    ? createNdjsonReporter(options.write ?? console.log)
    : createDefaultReporter(options)
}
