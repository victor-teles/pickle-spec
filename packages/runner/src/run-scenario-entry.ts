import type { RunScenarioInput, ScenarioRun } from './run-scenario'
import {
  runCacheOnlyMiss,
  runScenarioWithExecutionCache,
} from './run-scenario-cache'
import { runLegacyScenario } from './run-scenario-legacy'

export async function runScenario(
  input: RunScenarioInput,
): Promise<ScenarioRun> {
  const explicitlyRequiresCache =
    input.cachePolicy === 'cache-only' || input.cachePolicy === 'refresh'
  if (
    explicitlyRequiresCache &&
    (!input.adapter.executionCache || !input.executionCache)
  ) {
    return runCacheOnlyMiss(
      input,
      [],
      input.adapter.executionCache
        ? 'Execution cache store is unavailable'
        : 'Execution target adapter does not support Replay',
    )
  }
  if (input.adapter.executionCache && input.executionCache) {
    return runScenarioWithExecutionCache(input)
  }
  return runLegacyScenario(input)
}
