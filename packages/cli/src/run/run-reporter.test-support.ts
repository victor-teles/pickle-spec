import type { ScenarioRun } from '@pickle-spec/runner'
import type { InteractiveTerminalSurface } from '../terminal/terminal-surface'
import type { RunReporter } from './run-reporter'
import { evaluateTestRunExitStatus } from './test-run-exit-status'

type TerminalOperation = {
  type: 'commit' | 'finish' | 'update'
  lines: string[]
}

type RecordingTerminal = {
  operations: TerminalOperation[]
  surface: InteractiveTerminalSurface
}

export function recordingTerminal(
  columns: () => number | undefined,
  rows: () => number | undefined = () => 24,
): RecordingTerminal {
  const operations: TerminalOperation[] = []
  return {
    operations,
    surface: {
      columns,
      rows,
      commit(lines) {
        operations.push({ type: 'commit', lines: [...lines] })
      },
      finish(lines) {
        operations.push({ type: 'finish', lines: [...lines] })
      },
      update(lines) {
        operations.push({ type: 'update', lines: [...lines] })
      },
    },
  }
}

type PassedRunInput = {
  specificationUri: string
  specificationName: string
  scenarioId: string
  scenarioName: string
  profileId: string
  durationMs: number
}

export function passedRun(input: PassedRunInput): ScenarioRun {
  const startedAt = '2026-08-20T14:32:07.000Z'
  const finishedAt = new Date(
    Date.parse(startedAt) + input.durationMs,
  ).toISOString()
  return {
    events: [],
    result: {
      schemaVersion: 2,
      specification: {
        uri: input.specificationUri,
        name: input.specificationName,
      },
      scenario: { id: input.scenarioId, name: input.scenarioName },
      executionTargetProfile: { id: input.profileId },
      state: 'passed',
      startedAt,
      finishedAt,
      durationMs: input.durationMs,
      attempts: [
        {
          attempt: 1,
          startedAt,
          finishedAt,
          durationMs: input.durationMs,
          state: 'passed',
          steps: [],
          evidenceAvailability: [
            { kind: 'screenshot', state: 'not-supported' },
            { kind: 'trace', state: 'not-supported' },
            { kind: 'recording', state: 'not-supported' },
            { kind: 'device-log', state: 'not-supported' },
            { kind: 'diagnostics', state: 'not-supported' },
          ],
        },
      ],
    },
  }
}

export function finishReporter(
  reporter: RunReporter,
  runs: readonly ScenarioRun[],
  durationMs: number,
): void {
  reporter.finish(
    runs,
    durationMs,
    evaluateTestRunExitStatus(runs.map(({ result }) => result)),
  )
}
