import type {
  RunEvent,
  ScenarioRun,
  ScheduledTestResult,
  TestResult,
} from '@pickle-spec/runner'
import {
  clockLabel,
  diagnosticLines,
  groupResults,
  renderTestResult,
  summaryLines,
  wrappedLines,
  writeWrapped,
} from './run-report'
import {
  claimScheduleIndex,
  createScheduleIndexQueues,
  groupSchedule,
  orderedScheduleFromResults,
  type PendingSpecificationBlock,
  type ScheduleIndexQueue,
  scheduledEventMatches,
} from './run-schedule'
import {
  availableTerminalRows,
  type InteractiveTerminalSurface,
  renderedTerminalRows,
} from './terminal-surface'

type LiveRunReporterOptions = {
  terminal: InteractiveTerminalSurface
  projectRoot: string
  version: string
  color: boolean
  now(): Date
  scheduleRefresh?: (refresh: () => void) => () => void
}

interface LiveRunReporter {
  start(): void
  prepare(schedule: readonly ScheduledTestResult[]): void
  event(event: RunEvent): void
  complete(result: TestResult): void
  fail(error: unknown, durationMs: number): void
  refresh(): void
  finish(runs: readonly ScenarioRun[], durationMs: number): void
}

const progressMarks = ['◐', '◓', '◑', '◒'] as const
const progressRefreshIntervalMs = 200

