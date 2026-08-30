import {
  type ExecutionCachePolicy,
  type RunEvent,
  type RunScenarioInput,
  type ScenarioRun,
  withFinalAttempt,
} from '../../execution/run-scenario'
import { requiredValue } from '../../required-value'
import {
  type CachedStepPrefix,
  cachedStepPrefixFrom,
} from '../cached-step-prefix'
import {
  type ExecutionCacheEnvelope,
  type ExecutionCacheKey,
  prefixPolicyOf,
} from '../execution-cache'
import { finalizeAdaptiveRun } from './adaptive-cache-finalization'
import { runCoordinatedAdaptive } from './adaptive-scenario-cache'
import {
  appendEvent,
  appendScenarioFinishedEvent,
  appendSyntheticScenarioStartedEvent,
  cacheMissResult,
  finalAttemptScope,
  finishRun,
  nextAttemptScope,
  type RetriedScenarioRun,
  runCachedAttempts,
} from './scenario-cache-run'

export async function runCacheOnlyMiss(
  input: RunScenarioInput,
  events: RunEvent[],
  message: string,
  cacheKey?: ExecutionCacheKey,
): Promise<ScenarioRun> {
  const result = cacheMissResult(input, message)
  await appendSyntheticScenarioStartedEvent(events, input, result)
  if (cacheKey) {
    await appendEvent(events, input, {
      type: 'cache-miss',
      cacheKey,
      scope: finalAttemptScope(input, result),
    })
  }
  return finishRun(input, events, result)
}

interface RunUncacheableScenarioInput {
  input: RunScenarioInput
  events: RunEvent[]
  cachePolicy: ExecutionCachePolicy
  unsafeOutline: boolean
  unsafeCacheKey: boolean
}

export async function runUncacheableScenario(
  options: RunUncacheableScenarioInput,
): Promise<ScenarioRun> {
  const { cachePolicy, events, input, unsafeCacheKey, unsafeOutline } = options
  const hasUnsafeBindings = unsafeOutline || unsafeCacheKey
  if (cachePolicy === 'cache-only') {
    const message = hasUnsafeBindings
      ? 'Scenario parameters cannot be separated safely for Replay'
      : 'Execution cache requires applicationRevision'
    return runCacheOnlyMiss(input, events, message)
  }

  const run = await runCachedAttempts(input, 'adaptive', events)
  return finalizeAdaptiveRun(input, events, {
    run,
    startedFrom: 'miss',
    forcedUncacheableReason: hasUnsafeBindings
      ? 'bound-parameter-value'
      : 'application-revision-missing',
  })
}

interface RunReplayCacheHitInput {
  input: RunScenarioInput
  events: RunEvent[]
  cachePolicy: ExecutionCachePolicy
  cacheKey: ExecutionCacheKey
  cacheEntry: ExecutionCacheEnvelope
  observedRevision?: number
}

async function denyUnusablePrefix(
  options: RunReplayCacheHitInput,
  prefix: CachedStepPrefix | undefined,
): Promise<ScenarioRun | undefined> {
  const { cacheKey, cachePolicy, events, input, observedRevision } = options
  const policy = prefixPolicyOf(requiredValue(input.adapter.executionCache))
  if (!prefix) {
    await requiredValue(input.executionCache).store.delete(cacheKey)
    if (cachePolicy === 'cache-only') {
      return runCacheOnlyMiss(
        input,
        events,
        'Execution cache entry was not found',
        cacheKey,
      )
    }
    await appendEvent(events, input, {
      type: 'cache-miss',
      cacheKey,
      scope: nextAttemptScope(input),
    })
    return runCoordinatedAdaptive({
      input,
      events,
      cacheKey,
      cacheOutcome: 'miss',
      observedRevision,
    })
  }
  const isComplete = prefix.stepCount === input.scenario.steps.length
  if (!isComplete && cachePolicy === 'cache-only') {
    return runCacheOnlyMiss(
      input,
      events,
      'Execution cache prefix does not cover the Scenario',
      cacheKey,
    )
  }
  if (!isComplete && !policy.mixedReplay) {
    await appendEvent(events, input, {
      type: 'cache-miss',
      cacheKey,
      scope: nextAttemptScope(input),
    })
    return runCoordinatedAdaptive({
      input,
      events,
      cacheKey,
      cacheOutcome: 'miss',
      observedRevision,
    })
  }
  return undefined
}

