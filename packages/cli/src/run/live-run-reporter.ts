import type {
  RunEvent,
  ScheduledTestResult,
  TestResult,
} from '@pickle-spec/runner'
import { requiredValue } from '../required-value'
import { withRecoveryFailure } from '../terminal/command-error'
import {
  availableTerminalRows,
  type InteractiveTerminalSurface,
  renderedTerminalRows,
} from '../terminal/terminal-surface'
import {
  clockLabel,
  diagnosticLines,
  groupResults,
  interruptionLines,
  renderTestResult,
  renderTestStepResult,
  summaryLines,
  wrappedLines,
  writeWrapped,
} from './run-report'
import type { RunReporter } from './run-reporter'
import {
  claimScheduleIndex,
  createScheduleIndexQueues,
  groupSchedule,
  orderedScheduleFromResults,
  type PendingSpecificationBlock,
  type ScheduleIndexQueue,
  scheduledEventMatches,
} from './run-schedule'
import type { TestRunExitStatus } from './test-run-exit-status'

type LiveRunReporterOptions = {
  terminal: InteractiveTerminalSurface
  projectRoot: string
  version: string
  color: boolean
  now(): Date
  scheduleRefresh?: (refresh: () => void) => () => void
}

type StepStartedEvent = Extract<RunEvent, { type: 'step-started' }>
type StepFinishedEvent = Extract<RunEvent, { type: 'step-finished' }>

type LiveScenarioProgress = {
  completedSteps: StepFinishedEvent['result'][]
  runningStep?: StepStartedEvent['step']
}

const progressMarks = ['◐', '◓', '◑', '◒'] as const
const progressRefreshIntervalMs = 200

