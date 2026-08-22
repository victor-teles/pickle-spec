import type { RunScenarioInput, ScenarioRun } from './run-scenario'
import {
  runCacheOnlyMiss,
  runScenarioWithExecutionCache,
} from './run-scenario-cache'
import { runLegacyScenario } from './run-scenario-legacy'

export async function runScenario(
  input: RunScenarioInput,
): Promise<ScenarioRun> {
  if (input.cachePolicy === 'cache-only' && !input.adapter.executionCache) {
    return runCacheOnlyMiss(
      input,
      [],
      'Execution target adapter does not support Replay',
    )
  }
  if (input.adapter.executionCache && input.executionCache) {
    return runScenarioWithExecutionCache(input)
  }
  return runLegacyScenario(input)
}
