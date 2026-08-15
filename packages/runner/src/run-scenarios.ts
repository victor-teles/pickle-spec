import type { ScenarioSelection } from '@pickle-spec/spec'
import {
  runScenario,
  type ExecutionTargetAdapter,
  type ExecutionTargetProfile,
  type RunEvent,
  type ScenarioRun,
} from './run-scenario'

export interface RunScenariosInput {
  selections: readonly ScenarioSelection[]
  executionTargetProfile: ExecutionTargetProfile
  adapter: ExecutionTargetAdapter
  concurrency?: number
  signal?: AbortSignal
  retry?: {
    infrastructureErrors: number
  }
  timeout?: {
    stepMs?: number
    scenarioMs?: number
  }
  onEvent?: (
    event: RunEvent,
    selection: ScenarioSelection,
  ) => void | Promise<void>
}

export async function runScenarios(input: RunScenariosInput): Promise<ScenarioRun[]> {
  const concurrency = input.concurrency ?? 1
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new Error('concurrency must be an integer greater than or equal to 1')
  }

  const runs = new Array<ScenarioRun>(input.selections.length)
  let nextIndex = 0
  const workerCount = Math.min(concurrency, input.selections.length)

  async function work(): Promise<void> {
    while (nextIndex < input.selections.length) {
      const index = nextIndex++
      const selection = input.selections[index]!
      runs[index] = await runScenario({
        specification: selection.specification,
        scenario: selection.scenario,
        executionTargetProfile: input.executionTargetProfile,
        adapter: input.adapter,
        signal: input.signal,
        retry: input.retry,
        timeout: input.timeout,
        onEvent: input.onEvent
          ? event => input.onEvent!(event, selection)
          : undefined,
      })
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => work()))
  return runs
}
