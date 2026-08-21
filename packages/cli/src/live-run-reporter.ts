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
  const activeScheduleIndexes = new Set<number>()
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
    activeScheduleIndexes.clear()
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

  function renderActiveBlock(
    block: PendingSpecificationBlock,
    mark: string,
  ): string[] {
    const lines = renderActiveHeader(block, mark)
    for (const scheduleIndex of block.scheduleIndexes) {
      if (!activeScheduleIndexes.has(scheduleIndex)) continue
      const scheduled = schedule[scheduleIndex]
      if (!scheduled) continue
      const profile = multipleProfiles
        ? `[${scheduled.executionTargetProfile.id}] `
        : ''
      writeWrapped(
        (line) => lines.push(line),
        '   → ',
        `${profile}${scheduled.scenario.name}`,
        '     ',
        columns(),
      )
    }
    return lines
  }

  function updateDynamicRegion(): void {
    const frameIndex = progressFrame++
    const mark = progressMarks[frameIndex % progressMarks.length]!
    const activeBlocks = pendingBlocks.filter((block) =>
      block.scheduleIndexes.some((scheduleIndex) =>
        activeScheduleIndexes.has(scheduleIndex),
      ),
    )
    const maxRows = availableTerminalRows(terminal.rows?.())
    const allBlockLines = activeBlocks.map((block) =>
      renderActiveBlock(block, mark),
    )
    const totalBlockRows = renderedRowCount(allBlockLines.flat())
    let visibleBlocks = activeBlocks
    let blockLines = allBlockLines
    let overflowLines: string[] = []
    const isPaged = totalBlockRows > maxRows && activeBlocks.length > 1
    if (isPaged) {
      const firstIndex = frameIndex % activeBlocks.length
      visibleBlocks = []
      blockLines = []
      let usedRows = 0
      for (let offset = 0; offset < activeBlocks.length; offset++) {
        const index = (firstIndex + offset) % activeBlocks.length
        const lines = allBlockLines[index]!
        const lineRows = renderedRowCount(lines)
        if (blockLines.length > 0 && usedRows + lineRows >= maxRows) break
        visibleBlocks.push(activeBlocks[index]!)
        blockLines.push(lines)
        usedRows += lineRows
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
          blockLines.length > 1 &&
          usedRows + renderedRowCount(overflowLines) > maxRows
        ) {
          usedRows -= renderedRowCount(blockLines.pop()!)
          visibleBlocks.pop()
        }
      }
    }
    const lines = blockLines.flat()
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
    activeScheduleIndexes.delete(scheduleIndex)
    commitResult(result)
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
      activeScheduleIndexes.add(scheduleIndex)
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
