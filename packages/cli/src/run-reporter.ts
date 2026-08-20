import type {
  RunEvent,
  ScenarioRun,
  ScheduledTestResult,
  TestResult,
} from '@pickle-spec/runner'
import {
  createProcessTerminalSurface,
  type InteractiveTerminalSurface,
  renderedTerminalRows,
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

type WriteLine = (line: string) => void

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

type ScenarioGroup = {
  name: string
  results: TestResult[]
}

type SpecificationGroup = {
  uri: string
  name: string
  scenarios: Map<string, ScenarioGroup>
}

type PendingSpecificationBlock = {
  uri: string
  scheduleIndexes: number[]
}

type ScheduleIndexQueue = {
  indexes: number[]
  next: number
}

const progressMarks = ['◐', '◓', '◑', '◒'] as const

function schedulePagedRefresh(refresh: () => void): () => void {
  const timer = setInterval(refresh, 200)
  timer.unref()
  return () => clearInterval(timer)
}

type ResultPresentation = {
  mark: string
  color: number
  detail?: string
  singular: string
  plural: string
}

const resultPresentations: Record<TestResult['state'], ResultPresentation> = {
  failed: {
    mark: '×',
    color: 31,
    detail: 'failed',
    singular: 'failed',
    plural: 'failed',
  },
  'infrastructure-error': {
    mark: '!',
    color: 31,
    detail: 'infrastructure error',
    singular: 'infrastructure error',
    plural: 'infrastructure errors',
  },
  'passed-with-adaptation': {
    mark: '✓',
    color: 33,
    detail: 'adapted',
    singular: 'adapted',
    plural: 'adapted',
  },
  passed: { mark: '✓', color: 32, singular: 'passed', plural: 'passed' },
  skipped: {
    mark: '↓',
    color: 90,
    detail: 'skipped',
    singular: 'skipped',
    plural: 'skipped',
  },
  cancelled: {
    mark: '○',
    color: 33,
    detail: 'cancelled',
    singular: 'cancelled',
    plural: 'cancelled',
  },
}

type TextUnit = {
  value: string
  width: number
}

type ResultPresentationEntry = [TestResult['state'], ResultPresentation]

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
})

