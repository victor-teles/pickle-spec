import {
  type RunScenarioInput,
  runLegacyScenario,
  type ScenarioRun,
} from './run-scenario'
import {
  runCacheOnlyMiss,
  runScenarioWithExecutionCache,
} from './run-scenario-cache'

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
