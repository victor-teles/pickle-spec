import type { RunEvent, ScenarioRun, TestResult } from '@pickle-spec/runner'

export type RunReporterName = 'default' | 'ndjson'

export interface RunReporter {
  start(): void
  event(event: RunEvent): void
  finish(runs: readonly ScenarioRun[], durationMs: number): void
}

type WriteLine = (line: string) => void

type RunReporterOptions = {
  write?: WriteLine
  projectRoot?: string
  version?: string
  color?: boolean
  columns?: number
  now?: () => Date
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
    linePrefix = continuationPrefix
    prefixLength = continuationPrefix.length
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

function createDefaultReporter(options: RunReporterOptions): RunReporter {
  const write = options.write ?? console.log
  const now = options.now ?? (() => new Date())
  const projectRoot = options.projectRoot ?? process.cwd()
  const version = options.version ?? 'unknown'
  const color = options.color ?? false
  const columns = options.columns
  let startTime = ''

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
        columns,
      )
      write('')
    },
    event() {},
    finish(runs, durationMs) {
      const results = runs.map((run) => run.result)
      const multipleProfiles =
        new Set(results.map((result) => result.executionTargetProfile.id))
          .size > 1
      const specifications = groupResults(results)

      specifications.forEach((specification, specificationIndex) => {
        if (specificationIndex > 0) write('')
        writeWrapped(write, ' ', specification.uri, '   ', columns)
        writeWrapped(write, '   ', specification.name, '     ', columns)
        for (const scenario of specification.scenarios.values()) {
          for (const result of scenario.results) {
            const profile = multipleProfiles
              ? `[${result.executionTargetProfile.id}] `
              : ''
            const plainPrefix = `     ${resultPresentations[result.state].mark} ${profile}`
            const styledPrefix = `     ${stateMark(result.state, color)} ${profile}`
            writeWrapped(
              write,
              styledPrefix,
              `${scenario.name} [${durationLabel(result.durationMs ?? 0)}]${resultSuffix(result)}`,
              ' '.repeat(plainPrefix.length),
              columns,
              plainPrefix.length,
            )
            for (const messageLine of result.message?.split('\n') ?? []) {
              writeWrapped(write, '       ', messageLine, '       ', columns)
            }
          }
        }
      })

      write('')
      write(` Specifications  ${specifications.length}`)
      write(
        ` Scenarios       ${specifications.reduce((total, specification) => total + specification.scenarios.size, 0)}`,
      )
      write(` Test results    ${testResultSummary(results)}`)
      write(` Start at        ${startTime}`)
      write(` Duration        ${durationLabel(durationMs)}`)
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
): Pick<RunReporterOptions, 'color' | 'columns'> {
  return {
    color: Boolean(isTerminal) && noColor === undefined,
    columns,
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
