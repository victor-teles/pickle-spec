import {
  runCacheOnlyMiss,
  runScenarioWithExecutionCache,
} from '../execution-cache/run-scenario-cache'
import { scenarioRevision } from '@pickle-spec/spec'
import { planDigest } from '../execution-plans/execution-plan-json'
import type {
  RunEvent,
  RunScenarioInput,
  ScenarioAttemptInput,
  ScenarioAttempt,
  ScenarioRun,
} from './run-scenario-types'
import { runScenarioAttempt } from './scenario/run-scenario-attempt'
import {
  createSyntheticTestResult,
  createTestResult,
} from './scenario/scenario-results'
import { createScenarioRetryTracker } from './scenario/scenario-retry'
import { scenarioDefinitionId } from './scenario/scenario-runtime'

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
  } satisfies RunEvent
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

async function runAuthoredReplay(
  input: RunScenarioInput,
): Promise<ScenarioRun> {
  const authoredReplay = input.authoredReplay
  if (!authoredReplay) throw new Error('Authored Replay input is required')
  const events: RunEvent[] = []
  const attemptInput: ScenarioAttemptInput = {
    ...input,
    mode: 'replay',
    attempt: 1,
    cacheEntry: {
      schemaVersion: 1,
      key: authoredReplay.planUse.key,
      requiredVariables: [...authoredReplay.replay.requiredVariables],
      adapterPayload: authoredReplay.replay.adapterPayload,
    },
    retry: undefined,
    onEvent: async (event: RunEvent) => {
      if (event.type === 'scenario-finished') return
      await appendResequencedEvent(input, events, event)
    },
  }
  const run = await runScenarioAttempt(attemptInput)
  const invalidReplay =
    run.result.state === 'passed' &&
    (run.adaptiveEvaluated ||
      run.replayDiverged ||
      run.completion?.inferenceCount !== 0)
  const attempt: ScenarioAttempt = invalidReplay
    ? {
        ...run.attempt,
        state: 'failed',
        message:
          'Replay must complete the Scenario with zero evaluation inference',
      }
    : run.attempt
  const result = createTestResult(attemptInput, [attempt])
  for (const event of run.events) {
    if (event.type !== 'scenario-finished') continue
    await appendResequencedEvent(input, events, {
      ...event,
      attempt,
    })
  }
  return { events, result }
}

function authoredReplayPreflight(input: RunScenarioInput): string | undefined {
  const authored = input.authoredReplay
  if (!authored) return undefined
  const cache = input.adapter.executionCache
  if (!cache) return 'Execution target adapter does not support authored Replay'
  const key = authored.planUse.key
  if (!input.projectKey || key.projectKey !== input.projectKey) {
    return 'Authored Replay does not apply to the resolved project'
  }
  const expectedScenarioId = scenarioDefinitionId(
    input.specification,
    input.scenario,
  )
  if (
    key.scenarioId !== expectedScenarioId ||
    key.scenarioRevision !== scenarioRevision(input.scenario) ||
    key.executionTargetProfileId !== input.executionTargetProfile.id ||
    key.applicationRevision !== input.applicationRevision ||
    key.adapterKind !== cache.adapterKind ||
    key.adapterCacheSchemaVersion !== cache.adapterCacheSchemaVersion ||
    key.targetConfigurationFingerprint !== cache.targetConfigurationFingerprint
  ) {
    return 'Authored Replay does not apply to the resolved Scenario and target'
  }
  if (
    planDigest(authored.replay.adapterPayload) !==
    authored.planUse.payloadDigest
  ) {
    return 'Authored Replay payload does not match its Plan use'
  }
  const parsed = cache.parse(
    authored.replay.adapterPayload,
    authored.replay.requiredVariables,
  )
  if (!parsed) return 'Authored Replay payload is invalid'
  if (cache.prefixStepCount(parsed) !== input.scenario.steps.length) {
    return 'Authored Replay must cover the complete Scenario'
  }
  return undefined
}

export async function runScenario(
  input: RunScenarioInput,
): Promise<ScenarioRun> {
  if (input.authoredReplay) {
    const preflightFailure = authoredReplayPreflight(input)
    if (preflightFailure) {
      const result = createSyntheticTestResult(
        input,
        'replay',
        'failed',
        preflightFailure,
      )
      return { events: [], result }
    }
    return runAuthoredReplay(input)
  }
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
