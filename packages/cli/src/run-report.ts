import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import type { TestResult } from '@pickle-spec/runner'
import type { TestRunExitStatus } from './test-run-exit-status'

export type WriteLine = (line: string) => void

type ScenarioGroup = {
  name: string
  results: TestResult[]
}

export type SpecificationGroup = {
  uri: string
  name: string
  scenarios: Map<string, ScenarioGroup>
}

type ResultPresentation = {
  mark: string
  color: number
  detail?: string
}

type PropertyPresentation = Pick<ResultPresentation, 'mark' | 'color'>

const resultPresentations: Record<TestResult['state'], ResultPresentation> = {
  failed: {
    mark: '×',
    color: 31,
    detail: 'failed',
  },
  'infrastructure-error': {
    mark: '!',
    color: 35,
    detail: 'infrastructure error',
  },
  passed: { mark: '✓', color: 32, detail: 'passed' },
  skipped: {
    mark: '↓',
    color: 90,
    detail: 'skipped',
  },
  cancelled: {
    mark: '○',
    color: 33,
    detail: 'cancelled',
  },
}

const flakyPresentation: PropertyPresentation = { mark: '↻', color: 36 }

type TextUnit = {
  value: string
  width: number
}

type ResultSummaryPresentation = {
  states: readonly TestResult['state'][]
  singular: string
  plural: string
}

type SpecificationWriterOptions = {
  write: WriteLine
  color: boolean
  columns?: number
  multipleProfiles: boolean
}

const graphemeSegmenter = new Intl.Segmenter(undefined, {
  granularity: 'grapheme',
})

