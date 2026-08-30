import type {
  RunEvent,
  RunScenarioInput,
  ScenarioAttempt,
  ScenarioRun,
} from '../../execution/run-scenario-types'
import { withFinalAttempt } from '../../execution/scenario/scenario-results'
import { requiredValue } from '../../required-value'
import { cachedStepPrefixFrom } from '../cached-step-prefix'
import {
  type CacheOutcome,
  deserializeExecutionCacheEnvelope,
  deserializeExecutionCacheTerminalOutcome,
  type ExecutionCacheKey,
  type ExecutionCacheLease,
  prefixPolicyOf,
  type SerializedExecutionCacheTerminalOutcome,
} from '../execution-cache'
import { coordinateExecutionCacheRun } from '../execution-cache-run-coordinator'
import { finalizeAdaptiveRun } from './adaptive-cache-finalization'
import {
  appendEvent,
  appendScenarioFinishedEvent,
  appendSyntheticScenarioStartedEvent,
  finalAttemptScope,
  finishRun,
  nextAttemptScope,
  type RetriedScenarioRun,
  runCachedAttempts,
  syntheticResultWithAttempts,
} from './scenario-cache-run'

async function finishLeaseWait(
  input: RunScenarioInput,
  events: RunEvent[],
  cacheOutcome: CacheOutcome,
  status: 'timed-out' | 'cancelled',
  inferenceCount: number,
  attempts: ScenarioAttempt[],
): Promise<ScenarioRun> {
  const state = status === 'cancelled' ? 'cancelled' : 'infrastructure-error'
  const message =
    status === 'cancelled'
      ? 'Execution cache lease wait was cancelled'
      : 'Execution cache lease wait timed out'
  const result = withFinalAttempt(
    syntheticResultWithAttempts(input, 'adaptive', state, message, attempts),
    {
      cacheOutcome,
      inferenceCount,
    },
  )
  await appendSyntheticScenarioStartedEvent(events, input, result)
  return finishRun(input, events, result)
}

async function finishPublishedDivergence(
  input: RunScenarioInput,
  events: RunEvent[],
  cacheKey: ExecutionCacheKey,
  adapter: NonNullable<RunScenarioInput['adapter']['executionCache']>,
  replay: RetriedScenarioRun,
  inferenceOffset: number,
): Promise<ScenarioRun | undefined> {
  await appendScenarioFinishedEvent(events, input, replay.result)
  await appendEvent(events, input, {
    type: 'replay-diverged',
    cacheKey,
    scope: finalAttemptScope(input, replay.result),
  })
  if (!prefixPolicyOf(adapter).mixedReplay) return undefined
  return finishRun(
    input,
    events,
    withFinalAttempt(replay.result, {
      cacheOutcome: 'hit',
      inferenceCount: inferenceOffset + replay.inferenceCount,
      failureKind: 'cache-miss',
    }),
  )
}

async function finishPublishedHit(
  input: RunScenarioInput,
  events: RunEvent[],
  replay: RetriedScenarioRun,
  inferenceOffset: number,
): Promise<ScenarioRun> {
  await appendEvent(events, input, {
    type: 'inference-count-updated',
    inferenceCount: inferenceOffset + replay.inferenceCount,
    scope: finalAttemptScope(input, replay.result),
  })
  return finishRun(
    input,
    events,
    withFinalAttempt(replay.result, {
      cacheOutcome: 'hit',
      inferenceCount: inferenceOffset,
    }),
  )
}

async function replayPublishedEntry(
  input: RunScenarioInput,
  events: RunEvent[],
  cacheKey: ExecutionCacheKey,
  inferenceOffset = 0,
  attempts: ScenarioAttempt[] = [],
): Promise<ScenarioRun | undefined> {
  const source = await requiredValue(input.executionCache).store.read(cacheKey)
  if (!source) return undefined
  const entry = deserializeExecutionCacheEnvelope({
    source,
    expectedKey: cacheKey,
    payloadValidator: requiredValue(input.adapter.executionCache),
  })
  if (!entry) {
    await requiredValue(input.executionCache).store.delete(cacheKey)
    return undefined
  }
  await appendEvent(events, input, {
    type: 'cache-hit',
    cacheKey,
    scope: nextAttemptScope(input, attempts),
  })
  const adapter = requiredValue(input.adapter.executionCache)
  const prefix = cachedStepPrefixFrom(
    entry,
    input.scenario.steps.length,
    adapter,
  )
  const mode =
    prefix && prefix.stepCount === input.scenario.steps.length
      ? 'replay'
      : 'adaptive'
  const replay = await runCachedAttempts(input, mode, events, entry, attempts)
  if (replay.replayDiverged && !replay.adaptiveEvaluated) {
    return finishPublishedDivergence(
      input,
      events,
      cacheKey,
      adapter,
      replay,
      inferenceOffset,
    )
  }
  if (
    prefix &&
    prefix.stepCount === input.scenario.steps.length &&
    !replay.adaptiveEvaluated &&
    replay.result.state === 'passed' &&
    replay.inferenceCount === 0
  ) {
    return finishPublishedHit(input, events, replay, inferenceOffset)
  }
  return finalizeAdaptiveRun(input, events, {
    run: {
      ...replay,
      inferenceCount: inferenceOffset + replay.inferenceCount,
    },
    cacheKey,
    startedFrom: 'entry',
  })
}

