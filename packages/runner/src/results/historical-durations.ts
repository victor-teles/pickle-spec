import type { TestResult } from '../execution/run-scenario'
import { requiredValue } from '../required-value'
import type { TestRunStore } from './test-run-store'

function resultScenarioKey(result: TestResult): string {
  if (result.scenario.id) return result.scenario.id
  return `${result.specification.uri}::${result.scenario.name}`
}

export function historicalDurationsFrom(
  results: readonly TestResult[],
): Record<string, number> {
  const durations: Record<string, number> = {}
  for (const result of results) {
    if (typeof result.durationMs !== 'number') continue
    const key = resultScenarioKey(result)
    const current = durations[key]
    if (current === undefined || result.durationMs > current) {
      durations[key] = result.durationMs
    }
  }
  return durations
}

export async function latestHistoricalDurations(
  store: TestRunStore,
): Promise<Record<string, number>> {
  const runs = await store.list()
  const latest = runs
    .filter((run) => run.finishedAt)
    .sort((left, right) =>
      requiredValue(right.finishedAt).localeCompare(
        requiredValue(left.finishedAt),
      ),
    )[0]
  if (!latest) return {}
  const persisted = await store.open(latest.id)
  const manifest = await persisted.materialize()
  return historicalDurationsFrom(manifest.results)
}
