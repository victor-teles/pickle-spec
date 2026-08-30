import { createTestResult, runScenarioAttempt } from './run-scenario'
import type {
  RunEvent,
  RunScenarioInput,
  ScenarioAttempt,
  ScenarioRun,
} from './run-scenario-types'
import { createScenarioRetryTracker } from './scenario/scenario-retry'

export async function runLegacyScenario(
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
        const versionedEvent = {
          ...event,
          sequence: events.length + 1,
        } as RunEvent
        events.push(versionedEvent)
        await input.onEvent?.(versionedEvent)
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
      const versionedEvent = {
        ...event,
        sequence: events.length + 1,
      } as RunEvent
      events.push(versionedEvent)
      await input.onEvent?.(versionedEvent)
    }

    if (shouldRetry) continue
    return { events, result }
  }
}