function schedulePagedRefresh(refresh: () => void): () => void {
  const timer = setInterval(refresh, progressRefreshIntervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

export function createLiveRunReporter(
  options: LiveRunReporterOptions,
): LiveRunReporter {
  const { terminal } = options
  let startTime = ''
  let schedule: readonly ScheduledTestResult[] = []
  let completedResults: Array<TestResult | undefined> = []
  let pendingBlocks: PendingSpecificationBlock[] = []
  let multipleProfiles = false
  let progressFrame = 0
  let finished = false
  let cancelPagedRefresh: (() => void) | undefined
  const activeSpecificationUris = new Set<string>()
  let scheduleIndexQueues = new Map<string, ScheduleIndexQueue>()

  function columns(): number | undefined {
    return terminal.columns()
  }

  function setPagedRefresh(active: boolean): void {
    if (active && !cancelPagedRefresh) {
      cancelPagedRefresh = (options.scheduleRefresh ?? schedulePagedRefresh)(
        updateDynamicRegion,
      )
      return
    }
    if (!active && cancelPagedRefresh) {
      cancelPagedRefresh()
      cancelPagedRefresh = undefined
    }
  }

  function renderedRowCount(lines: readonly string[]): number {
    return renderedTerminalRows(lines, columns())
  }

  function prepare(nextSchedule: readonly ScheduledTestResult[]): void {
    schedule = nextSchedule
    completedResults = Array.from({ length: nextSchedule.length })
    pendingBlocks = groupSchedule(nextSchedule)
    progressFrame = 0
    activeSpecificationUris.clear()
    scheduleIndexQueues = createScheduleIndexQueues(nextSchedule)
    multipleProfiles =
      new Set(nextSchedule.map((result) => result.executionTargetProfile.id))
        .size > 1
  }

  function completedBlockResults(
    block: PendingSpecificationBlock,
  ): TestResult[] {
    return block.scheduleIndexes.flatMap((scheduleIndex) => {
      const result = completedResults[scheduleIndex]
      return result ? [result] : []
    })
  }

  function renderActiveHeader(
    block: PendingSpecificationBlock,
    mark: string,
  ): string[] {
    const firstScheduled = schedule[block.scheduleIndexes[0]!]
    if (!firstScheduled) return []
    const completedCount = completedBlockResults(block).length
    const resultLabel =
      block.scheduleIndexes.length === 1 ? 'result' : 'results'
    const lines: string[] = []
    writeWrapped(
      (line) => lines.push(line),
      ` ${mark} `,
      `${completedCount}/${block.scheduleIndexes.length} Test ${resultLabel} ${firstScheduled.specification.uri}`,
      '   ',
      columns(),
    )
    return lines
  }

  function updateDynamicRegion(): void {
    const frameIndex = progressFrame++
    const mark = progressMarks[frameIndex % progressMarks.length]!
    const activeBlocks = pendingBlocks.filter((block) =>
      activeSpecificationUris.has(block.uri),
    )
    const maxRows = availableTerminalRows(terminal.rows?.())
    const allHeaders = activeBlocks.map((block) =>
      renderActiveHeader(block, mark),
    )
    const totalHeaderRows = renderedRowCount(allHeaders.flat())
    let visibleBlocks = activeBlocks
    let headers = allHeaders
    let overflowLines: string[] = []
    const isPaged = totalHeaderRows > maxRows && activeBlocks.length > 1
    if (isPaged) {
      const firstIndex = frameIndex % activeBlocks.length
      visibleBlocks = []
      headers = []
      let usedRows = 0
      for (let offset = 0; offset < activeBlocks.length; offset++) {
        const index = (firstIndex + offset) % activeBlocks.length
        const header = allHeaders[index]!
        const headerRows = renderedRowCount(header)
        if (headers.length > 0 && usedRows + headerRows >= maxRows) break
        visibleBlocks.push(activeBlocks[index]!)
        headers.push(header)
        usedRows += headerRows
        if (usedRows >= maxRows) break
      }
      const hiddenCount = activeBlocks.length - visibleBlocks.length
      if (hiddenCount > 0) {
        overflowLines = wrappedLines(
          ' … ',
          `${hiddenCount} more active Specifications`,
          '   ',
          columns(),
        )
        while (
          headers.length > 1 &&
          usedRows + renderedRowCount(overflowLines) > maxRows
        ) {
          usedRows -= renderedRowCount(headers.pop()!)
          visibleBlocks.pop()
        }
      }
    }
    const lines = headers.flat()
    terminal.update([...lines, ...overflowLines])
    setPagedRefresh(isPaged)
  }

  function commitResult(result: TestResult): void {
    terminal.commit(
      renderTestResult(
        result,
        `${result.specification.uri} > ${result.scenario.name}`,
        {
          color: options.color,
          columns: columns(),
          multipleProfiles,
        },
      ),
    )
  }

  function finish(
    results: readonly TestResult[],
    durationMs: number,
    error?: unknown,
  ): void {
    if (finished) return
    setPagedRefresh(false)
    const specifications = groupResults(results)
    const diagnostics = diagnosticLines(results, {
      projectRoot: options.projectRoot,
      color: options.color,
      columns: columns(),
      multipleProfiles,
    })
    const summary = summaryLines(specifications, results, startTime, durationMs)
    if (error !== undefined) {
      const message = error instanceof Error ? error.message : String(error)
      summary.splice(
        1,
        0,
        ...wrappedLines(
          ' Run failed      ',
          message,
          '                 ',
          columns(),
        ),
      )
    }
    terminal.finish([...diagnostics, ...summary])
    finished = true
  }

  function complete(result: TestResult): void {
    const scheduleIndex = claimScheduleIndex(scheduleIndexQueues, result)
    if (scheduleIndex === undefined) return
    completedResults[scheduleIndex] = result
    activeSpecificationUris.add(result.specification.uri)
    commitResult(result)
    const block = pendingBlocks.find(
      (candidate) => candidate.uri === result.specification.uri,
    )
    if (
      block &&
      completedBlockResults(block).length === block.scheduleIndexes.length
    ) {
      activeSpecificationUris.delete(result.specification.uri)
    }
    updateDynamicRegion()
  }

  return {
    start() {
      startTime = clockLabel(options.now())
      const bannerPrefix = ` RUN  pickle ${options.version} `
      const lines: string[] = ['']
      writeWrapped(
        (line) => lines.push(line),
        bannerPrefix,
        options.projectRoot,
        ' '.repeat(bannerPrefix.length),
        columns(),
      )
      lines.push('')
      terminal.activate?.()
      terminal.commit(lines)
    },
    prepare,
    event(event) {
      if (event.type !== 'scenario-started') return
      const scheduleIndex = schedule.findIndex(
        (scheduled, index) =>
          !completedResults[index] && scheduledEventMatches(scheduled, event),
      )
      if (scheduleIndex < 0) return
      const scheduled = schedule[scheduleIndex]
      if (!scheduled) return
      activeSpecificationUris.add(scheduled.specification.uri)
      updateDynamicRegion()
    },
    complete,
    fail(error, durationMs) {
      const results = completedResults.flatMap((result) =>
        result ? [result] : [],
      )
      finish(results, durationMs, error)
    },
    refresh: updateDynamicRegion,
    finish(runs, durationMs) {
      const results = runs.map((run) => run.result)
      if (schedule.length === 0) prepare(orderedScheduleFromResults(results))
      if (completedResults.some((result) => !result)) {
        for (const result of results) complete(result)
      }
      finish(results, durationMs)
    },
  }
}