async function reuseTerminalOutcome(
  input: RunScenarioInput,
  events: RunEvent[],
  serialized: SerializedExecutionCacheTerminalOutcome,
  inferenceOffset: number,
  attempts: ScenarioAttempt[],
): Promise<ScenarioRun | undefined> {
  const outcome = deserializeExecutionCacheTerminalOutcome(serialized)
  if (!outcome) return undefined
  let message: string | undefined
  if (outcome.state === 'failed') {
    message = 'Concurrent Adaptive evaluation failed'
  } else if (outcome.state === 'infrastructure-error') {
    message =
      'Concurrent Adaptive evaluation ended with an infrastructure error'
  }
  const result = withFinalAttempt(
    syntheticResultWithAttempts(
      input,
      'adaptive',
      outcome.state,
      message,
      attempts,
    ),
    {
      cacheOutcome: outcome.cacheOutcome,
      inferenceCount: inferenceOffset,
      cacheUncacheableReason: outcome.cacheUncacheableReason,
      failureKind: outcome.failureKind,
    },
  )
  await appendSyntheticScenarioStartedEvent(events, input, result)
  if (outcome.cacheUncacheableReason) {
    await appendEvent(events, input, {
      type: 'cache-uncacheable',
      reason: outcome.cacheUncacheableReason,
      scope: finalAttemptScope(input, result),
    })
  }
  await appendEvent(events, input, {
    type: 'inference-count-updated',
    inferenceCount: inferenceOffset,
    scope: finalAttemptScope(input, result),
  })
  return finishRun(input, events, result)
}

interface RunCoordinatedAdaptiveInput {
  input: RunScenarioInput
  events: RunEvent[]
  cacheKey: ExecutionCacheKey
  cacheOutcome: CacheOutcome
  observedRevision?: number
  inferenceOffset?: number
  priorAttempts?: readonly ScenarioAttempt[]
}

async function runAdaptiveWithoutCoordination(
  options: RunCoordinatedAdaptiveInput,
  attempts: ScenarioAttempt[],
  inferenceOffset: number,
): Promise<ScenarioRun> {
  const { cacheKey, cacheOutcome, events, input } = options
  const adaptive = await runCachedAttempts(
    input,
    'adaptive',
    events,
    undefined,
    attempts,
  )
  return finalizeAdaptiveRun(input, events, {
    run: {
      ...adaptive,
      inferenceCount: inferenceOffset + adaptive.inferenceCount,
    },
    cacheKey,
    startedFrom: cacheOutcome === 'refresh' ? 'refresh' : 'miss',
  })
}

async function finishLostCacheOwnership(
  options: RunCoordinatedAdaptiveInput,
  adaptive: RetriedScenarioRun,
  inferenceOffset: number,
): Promise<ScenarioRun> {
  const { cacheOutcome, events, input } = options
  const run = {
    ...adaptive,
    inferenceCount: inferenceOffset + adaptive.inferenceCount,
  }
  await appendEvent(events, input, {
    type: 'inference-count-updated',
    inferenceCount: run.inferenceCount,
    scope: finalAttemptScope(input, run.result),
  })
  return finishRun(
    input,
    events,
    withFinalAttempt(run.result, {
      state: 'infrastructure-error',
      cacheOutcome,
      inferenceCount: run.inferenceCount,
      message: 'Execution cache lease ownership was lost during evaluation',
    }),
  )
}

function finishCacheOwner(
  options: RunCoordinatedAdaptiveInput,
  adaptive: RetriedScenarioRun,
  lease: ExecutionCacheLease,
  inferenceOffset: number,
): Promise<ScenarioRun> {
  const { cacheKey, cacheOutcome, events, input } = options
  return finalizeAdaptiveRun(input, events, {
    run: {
      ...adaptive,
      inferenceCount: inferenceOffset + adaptive.inferenceCount,
    },
    cacheKey,
    startedFrom: cacheOutcome === 'refresh' ? 'refresh' : 'miss',
    lease,
  })
}

export async function runCoordinatedAdaptive(
  options: RunCoordinatedAdaptiveInput,
): Promise<ScenarioRun> {
  const { cacheKey, cacheOutcome, events, input } = options
  const inferenceOffset = options.inferenceOffset ?? 0
  const attempts = [...(options.priorAttempts ?? [])]
  const coordination = requiredValue(input.executionCache).store.coordination
  if (!coordination) {
    return runAdaptiveWithoutCoordination(options, attempts, inferenceOffset)
  }

  return coordinateExecutionCacheRun({
    coordination,
    cacheKey,
    signal: input.signal,
    observedRevision: options.observedRevision,
    replayPublished: () =>
      replayPublishedEntry(input, events, cacheKey, inferenceOffset, attempts),
    reuseTerminal: (outcome) =>
      reuseTerminalOutcome(input, events, outcome, inferenceOffset, attempts),
    waitEnded: (status) =>
      finishLeaseWait(
        input,
        events,
        cacheOutcome,
        status,
        inferenceOffset,
        attempts,
      ),
    evaluate: () =>
      runCachedAttempts(input, 'adaptive', events, undefined, attempts),
    ownershipLost: (adaptive) =>
      finishLostCacheOwnership(options, adaptive, inferenceOffset),
    completeOwner: (adaptive, lease) =>
      finishCacheOwner(options, adaptive, lease, inferenceOffset),
  })
}
