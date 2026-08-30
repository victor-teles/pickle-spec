import {
  runCacheOnlyMiss,
  runScenarioWithExecutionCache,
} from '../execution-cache/run-scenario-cache'
import type {
  RunEvent,
  RunScenarioInput,
  ScenarioAttempt,
  ScenarioRun,
} from './run-scenario-types'
import { runScenarioAttempt } from './scenario/run-scenario-attempt'
import { createTestResult } from './scenario/scenario-results'
import { createScenarioRetryTracker } from './scenario/scenario-retry'

export * from './run-scenario-types'
export { runScenarioAttempt } from './scenario/run-scenario-attempt'
export {
  createSyntheticTestResult,
  createTestResult,
  scenarioFinishedPayload,
  withFinalAttempt,
} from './scenario/scenario-results'

async function appendResequencedEvent(
  input: RunScenarioInput,
  events: RunEvent[],
  event: RunEvent,
): Promise<void> {
  const versionedEvent = {
    ...event,
    sequence: events.length + 1,
  } as RunEvent
  events.push(versionedEvent)
  await input.onEvent?.(versionedEvent)
}

async function runWithoutExecutionCache(
  input: RunScenarioInput,
): Promise<ScenarioRun> {
  const events: RunEvent[] = []
  const attempts: ScenarioAttempt[] = []
  const retries = createScenarioRetryTracker(input.retry)

  for (let attempt = 1; ; attempt++) {
    const attemptInput = {
      ...input,
      mode: 'adaptive',
      attempt,
      onEvent: async (event: RunEvent) => {
        if (event.type === 'scenario-finished') return
        await appendResequencedEvent(input, events, event)
      },
      retry: undefined,
    } as const
    const run = await runScenarioAttempt(attemptInput)
    attempts.push(run.attempt)
    const shouldRetry = retries.shouldRetry({
      state: run.result.state,
      aborted: Boolean(input.signal?.aborted),
    })
    const result = createTestResult(attemptInput, attempts)

    for (const event of run.events) {
      if (event.type !== 'scenario-finished') continue
      await appendResequencedEvent(input, events, event)
    }

    if (shouldRetry) continue
    return { events, result }
  }
}

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
  return runWithoutExecutionCache(input)
}