function durationLabel(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`
  return `${(durationMs / 1_000).toFixed(2)}s`
}

function clockLabel(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

function stateMark(state: TestResult['state'], color: boolean): string {
  const { mark, color: colorCode } = resultPresentations[state]
  return color ? `\u001b[${colorCode}m${mark}\u001b[39m` : mark
}

function textUnits(value: string): TextUnit[] {
  return [...graphemeSegmenter.segment(value)].map(({ segment }) => ({
    value: segment,
    width: Bun.stringWidth(segment),
  }))
}

function textWidth(units: readonly TextUnit[]): number {
  return units.reduce((total, unit) => total + unit.width, 0)
}

function wrapPoint(units: readonly TextUnit[], width: number): number {
  let naturalBreak = -1
  let forcedBreak = 0
  let consumedWidth = 0
  for (let index = 0; index < units.length; index++) {
    const unit = units[index]
    if (!unit || consumedWidth + unit.width > width) break
    consumedWidth += unit.width
    forcedBreak = index + 1
    if (unit.value === ' ') naturalBreak = index
    if (unit.value === '/') naturalBreak = index + 1
  }
  return naturalBreak > 0 ? naturalBreak : Math.max(1, forcedBreak)
}

function wrappedLines(
  prefix: string,
  content: string,
  continuationPrefix: string,
  columns?: number,
  visiblePrefixLength = prefix.length,
): string[] {
  if (!columns || visiblePrefixLength + Bun.stringWidth(content) <= columns) {
    return [`${prefix}${content}`]
  }

  if (visiblePrefixLength >= columns) {
    return [prefix, ...wrappedLines('', content, '', columns, 0)]
  }

  const lines: string[] = []
  let remaining = textUnits(content)
  let linePrefix = prefix
  let prefixLength = visiblePrefixLength
  while (remaining.length > 0) {
    const width = Math.max(1, columns - prefixLength)
    if (textWidth(remaining) <= width) {
      lines.push(`${linePrefix}${remaining.map((unit) => unit.value).join('')}`)
      break
    }
    const point = wrapPoint(remaining, width)
    lines.push(
      `${linePrefix}${remaining
        .slice(0, point)
        .map((unit) => unit.value)
        .join('')
        .trimEnd()}`,
    )
    remaining = textUnits(
      remaining
        .slice(point)
        .map((unit) => unit.value)
        .join('')
        .trimStart(),
    )
    linePrefix =
      Bun.stringWidth(continuationPrefix) < columns ? continuationPrefix : ''
    prefixLength = Bun.stringWidth(linePrefix)
  }
  return lines
}

function writeWrapped(
  write: WriteLine,
  prefix: string,
  content: string,
  continuationPrefix: string,
  columns?: number,
  visiblePrefixLength?: number,
): void {
  for (const line of wrappedLines(
    prefix,
    content,
    continuationPrefix,
    columns,
    visiblePrefixLength,
  )) {
    write(line)
  }
}

function resultSuffix(result: TestResult): string {
  const details = []
  const stateDetail = resultPresentations[result.state].detail
  if (stateDetail) details.push(stateDetail)
  if (result.flaky) details.push(`flaky, ${result.attempts ?? 2} attempts`)
  return details.length > 0 ? ` (${details.join('; ')})` : ''
}

function scenarioKey(result: TestResult): string {
  if (result.scenario.id) return result.scenario.id
  return `${result.specification.uri}\0${result.scenario.name}`
}

function groupResults(results: readonly TestResult[]): SpecificationGroup[] {
  const specifications = new Map<string, SpecificationGroup>()
  for (const result of results) {
    let specification = specifications.get(result.specification.uri)
    if (!specification) {
      specification = {
        uri: result.specification.uri,
        name: result.specification.name,
        scenarios: new Map(),
      }
      specifications.set(result.specification.uri, specification)
    }

    const key = scenarioKey(result)
    let scenario = specification.scenarios.get(key)
    if (!scenario) {
      scenario = { name: result.scenario.name, results: [] }
      specification.scenarios.set(key, scenario)
    }
    scenario.results.push(result)
  }
  return [...specifications.values()].sort((left, right) =>
    left.uri.localeCompare(right.uri),
  )
}

function groupSchedule(
  schedule: readonly ScheduledTestResult[],
): PendingSpecificationBlock[] {
  const blocks = new Map<string, PendingSpecificationBlock>()
  schedule.forEach((result, scheduleIndex) => {
    let block = blocks.get(result.specification.uri)
    if (!block) {
      block = { uri: result.specification.uri, scheduleIndexes: [] }
      blocks.set(result.specification.uri, block)
    }
    block.scheduleIndexes.push(scheduleIndex)
  })
  return [...blocks.values()].sort((left, right) =>
    left.uri.localeCompare(right.uri),
  )
}

function orderedScheduleFromResults(
  results: readonly TestResult[],
): ScheduledTestResult[] {
  return groupResults(results).flatMap((specification) =>
    [...specification.scenarios.values()].flatMap((scenario) =>
      scenario.results.map((result) => ({
        specification: result.specification,
        scenario: result.scenario,
        executionTargetProfile: result.executionTargetProfile,
      })),
    ),
  )
}

function scheduledResultKey(result: ScheduledTestResult | TestResult): string {
  const scenarioIdentity = result.scenario.id ?? result.scenario.name
  return `${result.specification.uri}\0${scenarioIdentity}\0${result.executionTargetProfile.id}`
}

function scheduledEventMatches(
  scheduled: ScheduledTestResult,
  event: Extract<RunEvent, { type: 'scenario-started' }>,
): boolean {
  const scenarioMatches = event.scenario.id
    ? event.scenario.id === scheduled.scenario.id
    : event.scenario.name === scheduled.scenario.name
  const profileMatches = event.executionTargetProfile
    ? event.executionTargetProfile.id === scheduled.executionTargetProfile.id
    : true
  return scenarioMatches && profileMatches
}

type SpecificationWriterOptions = {
  write: WriteLine
  color: boolean
  columns?: number
  multipleProfiles: boolean
}

function writeSpecification(
  specification: SpecificationGroup,
  options: SpecificationWriterOptions,
): void {
  writeWrapped(options.write, ' ', specification.uri, '   ', options.columns)
  writeWrapped(
    options.write,
    '   ',
    specification.name,
    '     ',
    options.columns,
  )
  writeSpecificationResults(specification, options)
}

function writeSpecificationResults(
  specification: SpecificationGroup,
  options: SpecificationWriterOptions,
): void {
  for (const scenario of specification.scenarios.values()) {
    for (const result of scenario.results) {
      writeTestResult(result, scenario.name, options)
    }
  }
}

function writeTestResult(
  result: TestResult,
  scenarioName: string,
  options: SpecificationWriterOptions,
): void {
  const profile = options.multipleProfiles
    ? `[${result.executionTargetProfile.id}] `
    : ''
  const plainPrefix = `     ${resultPresentations[result.state].mark} ${profile}`
  const styledPrefix = `     ${stateMark(result.state, options.color)} ${profile}`
  writeWrapped(
    options.write,
    styledPrefix,
    `${scenarioName} [${durationLabel(result.durationMs ?? 0)}]${resultSuffix(result)}`,
    ' '.repeat(plainPrefix.length),
    options.columns,
    plainPrefix.length,
  )
  for (const messageLine of result.message?.split('\n') ?? []) {
    writeWrapped(
      options.write,
      '       ',
      messageLine,
      '       ',
      options.columns,
    )
  }
}

function renderSpecification(
  specification: SpecificationGroup,
  options: Omit<SpecificationWriterOptions, 'write'>,
): string[] {
  const lines: string[] = []
  writeSpecification(specification, {
    ...options,
    write: (line) => lines.push(line),
  })
  return lines
}

function testResultSummary(results: readonly TestResult[]): string {
  const entries = Object.entries(
    resultPresentations,
  ) as ResultPresentationEntry[]
  const labels = entries.flatMap(([state, { singular, plural }]) => {
    const count = results.filter((result) => result.state === state).length
    if (count === 0) return []
    return [`${count} ${count === 1 ? singular : plural}`]
  })
  return `${labels.join(' | ')} (${results.length})`
}

function summaryLines(
  specifications: readonly SpecificationGroup[],
  results: readonly TestResult[],
  startTime: string,
  durationMs: number,
): string[] {
  return [
    '',
    ` Specifications  ${specifications.length}`,
    ` Scenarios       ${specifications.reduce((total, specification) => total + specification.scenarios.size, 0)}`,
    ` Test results    ${testResultSummary(results)}`,
    ` Start at        ${startTime}`,
    ` Duration        ${durationLabel(durationMs)}`,
  ]
}

function createDefaultReporter(options: RunReporterOptions): RunReporter {
  const write = options.write ?? console.log
  const now = options.now ?? (() => new Date())
  const projectRoot = options.projectRoot ?? process.cwd()
  const version = options.version ?? 'unknown'
  const color = options.color ?? false
  const terminal =
    options.terminal ??
    (options.interactive
      ? createProcessTerminalSurface(process.stdout, [process.stderr])
      : undefined)
  const progressive = options.progressive ?? false
  let startTime = ''
  let schedule: readonly ScheduledTestResult[] = []
  let completedResults: Array<TestResult | undefined> = []
  let pendingBlocks: PendingSpecificationBlock[] = []
  let nextBlockIndex = 0
  let wroteSpecification = false
  let multipleProfiles = false
  let progressFrame = 0
  let finished = false
  let cancelPagedRefresh: (() => void) | undefined
  const activeSpecificationUris = new Set<string>()
  const committedSpecificationUris = new Set<string>()
  const progressResultsBySpecification = new Map<string, TestResult[]>()
  const scheduleIndexQueues = new Map<string, ScheduleIndexQueue>()

  function columns(): number | undefined {
    return terminal?.columns() ?? options.columns
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
    nextBlockIndex = 0
    wroteSpecification = false
    progressFrame = 0
    activeSpecificationUris.clear()
    committedSpecificationUris.clear()
    progressResultsBySpecification.clear()
    scheduleIndexQueues.clear()
    nextSchedule.forEach((result, index) => {
      const key = scheduledResultKey(result)
      const queue = scheduleIndexQueues.get(key) ?? { indexes: [], next: 0 }
      queue.indexes.push(index)
      scheduleIndexQueues.set(key, queue)
    })
    multipleProfiles =
      new Set(nextSchedule.map((result) => result.executionTargetProfile.id))
        .size > 1
  }

  function flushReadyBlocks(): void {
    while (nextBlockIndex < pendingBlocks.length) {
      const block = pendingBlocks[nextBlockIndex]!
      const specification = completedSpecification(block)
      if (!specification) return
      if (wroteSpecification) write('')
      writeSpecification(specification, {
        write,
        color,
        columns: columns(),
        multipleProfiles,
      })
      wroteSpecification = true
      nextBlockIndex++
    }
  }

  function completedBlockResults(
    block: PendingSpecificationBlock,
  ): TestResult[] {
    return block.scheduleIndexes.flatMap((scheduleIndex) => {
      const result = completedResults[scheduleIndex]
      return result ? [result] : []
    })
  }

  function availableSpecification(
    block: PendingSpecificationBlock,
  ): SpecificationGroup | undefined {
    return groupResults(completedBlockResults(block))[0]
  }

  function completedSpecification(
    block: PendingSpecificationBlock,
  ): SpecificationGroup | undefined {
    const results = completedBlockResults(block)
    if (results.length !== block.scheduleIndexes.length) return undefined
    return groupResults(results)[0]
  }

  function renderActiveHeader(
    block: PendingSpecificationBlock,
    mark: string,
  ): string[] {
    const firstScheduled = schedule[block.scheduleIndexes[0]!]
    if (!firstScheduled) return []
    const completedCount =
      progressResultsBySpecification.get(block.uri)?.length ?? 0
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

  function renderRecentResults(
    results: readonly TestResult[],
    rowBudget: number,
  ): string[] {
    if (rowBudget <= 0 || results.length === 0) return []
    let selectedCount = Math.min(results.length, rowBudget)
    while (selectedCount >= 0) {
      const hiddenCount = results.length - selectedCount
      const lines = hiddenCount
        ? wrappedLines(
            '     … ',
            `${hiddenCount} earlier Test results hidden`,
            '       ',
            columns(),
          )
        : []
      const selectedResults =
        selectedCount === 0 ? [] : results.slice(-selectedCount)
      for (const result of selectedResults) {
        writeTestResult(result, result.scenario.name, {
          write: (line) => lines.push(line),
          color,
          columns: columns(),
          multipleProfiles,
        })
      }
      if (renderedRowCount(lines) <= rowBudget) return lines
      selectedCount--
    }
    return []
  }

  function updateDynamicRegion(): void {
    if (!terminal) return
    const frameIndex = progressFrame++
    const mark = progressMarks[frameIndex % progressMarks.length]!
    const activeBlocks = pendingBlocks.filter(
      (block) =>
        activeSpecificationUris.has(block.uri) &&
        !committedSpecificationUris.has(block.uri),
    )
    const terminalRows = terminal.rows?.()
    const maxRows = terminalRows
      ? Math.max(1, terminalRows - 2)
      : Number.POSITIVE_INFINITY
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
    const resultRowBudget = Math.max(
      0,
      maxRows - renderedRowCount([...headers.flat(), ...overflowLines]),
    )
    let remainingResultRows = resultRowBudget
    const lines = visibleBlocks.flatMap((block, index) => {
      const remainingBlocks = visibleBlocks.length - index
      const blockRowBudget = Number.isFinite(remainingResultRows)
        ? Math.floor(remainingResultRows / remainingBlocks)
        : Number.POSITIVE_INFINITY
      const resultLines = renderRecentResults(
        progressResultsBySpecification.get(block.uri) ?? [],
        blockRowBudget,
      )
      remainingResultRows -= renderedRowCount(resultLines)
      return [...headers[index]!, ...resultLines]
    })
    terminal.update([...lines, ...overflowLines])
    setPagedRefresh(isPaged)
  }

  function commitSpecification(
    uri: string,
    specification: SpecificationGroup,
  ): void {
    if (!terminal) return
    terminal.commit(
      renderSpecification(specification, {
        color,
        columns: columns(),
        multipleProfiles,
      }),
    )
    committedSpecificationUris.add(uri)
    activeSpecificationUris.delete(uri)
  }

  function commitCompletedSpecification(uri: string): void {
    if (!terminal || committedSpecificationUris.has(uri)) return
    const block = pendingBlocks.find((candidate) => candidate.uri === uri)
    if (!block) return
    if (
      progressResultsBySpecification.get(uri)?.length !==
      block.scheduleIndexes.length
    ) {
      return
    }
    const specification = completedSpecification(block)
    if (!specification) return
    commitSpecification(uri, specification)
  }

  function commitAvailableSpecifications(): void {
    if (!terminal) return
    for (const block of pendingBlocks) {
      if (committedSpecificationUris.has(block.uri)) continue
      const specification = availableSpecification(block)
      if (!specification) continue
      commitSpecification(block.uri, specification)
    }
  }

  function finishInteractive(
    results: readonly TestResult[],
    durationMs: number,
    error?: unknown,
  ): void {
    if (!terminal || finished) return
    setPagedRefresh(false)
    commitAvailableSpecifications()
    const specifications = groupResults(results)
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
    terminal.finish(summary)
    finished = true
  }

  function complete(result: TestResult): void {
    const queue = scheduleIndexQueues.get(scheduledResultKey(result))
    if (!queue) {
      throw new Error(
        `Completed unscheduled Scenario "${result.scenario.name}" for execution target profile "${result.executionTargetProfile.id}"`,
      )
    }
    if (queue.next >= queue.indexes.length) return
    const scheduleIndex = queue.indexes[queue.next++]!
    completedResults[scheduleIndex] = result
    const progressResults =
      progressResultsBySpecification.get(result.specification.uri) ?? []
    progressResults.push(result)
    progressResultsBySpecification.set(
      result.specification.uri,
      progressResults,
    )
    if (terminal) {
      activeSpecificationUris.add(result.specification.uri)
      commitCompletedSpecification(result.specification.uri)
      updateDynamicRegion()
    } else if (progressive) flushReadyBlocks()
  }

  return {
    start() {
      startTime = clockLabel(now())
      const bannerPrefix = ` RUN  pickle ${version} `
      const lines: string[] = ['']
      writeWrapped(
        (line) => lines.push(line),
        bannerPrefix,
        projectRoot,
        ' '.repeat(bannerPrefix.length),
        columns(),
      )
      lines.push('')
      if (terminal) {
        terminal.activate?.()
        terminal.commit(lines)
      } else for (const line of lines) write(line)
    },
    prepare,
    event(event) {
      if (!terminal || event.type !== 'scenario-started') return
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
      if (!terminal) return
      const results = completedResults.flatMap((result) =>
        result ? [result] : [],
      )
      finishInteractive(results, durationMs, error)
    },
    refresh: updateDynamicRegion,
    finish(runs, durationMs) {
      const results = runs.map((run) => run.result)
      if (schedule.length === 0) prepare(orderedScheduleFromResults(results))
      if (completedResults.some((result) => !result)) {
        for (const result of results) complete(result)
      }
      if (terminal) finishInteractive(results, durationMs)
      else {
        const specifications = groupResults(results)
        const summary = summaryLines(
          specifications,
          results,
          startTime,
          durationMs,
        )
        flushReadyBlocks()
        for (const line of summary) write(line)
      }
    },
  }
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
  const write = options.write ?? console.log
  return name === 'ndjson'
    ? createNdjsonReporter(write)
    : createDefaultReporter(options)
}
