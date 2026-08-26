import {
  runCacheOnlyMiss,
  runScenarioWithExecutionCache,
} from '../execution-cache/run-scenario-cache'
import type { RunScenarioInput, ScenarioRun } from './run-scenario'
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
