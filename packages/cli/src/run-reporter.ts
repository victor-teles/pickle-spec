import type { RunEvent, ScenarioRun, TestResult } from '@pickle-spec/runner'

export type RunReporterName = 'default' | 'ndjson'

export interface RunReporter {
  start(): void
  event(event: RunEvent): void
  finish(runs: readonly ScenarioRun[], durationMs: number): void
}

type WriteLine = (line: string) => void

const resultMarks: Record<TestResult['state'], string> = {
  passed: '✓',
  'passed-with-adaptation': '✓',
  failed: '×',
  skipped: '↓',
  cancelled: '×',
  'infrastructure-error': '×',
}

function durationLabel(durationMs: number): string {
  if (durationMs < 1_000) return `${Math.round(durationMs)}ms`
  return `${(durationMs / 1_000).toFixed(2)}s`
}

function resultSuffix(result: TestResult): string {
  const details = []
  if (result.state === 'passed-with-adaptation') details.push('adapted')
  if (result.flaky) details.push(`flaky, ${result.attempts ?? 2} attempts`)
  return details.length > 0 ? ` (${details.join('; ')})` : ''
}

function formatResult(result: TestResult): string {
  const location = [
    result.specification.uri,
    result.specification.name,
    result.scenario.name,
  ].join(' > ')
  const line = ` ${resultMarks[result.state]} ${location} [${result.executionTargetProfile.id}] ${durationLabel(result.durationMs ?? 0)}${resultSuffix(result)}`
  if (!result.message) return line
  return `${line}\n   ${result.message.replaceAll('\n', '\n   ')}`
}

function scenarioSummary(results: readonly TestResult[]): string {
  const counts = {
    passed: 0,
    adapted: 0,
    failed: 0,
    skipped: 0,
    cancelled: 0,
  }
  for (const result of results) {
    if (result.state === 'passed') counts.passed++
    else if (result.state === 'passed-with-adaptation') counts.adapted++
    else if (result.state === 'skipped') counts.skipped++
    else if (result.state === 'cancelled') counts.cancelled++
    else counts.failed++
  }
  const labels = [
    counts.passed ? `${counts.passed} passed` : undefined,
    counts.adapted ? `${counts.adapted} adapted` : undefined,
    counts.failed ? `${counts.failed} failed` : undefined,
    counts.skipped ? `${counts.skipped} skipped` : undefined,
    counts.cancelled ? `${counts.cancelled} cancelled` : undefined,
  ].filter((label): label is string => Boolean(label))
  return `${labels.join(' | ')} (${results.length})`
}

function createDefaultReporter(write: WriteLine): RunReporter {
  return {
    start() {
      write('')
      write(' RUN  pickle run')
      write('')
    },
    event(event) {
      if (event.type === 'scenario-finished') write(formatResult(event.result))
    },
    finish(runs, durationMs) {
      write('')
      write(` Scenarios  ${scenarioSummary(runs.map((run) => run.result))}`)
      write(` Duration   ${durationLabel(durationMs)}`)
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

export function createRunReporter(
  name: RunReporterName,
  write: WriteLine = console.log,
): RunReporter {
  return name === 'ndjson'
    ? createNdjsonReporter(write)
    : createDefaultReporter(write)
}
