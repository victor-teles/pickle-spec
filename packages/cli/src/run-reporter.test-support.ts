import type { ScenarioRun } from '@pickle-spec/runner'
import type { InteractiveTerminalSurface } from './terminal-surface'

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
  return {
    events: [],
    result: {
      schemaVersion: 1,
      specification: {
        uri: input.specificationUri,
        name: input.specificationName,
      },
      scenario: { id: input.scenarioId, name: input.scenarioName },
      executionTargetProfile: { id: input.profileId },
      state: 'passed',
      steps: [],
      durationMs: input.durationMs,
    },
  }
}