function durationLabel(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`
  return `${(durationMs / 1_000).toFixed(2)}s`
}

export function clockLabel(date: Date): string {
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, '0'))
    .join(':')
}

function presentationMark(
  presentation: PropertyPresentation,
  color: boolean,
): string {
  return color
    ? `\u001b[${presentation.color}m${presentation.mark}\u001b[39m`
    : presentation.mark
}

function stateMark(state: TestResult['state'], color: boolean): string {
  return presentationMark(resultPresentations[state], color)
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

export function wrappedLines(
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

export function writeWrapped(
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
  const details: string[] = []
  const skipReason =
    result.state === 'skipped'
      ? result.message?.split(/\r?\n/, 1)[0]?.trim()
      : undefined
  const stateDetail = skipReason
    ? `skipped: ${skipReason}`
    : resultPresentations[result.state].detail
  if (stateDetail) details.push(stateDetail)
  if (result.flaky) details.push(`flaky, ${result.attempts ?? 2} attempts`)
  if (result.executionMode) {
    const mode = result.executionMode === 'replay' ? 'Replay' : 'Adaptive'
    details.push(`mode ${mode}`)
  }
  if (result.cacheOutcome) {
    const reason = result.cacheUncacheableReason
      ? `: ${result.cacheUncacheableReason}`
      : ''
    details.push(`cache ${result.cacheOutcome}${reason}`)
  }
  if (result.inferenceCount !== undefined) {
    const noun = result.inferenceCount === 1 ? 'inference' : 'inferences'
    details.push(`${result.inferenceCount} ${noun}`)
  }
  return details.length > 0 ? ` (${details.join('; ')})` : ''
}

function scenarioKey(result: TestResult): string {
  if (result.scenario.id) return result.scenario.id
  return `${result.specification.uri}\0${result.scenario.name}`
}

export function groupResults(
  results: readonly TestResult[],
): SpecificationGroup[] {
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

export function writeSpecification(
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
  for (const scenario of specification.scenarios.values()) {
    for (const result of scenario.results) {
      writeTestResult(result, scenario.name, options)
    }
  }
}

function writeResult(
  result: TestResult,
  scenarioName: string,
  options: SpecificationWriterOptions,
  indent: string,
): void {
  const profile = options.multipleProfiles
    ? `[${result.executionTargetProfile.id}] `
    : ''
  const plainFlakyMark = result.flaky ? flakyPresentation.mark : ''
  const styledFlakyMark = result.flaky
    ? presentationMark(flakyPresentation, options.color)
    : ''
  const plainPrefix = `${indent}${resultPresentations[result.state].mark}${plainFlakyMark} ${profile}`
  const styledPrefix = `${indent}${stateMark(result.state, options.color)}${styledFlakyMark} ${profile}`
  writeWrapped(
    options.write,
    styledPrefix,
    `${scenarioName} [${durationLabel(result.durationMs ?? 0)}]${resultSuffix(result)}`,
    ' '.repeat(plainPrefix.length),
    options.columns,
    plainPrefix.length,
  )
}

export function writeTestResult(
  result: TestResult,
  scenarioName: string,
  options: SpecificationWriterOptions,
): void {
  writeResult(result, scenarioName, options, '     ')
}

export function renderTestResult(
  result: TestResult,
  scenarioName: string,
  options: Omit<SpecificationWriterOptions, 'write'>,
): string[] {
  const lines: string[] = []
  writeResult(
    result,
    scenarioName,
    {
      ...options,
      write: (line) => lines.push(line),
    },
    ' ',
  )
  return lines
}

export function renderTestStepResult(
  result: TestResult['steps'][number],
  options: Pick<SpecificationWriterOptions, 'color' | 'columns'>,
): string[] {
  const lines: string[] = []
  const plainPrefix = `     ${resultPresentations[result.state].mark} `
  const styledPrefix = `     ${stateMark(result.state, options.color)} `
  writeWrapped(
    (line) => lines.push(line),
    styledPrefix,
    `${result.step.keyword} ${result.step.text}`,
    '       ',
    options.columns,
    plainPrefix.length,
  )
  return lines
}

export function renderSpecification(
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

type DiagnosticWriterOptions = SpecificationWriterOptions & {
  projectRoot: string
}

type DiagnosticState = Extract<
  TestResult['state'],
  'failed' | 'infrastructure-error'
>

const diagnosticHeadings: Record<
  DiagnosticState,
  { section: string; label: string }
> = {
  failed: { section: 'Failures', label: 'Failure' },
  'infrastructure-error': {
    section: 'Infrastructure errors',
    label: 'Infrastructure error',
  },
}

function orderedResults(results: readonly TestResult[]): TestResult[] {
  return groupResults(results).flatMap((specification) =>
    [...specification.scenarios.values()].flatMap(
      (scenario) => scenario.results,
    ),
  )
}

function writeMessage(
  message: string,
  options: DiagnosticWriterOptions,
  prefix = '       ',
): void {
  for (const line of message.split(/\r?\n/)) {
    writeWrapped(options.write, prefix, line, prefix, options.columns)
  }
}

function canonicalPath(path: string): string {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

function displayArtifactPath(path: string, projectRoot: string): string {
  const canonicalProjectRoot = canonicalPath(projectRoot)
  const absolutePath = canonicalPath(resolve(projectRoot, path))
  const projectRelativePath = relative(canonicalProjectRoot, absolutePath)
  const isContained =
    projectRelativePath.length > 0 &&
    projectRelativePath !== '..' &&
    !projectRelativePath.startsWith(`..${sep}`) &&
    !isAbsolute(projectRelativePath)
  return isContained ? projectRelativePath : absolutePath
}

function writeArtifacts(
  stepResult: TestResult['steps'][number],
  options: DiagnosticWriterOptions,
): void {
  if (!stepResult.artifacts?.length) return
  options.write('       Artifacts')
  for (const artifact of stepResult.artifacts) {
    writeWrapped(
      options.write,
      `         ${artifact.kind}: `,
      displayArtifactPath(artifact.path, options.projectRoot),
      '           ',
      options.columns,
    )
  }
}

function writeDiagnostic(
  result: TestResult,
  options: DiagnosticWriterOptions,
): void {
  if (result.state !== 'failed' && result.state !== 'infrastructure-error') {
    return
  }
  const heading = diagnosticHeadings[result.state]
  options.write('')
  options.write(` ${stateMark(result.state, options.color)} ${heading.label}`)
  writeWrapped(
    options.write,
    '   Specification  ',
    `${result.specification.name} (${result.specification.uri})`,
    '                  ',
    options.columns,
  )
  writeWrapped(
    options.write,
    '   Scenario       ',
    result.scenario.name,
    '                  ',
    options.columns,
  )
  if (options.multipleProfiles) {
    writeWrapped(
      options.write,
      '   Profile        ',
      result.executionTargetProfile.id,
      '                  ',
      options.columns,
    )
  }
  if (result.steps.length > 0) {
    options.write('   Steps')
    for (const step of result.steps) {
      for (const line of renderTestStepResult(step, options)) {
        options.write(line)
      }
      if (step.message) writeMessage(step.message, options)
      writeArtifacts(step, options)
    }
  }
  const messageBelongsToStep = result.steps.some(
    (step) => step.state === result.state && step.message === result.message,
  )
  if (result.message && !messageBelongsToStep) {
    options.write('   Message')
    writeMessage(result.message, options, '     ')
  }
}

export function diagnosticLines(
  results: readonly TestResult[],
  options: Omit<DiagnosticWriterOptions, 'write'>,
): string[] {
  const lines: string[] = []
  const ordered = orderedResults(results)
  const states: DiagnosticState[] = ['failed', 'infrastructure-error']
  const writerOptions = {
    ...options,
    write: (line: string) => lines.push(line),
  }
  for (const state of states) {
    const diagnostics = ordered.filter((result) => result.state === state)
    if (diagnostics.length === 0) continue
    lines.push('', ` ${diagnosticHeadings[state].section}`)
    for (const result of diagnostics) writeDiagnostic(result, writerOptions)
  }
  return lines
}

export function interruptionLines(
  exitStatus: TestRunExitStatus,
  columns?: number,
): string[] {
  if (!exitStatus.interrupted) return []
  return [
    ...wrappedLines(' ! ', 'Run interrupted', '   ', columns),
    ...wrappedLines(
      '   ',
      'Partial summary: every Test result materialized before interruption is included.',
      '   ',
      columns,
    ),
  ]
}

function testResultSummary(results: readonly TestResult[]): string {
  const entries: ResultSummaryPresentation[] = [
    { states: ['failed'], singular: 'failed', plural: 'failed' },
    {
      states: ['infrastructure-error'],
      singular: 'infrastructure error',
      plural: 'infrastructure errors',
    },
    { states: ['passed'], singular: 'passed', plural: 'passed' },
    { states: ['skipped'], singular: 'skipped', plural: 'skipped' },
    { states: ['cancelled'], singular: 'cancelled', plural: 'cancelled' },
  ]
  const labels = entries.flatMap(({ states, singular, plural }) => {
    const count = results.filter((result) =>
      states.includes(result.state),
    ).length
    if (count === 0) return []
    return [`${count} ${count === 1 ? singular : plural}`]
  })
  return `${labels.join(' | ')} (${results.length})`
}

export function summaryLines(
  specifications: readonly SpecificationGroup[],
  results: readonly TestResult[],
  startTime: string,
  durationMs: number,
): string[] {
  const flakyResults = results.filter((result) => result.flaky).length
  return [
    '',
    ` Specifications  ${specifications.length}`,
    ` Scenarios       ${specifications.reduce((total, specification) => total + specification.scenarios.size, 0)}`,
    ` Test results    ${testResultSummary(results)}`,
    ...(flakyResults > 0 ? [` Flaky results   ${flakyResults}`] : []),
    ` Start at        ${startTime}`,
    ` Duration        ${durationLabel(durationMs)}`,
  ]
}