async function finishDivergedReplayHit(
  input: RunScenarioInput,
  events: RunEvent[],
  cacheKey: ExecutionCacheKey,
  replay: RetriedScenarioRun,
): Promise<ScenarioRun> {
  await appendEvent(events, input, {
    type: 'replay-diverged',
    cacheKey,
    scope: finalAttemptScope(input, replay.result),
  })
  return finishRun(
    input,
    events,
    withFinalAttempt(replay.result, {
      cacheOutcome: 'hit',
      inferenceCount: replay.inferenceCount,
      failureKind: 'cache-miss',
    }),
  )
}

async function finishFullReplayHit(
  input: RunScenarioInput,
  events: RunEvent[],
  replay: RetriedScenarioRun,
): Promise<ScenarioRun> {
  await appendEvent(events, input, {
    type: 'inference-count-updated',
    inferenceCount: replay.inferenceCount,
    scope: finalAttemptScope(input, replay.result),
  })
  return finishRun(
    input,
    events,
    withFinalAttempt(replay.result, {
      cacheOutcome: 'hit',
      inferenceCount: 0,
    }),
  )
}

async function startReplayFallback(
  options: RunReplayCacheHitInput,
  replay: RetriedScenarioRun,
): Promise<ScenarioRun> {
  const { cacheKey, events, input, observedRevision } = options
  await appendScenarioFinishedEvent(events, input, replay.result)
  await appendEvent(events, input, {
    type: 'replay-diverged',
    cacheKey,
    scope: finalAttemptScope(input, replay.result),
  })
  await appendEvent(events, input, {
    type: 'adaptive-fallback-started',
    cacheKey,
    scope: nextAttemptScope(input, replay.result.attempts),
  })
  return runCoordinatedAdaptive({
    input,
    events,
    cacheKey,
    cacheOutcome: 'miss',
    observedRevision,
    inferenceOffset: replay.inferenceCount,
    priorAttempts: replay.result.attempts,
  })
}

async function recordPartialReplayDivergence(
  input: RunScenarioInput,
  events: RunEvent[],
  cacheKey: ExecutionCacheKey,
  replay: RetriedScenarioRun,
): Promise<void> {
  await appendEvent(events, input, {
    type: 'replay-diverged',
    cacheKey,
    scope: finalAttemptScope(input, replay.result),
  })
  await appendEvent(events, input, {
    type: 'adaptive-fallback-started',
    cacheKey,
    scope: finalAttemptScope(input, replay.result),
  })
}

async function resolveOpenedReplay(
  options: RunReplayCacheHitInput,
  prefix: CachedStepPrefix,
  replay: RetriedScenarioRun,
): Promise<ScenarioRun | undefined> {
  const { cacheKey, cachePolicy, events, input } = options
  const policy = prefixPolicyOf(requiredValue(input.adapter.executionCache))
  const isComplete = prefix.stepCount === input.scenario.steps.length
  const fullReplayHit =
    isComplete &&
    !replay.adaptiveEvaluated &&
    !replay.replayDiverged &&
    replay.result.state === 'passed' &&
    replay.inferenceCount === 0
  if (fullReplayHit) {
    return finishFullReplayHit(input, events, replay)
  }
  if (cachePolicy === 'cache-only') {
    return finishDivergedReplayHit(input, events, cacheKey, replay)
  }
  if (
    policy.mixedReplay &&
    isComplete &&
    !replay.adaptiveEvaluated &&
    replay.replayDiverged
  ) {
    return finishDivergedReplayHit(input, events, cacheKey, replay)
  }
  if (!policy.mixedReplay && replay.replayDiverged) {
    return startReplayFallback(options, replay)
  }
  if (replay.replayedStepCount < prefix.stepCount) {
    await recordPartialReplayDivergence(input, events, cacheKey, replay)
  }
  return undefined
}

export async function runReplayCacheHit(
  options: RunReplayCacheHitInput,
): Promise<ScenarioRun> {
  const { cacheEntry, cacheKey, events, input } = options
  const adapter = requiredValue(input.adapter.executionCache)
  const prefix = cachedStepPrefixFrom(
    cacheEntry,
    input.scenario.steps.length,
    adapter,
  )
  const denied = await denyUnusablePrefix(options, prefix)
  if (denied) return denied
  if (!prefix) {
    throw new Error('Execution cache prefix was required after admission')
  }

  await appendEvent(events, input, {
    type: 'cache-hit',
    cacheKey,
    scope: nextAttemptScope(input),
  })
  const mode =
    prefix.stepCount === input.scenario.steps.length ? 'replay' : 'adaptive'
  const replay = await runCachedAttempts(input, mode, events, cacheEntry)
  return (
    (await resolveOpenedReplay(options, prefix, replay)) ??
    (await finalizeAdaptiveRun(input, events, {
      run: replay,
      cacheKey,
      startedFrom: 'entry',
    }))
  )
}
