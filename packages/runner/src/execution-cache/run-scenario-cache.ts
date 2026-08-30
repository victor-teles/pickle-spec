import type {
  ExecutionCachePolicy,
  RunEvent,
  RunScenarioInput,
  ScenarioRun,
} from '../execution/run-scenario-types'
import { requiredValue } from '../required-value'
import {
  deserializeExecutionCacheEnvelope,
  type ExecutionCacheKey,
} from './execution-cache'
import { runCoordinatedAdaptive } from './scenario/adaptive-scenario-cache'
import {
  runCacheOnlyMiss,
  runReplayCacheHit,
  runUncacheableScenario,
} from './scenario/replay-scenario-cache'
import {
  appendEvent,
  cacheKeyFor,
  hasSeparatedOutlineBindings,
  nextAttemptScope,
  serializedContainsRuntimeValue,
} from './scenario/scenario-cache-run'

export { runCacheOnlyMiss } from './scenario/replay-scenario-cache'

export async function runScenarioWithExecutionCache(
  input: RunScenarioInput,
): Promise<ScenarioRun> {
  const events: RunEvent[] = []
  const cachePolicy = input.cachePolicy ?? 'prefer-cache'
  const resolvedCacheKey = cacheKeyFor(input)
  const unsafeCacheKey = Boolean(
    resolvedCacheKey &&
      serializedContainsRuntimeValue(
        JSON.stringify(resolvedCacheKey),
        input.scenario,
      ),
  )
  const cacheKey = unsafeCacheKey ? undefined : resolvedCacheKey
  const unsafeOutline = !hasSeparatedOutlineBindings(input.scenario)

  if (!cacheKey || unsafeOutline) {
    return runUncacheableScenario({
      input,
      events,
      cachePolicy,
      unsafeOutline,
      unsafeCacheKey,
    })
  }

  if (cachePolicy === 'refresh') {
    return runCacheRefresh(input, events, cacheKey)
  }

  return runCachedScenario(input, events, cachePolicy, cacheKey)
}

async function runCacheRefresh(
  input: RunScenarioInput,
  events: RunEvent[],
  cacheKey: ExecutionCacheKey,
): Promise<ScenarioRun> {
  await appendEvent(events, input, {
    type: 'cache-refresh',
    cacheKey,
    scope: nextAttemptScope(input),
  })
  const observedSnapshot = await requiredValue(
    input.executionCache,
  ).store.coordination?.readCurrent(cacheKey)
  return runCoordinatedAdaptive({
    input,
    events,
    cacheKey,
    cacheOutcome: 'refresh',
    observedRevision: observedSnapshot?.revision,
  })
}

async function runCachedScenario(
  input: RunScenarioInput,
  events: RunEvent[],
  cachePolicy: ExecutionCachePolicy,
  cacheKey: ExecutionCacheKey,
): Promise<ScenarioRun> {
  const observedSnapshot = await requiredValue(
    input.executionCache,
  ).store.coordination?.readCurrent(cacheKey)
  const source = await requiredValue(input.executionCache).store.read(cacheKey)
  const cacheEntry = source
    ? deserializeExecutionCacheEnvelope({
        source,
        expectedKey: cacheKey,
        payloadValidator: requiredValue(input.adapter.executionCache),
      })
    : undefined
  if (!cacheEntry) {
    if (source) await requiredValue(input.executionCache).store.delete(cacheKey)
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
      observedRevision: observedSnapshot?.revision,
    })
  }

  return runReplayCacheHit({
    input,
    events,
    cachePolicy,
    cacheKey,
    cacheEntry,
    observedRevision: observedSnapshot?.revision,
  })
}
