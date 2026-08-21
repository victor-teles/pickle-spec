import type {
  RunEvent,
  ScenarioRun,
  ScheduledTestResult,
  TestResult,
} from '@pickle-spec/runner'
import { createLiveRunReporter } from './live-run-reporter'
import {
  clockLabel,
  groupResults,
  type SpecificationGroup,
  summaryLines,
  type WriteLine,
  writeSpecification,
  writeWrapped,
} from './run-report'
import {
  claimScheduleIndex,
  createScheduleIndexQueues,
  groupSchedule,
  orderedScheduleFromResults,
  type PendingSpecificationBlock,
  type ScheduleIndexQueue,
} from './run-schedule'
import {
  createProcessTerminalSurface,
  type InteractiveTerminalSurface,
} from './terminal-surface'

export type RunReporterName = 'default' | 'ndjson'

export interface RunReporter {
  start(): void
  prepare?(schedule: readonly ScheduledTestResult[]): void
  event(event: RunEvent): void
  complete?(result: TestResult): void
  fail?(error: unknown, durationMs: number): void
  refresh?(): void
  finish(runs: readonly ScenarioRun[], durationMs: number): void
}

type RunReporterOptions = {
  write?: WriteLine
  projectRoot?: string
  version?: string
  color?: boolean
  columns?: number
  interactive?: boolean
  progressive?: boolean
  terminal?: InteractiveTerminalSurface
  now?: () => Date
  scheduleRefresh?: (refresh: () => void) => () => void
}

function createBufferedRunReporter(options: RunReporterOptions): RunReporter {
  const write = options.write ?? console.log
  const now = options.now ?? (() => new Date())
  const projectRoot = options.projectRoot ?? process.cwd()
  const version = options.version ?? 'unknown'
  const color = options.color ?? false
  const progressive = options.progressive ?? false
  let startTime = ''
  let completedResults: Array<TestResult | undefined> = []
  let pendingBlocks: PendingSpecificationBlock[] = []
  let scheduleIndexQueues = new Map<string, ScheduleIndexQueue>()
  let nextBlockIndex = 0
  let wroteSpecification = false
  let multipleProfiles = false

  function prepare(schedule: readonly ScheduledTestResult[]): void {
    completedResults = Array.from({ length: schedule.length })
    pendingBlocks = groupSchedule(schedule)
    scheduleIndexQueues = createScheduleIndexQueues(schedule)
    nextBlockIndex = 0
    wroteSpecification = false
    multipleProfiles =
      new Set(schedule.map((result) => result.executionTargetProfile.id)).size >
      1
  }

  function completedSpecification(
    block: PendingSpecificationBlock,
  ): SpecificationGroup | undefined {
    const results = block.scheduleIndexes.flatMap((scheduleIndex) => {
      const result = completedResults[scheduleIndex]
      return result ? [result] : []
    })
    if (results.length !== block.scheduleIndexes.length) return undefined
    return groupResults(results)[0]
  }

  function flushReadyBlocks(): void {
    while (nextBlockIndex < pendingBlocks.length) {
      const specification = completedSpecification(
        pendingBlocks[nextBlockIndex]!,
      )
      if (!specification) return
      if (wroteSpecification) write('')
      writeSpecification(specification, {
        write,
        color,
        columns: options.columns,
        multipleProfiles,
      })
      wroteSpecification = true
      nextBlockIndex++
    }
  }

  function complete(result: TestResult): void {
    const scheduleIndex = claimScheduleIndex(scheduleIndexQueues, result)
    if (scheduleIndex === undefined) return
    completedResults[scheduleIndex] = result
    if (progressive) flushReadyBlocks()
  }

  return {
    start() {
      startTime = clockLabel(now())
      write('')
      const bannerPrefix = ` RUN  pickle ${version} `
      writeWrapped(
        write,
        bannerPrefix,
        projectRoot,
        ' '.repeat(bannerPrefix.length),
        options.columns,
      )
      write('')
    },
    prepare,
    event() {},
    complete,
    finish(runs, durationMs) {
      const results = runs.map((run) => run.result)
      if (completedResults.length === 0) {
        prepare(orderedScheduleFromResults(results))
      }
      if (completedResults.some((result) => !result)) {
        for (const result of results) complete(result)
      }
      flushReadyBlocks()
      const specifications = groupResults(results)
      for (const line of summaryLines(
        specifications,
        results,
        startTime,
        durationMs,
      )) {
        write(line)
      }
    },
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
      write(JSON.stringify({ kind: 'run-event', event }))
    },
    finish(runs) {
      for (const run of runs) {
        write(JSON.stringify({ kind: 'test-result', result: run.result }))
      }
    },
  }
}

export function terminalReporterCapabilities(
  isTerminal: boolean | undefined,
  columns: number | undefined,
  noColor: string | undefined,
  term?: string,
): Pick<
  RunReporterOptions,
  'color' | 'columns' | 'interactive' | 'progressive'
> {
  const interactive = Boolean(isTerminal) && term !== 'dumb'
  return {
    color: interactive && noColor === undefined,
    columns,
    interactive,
    progressive: !interactive,
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
