import { runScenarioAttempt, withAttemptMetadata } from './run-scenario'
import type {
  RunEvent,
  RunScenarioInput,
  ScenarioRun,
} from './run-scenario-types'
import { createScenarioRetryTracker } from './scenario-retry'

export async function runLegacyScenario(
  input: RunScenarioInput,
): Promise<ScenarioRun> {
  const events: RunEvent[] = []
  const retries = createScenarioRetryTracker(input.retry)

  for (let attempt = 1; ; attempt++) {
    const run = await runScenarioAttempt({
      ...input,
      mode: 'adaptive',
      onEvent: async (event) => {
        if (event.type === 'scenario-finished') return
        const versionedEvent = {
          ...event,
          sequence: events.length + 1,
        } as RunEvent
        events.push(versionedEvent)
        await input.onEvent?.(versionedEvent)
      },
      retry: undefined,
    })
    const shouldRetry = retries.shouldRetry({
      state: run.result.state,
      aborted: Boolean(input.signal?.aborted),
    })
    const result = withAttemptMetadata(run.result, attempt)

    for (const event of run.events) {
      if (event.type !== 'scenario-finished') continue
      const versionedEvent = {
        ...event,
        sequence: events.length + 1,
        result: shouldRetry ? event.result : result,
      } as RunEvent
      events.push(versionedEvent)
      await input.onEvent?.(versionedEvent)
    }

    if (shouldRetry) continue
    return { events, result }
  }
}