function schedulePagedRefresh(refresh: () => void): () => void {
  const timer = setInterval(refresh, progressRefreshIntervalMs)
  timer.unref()
  return () => clearInterval(timer)
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: the reporter is a cohesive closure whose focused render and lifecycle functions share one private terminal state
export function createLiveRunReporter(
  options: LiveRunReporterOptions,
): RunReporter {
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
  const progressByScheduleIndex = new Map<number, LiveScenarioProgress>()
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
    progressByScheduleIndex.clear()
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
    const firstScheduled = schedule[requiredValue(block.scheduleIndexes[0])]
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
      lines.push(...renderActiveScenario(scheduleIndex, mark))
    }
    return lines
  }

  function renderActiveScenario(scheduleIndex: number, mark: string): string[] {
    if (!activeScheduleIndexes.has(scheduleIndex)) return []
    const scheduled = schedule[scheduleIndex]
    if (!scheduled) return []
    const lines: string[] = []
    const profile = multipleProfiles
      ? `[${scheduled.executionTargetProfile.id}] `
      : ''
    writeWrapped(
      (line) => lines.push(line),
      `   ${mark} `,
      `${profile}${scheduled.scenario.name}`,
      '     ',
      columns(),
    )
    return [
      ...lines,
      ...renderScenarioProgress(
        progressByScheduleIndex.get(scheduleIndex),
        mark,
      ),
    ]
  }

  function renderScenarioProgress(
    progress: LiveScenarioProgress | undefined,
    mark: string,
  ): string[] {
    const lines = (progress?.completedSteps ?? []).flatMap((result) =>
      renderTestStepResult(result, {
        color: options.color,
        columns: columns(),
      }),
    )
    if (!progress?.runningStep) return lines
    writeWrapped(
      (line) => lines.push(line),
      `     ${mark} `,
      `${progress.runningStep.keyword} ${progress.runningStep.text}`,
      '       ',
      columns(),
    )
    return lines
  }

  function pagedBlocks(
    activeBlocks: readonly PendingSpecificationBlock[],
    allBlockLines: readonly string[][],
    frameIndex: number,
    maxRows: number,
  ): { blockLines: string[][]; overflowLines: string[] } {
    const { blockLines, usedRows } = collectPagedBlocks(
      activeBlocks,
      allBlockLines,
      frameIndex,
      maxRows,
    )
    const hiddenCount = activeBlocks.length - blockLines.length
    if (hiddenCount === 0) return { blockLines, overflowLines: [] }
    const overflowLines = wrappedLines(
      ' … ',
      `${hiddenCount} more active Specifications`,
      '   ',
      columns(),
    )
    trimPagedBlocks(blockLines, usedRows, overflowLines, maxRows)
    return { blockLines, overflowLines }
  }

  function collectPagedBlocks(
    activeBlocks: readonly PendingSpecificationBlock[],
    allBlockLines: readonly string[][],
    frameIndex: number,
    maxRows: number,
  ): { blockLines: string[][]; usedRows: number } {
    const firstIndex = frameIndex % activeBlocks.length
    const blockLines: string[][] = []
    let usedRows = 0
    for (let offset = 0; offset < activeBlocks.length; offset++) {
      const index = (firstIndex + offset) % activeBlocks.length
      const lines = requiredValue(allBlockLines[index])
      const lineRows = renderedRowCount(lines)
      if (blockLines.length > 0 && usedRows + lineRows >= maxRows) break
      blockLines.push(lines)
      usedRows += lineRows
      if (usedRows >= maxRows) break
    }
    return { blockLines, usedRows }
  }

  function trimPagedBlocks(
    blockLines: string[][],
    initialUsedRows: number,
    overflowLines: readonly string[],
    maxRows: number,
  ): void {
    let usedRows = initialUsedRows
    while (
      blockLines.length > 1 &&
      usedRows + renderedRowCount(overflowLines) > maxRows
    ) {
      usedRows -= renderedRowCount(requiredValue(blockLines.pop()))
    }
  }

  function updateDynamicRegion(): void {
    const frameIndex = progressFrame++
    const mark = requiredValue(progressMarks[frameIndex % progressMarks.length])
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
    const isPaged = totalBlockRows > maxRows && activeBlocks.length > 1
    const { blockLines, overflowLines } = isPaged
      ? pagedBlocks(activeBlocks, allBlockLines, frameIndex, maxRows)
      : { blockLines: allBlockLines, overflowLines: [] }
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

  function finishOutput(
    results: readonly TestResult[],
    durationMs: number,
    summaryNotice: readonly string[],
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
    summary.splice(1, 0, ...summaryNotice)
    finished = true
    terminal.finish([...diagnostics, ...summary])
  }

  function finishFailure(
    results: readonly TestResult[],
    durationMs: number,
    error: unknown,
  ): void {
    const message = error instanceof Error ? error.message : String(error)
    finishOutput(
      results,
      durationMs,
      wrappedLines(
        ' Run failed      ',
        message,
        '                 ',
        columns(),
      ),
    )
  }

  function finishWithoutOutput(): void {
    if (finished) return
    setPagedRefresh(false)
    finished = true
    terminal.finish([])
  }

  function finishTestRun(
    results: readonly TestResult[],
    durationMs: number,
    exitStatus: TestRunExitStatus,
  ): void {
    finishOutput(results, durationMs, interruptionLines(exitStatus, columns()))
  }

  function complete(result: TestResult): void {
    const scheduleIndex = claimScheduleIndex(scheduleIndexQueues, result)
    if (scheduleIndex === undefined) return
    completedResults[scheduleIndex] = result
    activeScheduleIndexes.delete(scheduleIndex)
    progressByScheduleIndex.delete(scheduleIndex)
    commitResult(result)
    updateDynamicRegion()
  }

  function activeScheduleIndex(
    event: Extract<RunEvent, { type: 'step-started' | 'step-finished' }>,
  ): number | undefined {
    const scheduleIndex = schedule.findIndex(
      (scheduled, index) =>
        activeScheduleIndexes.has(index) &&
        scheduledEventMatches(scheduled, event),
    )
    return scheduleIndex < 0 ? undefined : scheduleIndex
  }

  function startScenario(
    event: Extract<RunEvent, { type: 'scenario-started' }>,
  ): void {
    const scheduleIndex = schedule.findIndex(
      (scheduled, index) =>
        !completedResults[index] && scheduledEventMatches(scheduled, event),
    )
    if (scheduleIndex < 0) return
    activeScheduleIndexes.add(scheduleIndex)
    progressByScheduleIndex.set(scheduleIndex, { completedSteps: [] })
    updateDynamicRegion()
  }

  function updateStep(
    event: Extract<RunEvent, { type: 'step-started' | 'step-finished' }>,
  ): void {
    const scheduleIndex = activeScheduleIndex(event)
    if (scheduleIndex === undefined) return
    const progress = progressByScheduleIndex.get(scheduleIndex) ?? {
      completedSteps: [],
    }
    if (event.type === 'step-started') progress.runningStep = event.step
    else {
      progress.completedSteps.push(event.result)
      progress.runningStep = undefined
    }
    progressByScheduleIndex.set(scheduleIndex, progress)
    updateDynamicRegion()
  }

  function recordEvent(event: RunEvent): void {
    if (event.type === 'scenario-started') {
      startScenario(event)
      return
    }
    if (event.type === 'step-started' || event.type === 'step-finished') {
      updateStep(event)
    }
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
    event: recordEvent,
    complete,
    fail(error, durationMs) {
      const results = completedResults.flatMap((result) =>
        result ? [result] : [],
      )
      if (results.length === 0) {
        finishWithoutOutput()
        return
      }
      try {
        finishFailure(results, durationMs, error)
      } catch (renderError) {
        try {
          finishWithoutOutput()
        } catch (restoreError) {
          throw withRecoveryFailure(
            renderError,
            'Failed to restore terminal output',
            restoreError,
          )
        }
        throw renderError
      }
    },
    refresh: updateDynamicRegion,
    finish(runs, durationMs, exitStatus) {
      const results = runs.map((run) => run.result)
      if (schedule.length === 0) prepare(orderedScheduleFromResults(results))
      if (completedResults.some((result) => !result)) {
        for (const result of results) complete(result)
      }
      finishTestRun(results, durationMs, exitStatus)
    },
  }
}
