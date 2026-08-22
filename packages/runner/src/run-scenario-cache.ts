import { type Scenario, scenarioRevision } from '@pickle-spec/spec'
import {
  type CacheOutcome,
  deserializeExecutionCacheEnvelope,
  type ExecutionCacheCoordination,
  type ExecutionCacheEnvelope,
  type ExecutionCacheKey,
  type ExecutionCacheLease,
  type ExecutionCacheUncacheableReason,
  resolveExecutionCacheKey,
  type SerializedExecutionCacheEnvelope,
  serializeExecutionCacheEnvelope,
} from './execution-cache'
import {
  type AttemptScenarioRun,
  createTestResult,
  type ExecutionMode,
  type RunEvent,
  type RunEventPayload,
  type RunScenarioInput,
  runScenarioAttempt,
  type ScenarioRun,
  type TestResult,
  withAttemptMetadata,
} from './run-scenario'
import { createScenarioRetryTracker } from './scenario-retry'
import {
  nonemptyBindings,
  scenarioDefinitionId,
  stringContainsBinding,
} from './scenario-runtime'

interface RetriedScenarioRun extends AttemptScenarioRun {
  inferenceCount: number
}

async function appendEvent(
  events: RunEvent[],
  input: RunScenarioInput,
  payload: RunEventPayload,
): Promise<void> {
  const event = {
    ...payload,
    schemaVersion: 1 as const,
    sequence: events.length + 1,
  } as RunEvent
  events.push(event)
  await input.onEvent?.(event)
}

async function runCachedAttempts(
  input: RunScenarioInput,
  mode: ExecutionMode,
  events: RunEvent[],
  cacheEntry?: ExecutionCacheEnvelope,
): Promise<RetriedScenarioRun> {
  const retries = createScenarioRetryTracker(input.retry)
  let inferenceCount = 0
  let runtimeValueExposed = false

  for (let attempt = 1; ; attempt++) {
    const run = await runScenarioAttempt({
      ...input,
      mode,
      cacheEntry,
      plans: undefined,
      retry: undefined,
      onEvent: async (event) => {
        if (event.type === 'scenario-finished') return
        await appendEvent(events, input, event)
      },
    })
    inferenceCount += run.completion?.inferenceCount ?? 0
    runtimeValueExposed ||= run.runtimeValueExposed
    const replayCompletionInvalid =
      mode === 'replay' &&
      run.result.state === 'passed' &&
      (run.completion === undefined || run.completion.inferenceCount !== 0)
    const completedRun: AttemptScenarioRun = replayCompletionInvalid
      ? {
          ...run,
          replayDiverged: true,
          result: {
            ...run.result,
            state: 'failed',
            message:
              'Replay must complete the Scenario with zero evaluation inference',
          },
        }
      : run
    const shouldRetry = retries.shouldRetry({
      state: completedRun.result.state,
      replayDiverged: completedRun.replayDiverged,
      aborted: Boolean(input.signal?.aborted),
    })
    const result = withAttemptMetadata(completedRun.result, attempt)

    if (shouldRetry) {
      await appendEvent(events, input, { type: 'scenario-finished', result })
      continue
    }
    return {
      ...completedRun,
      result,
      inferenceCount,
      runtimeValueExposed,
    }
  }
}

function cacheKeyFor(input: RunScenarioInput): ExecutionCacheKey | undefined {
  const adapterCache = input.adapter.executionCache
  const runtimeCache = input.executionCache
  if (!adapterCache || !runtimeCache) return undefined
  return resolveExecutionCacheKey({
    projectKey: runtimeCache.projectKey,
    scenarioId: scenarioDefinitionId(input.specification, input.scenario),
    scenarioRevision: scenarioRevision(input.scenario),
    executionTargetProfileId: input.executionTargetProfile.id,
    targetConfigurationFingerprint: adapterCache.targetConfigurationFingerprint,
    applicationRevision: input.applicationRevision,
    adapterKind: adapterCache.adapterKind,
    adapterCacheSchemaVersion: adapterCache.adapterCacheSchemaVersion,
  })
}

function hasSeparatedOutlineBindings(scenario: Scenario): boolean {
  return (
    scenario.examplesRowId === undefined ||
    (scenario.template !== undefined && scenario.runtimeBindings !== undefined)
  )
}

function cacheMissResult(input: RunScenarioInput, message: string): TestResult {
  return {
    ...createTestResult({ ...input, mode: 'replay' }, 'failed', [], 0, message),
    cacheOutcome: 'miss',
    inferenceCount: 0,
    failureKind: 'cache-miss',
  }
}

async function finishRun(
  input: RunScenarioInput,
  events: RunEvent[],
  result: TestResult,
): Promise<ScenarioRun> {
  await appendEvent(events, input, { type: 'scenario-finished', result })
  return { events, result }
}

function serializedContainsRuntimeValue(
  source: string,
  scenario: Scenario,
): boolean {
  return stringContainsBinding(
    source,
    nonemptyBindings(scenario.runtimeBindings),
  )
}

function requiredVariablesAreValid(
  requiredVariables: readonly string[],
  scenario: Scenario,
): boolean {
  const allowed = new Set(scenario.template?.variableNames ?? [])
  return (
    new Set(requiredVariables).size === requiredVariables.length &&
    requiredVariables.every((name) => allowed.has(name))
  )
}

interface FinalizeAdaptiveRunInput {
  run: RetriedScenarioRun
  cacheKey?: ExecutionCacheKey
  cacheOutcome: CacheOutcome
  forcedUncacheableReason?: ExecutionCacheUncacheableReason
  lease?: ExecutionCacheLease
}

async function finalizeAdaptiveRun(
  input: RunScenarioInput,
  events: RunEvent[],
  finalization: FinalizeAdaptiveRunInput,
): Promise<ScenarioRun> {
  const { run, cacheKey } = finalization
  let result: TestResult = {
    ...run.result,
    cacheOutcome: finalization.cacheOutcome,
    inferenceCount: run.inferenceCount,
  }
  await appendEvent(events, input, {
    type: 'inference-count-updated',
    inferenceCount: run.inferenceCount,
  })

  if (result.state !== 'passed') return finishRun(input, events, result)

  let reason = finalization.forcedUncacheableReason
  if (!reason && run.runtimeValueExposed) reason = 'bound-parameter-value'
  if (
    !reason &&
    run.completion?.evaluationModel &&
    stringContainsBinding(
      run.completion.evaluationModel,
      nonemptyBindings(input.scenario.runtimeBindings),
    )
  ) {
    reason = 'bound-parameter-value'
  }
  const candidate = run.completion?.cacheCandidate
  if (!reason && !candidate) reason = 'non-deterministic-action'
  if (!reason && candidate && !candidate.cacheable) {
    reason = candidate.reason
  }
  if (
    !reason &&
    candidate?.cacheable &&
    !requiredVariablesAreValid(candidate.requiredVariables, input.scenario)
  ) {
    reason = 'payload-validation-failed'
  }

  if (!reason && cacheKey && candidate?.cacheable) {
    let serialized: SerializedExecutionCacheEnvelope | undefined
    try {
      serialized = serializeExecutionCacheEnvelope(
        {
          schemaVersion: 1,
          key: cacheKey,
          requiredVariables: [...candidate.requiredVariables],
          adapterPayload: candidate.adapterPayload,
        },
        input.adapter.executionCache!,
      )
    } catch {
      reason = 'payload-validation-failed'
    }
    if (
      serialized &&
      serializedContainsRuntimeValue(serialized.source, input.scenario)
    ) {
      reason = 'bound-parameter-value'
    }
    if (!reason && serialized) {
      const metadata = {
        sourceRunId: input.executionCache!.sourceRunId,
        evaluationModel: run.completion?.evaluationModel,
        evaluationInferenceCount: run.inferenceCount,
      }
      const write = finalization.lease
        ? await input.executionCache!.store.coordination!.publish(
            finalization.lease,
            serialized,
            metadata,
          )
        : await input.executionCache!.store.write(serialized, metadata)
      if ('published' in write && !write.published) {
        return finishRun(input, events, {
          ...result,
          state: 'infrastructure-error',
          message:
            'Execution cache lease ownership was lost before publication',
        })
      }
      if (!write.stored) reason = 'entry-too-large'
      else await appendEvent(events, input, { type: 'cache-written', cacheKey })
    }
  }

  if (reason) {
    await appendEvent(events, input, { type: 'cache-uncacheable', reason })
    result = {
      ...result,
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: reason,
    }
  }
  return finishRun(input, events, result)
}

function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

function startLeaseHeartbeat(
  coordination: ExecutionCacheCoordination,
  lease: ExecutionCacheLease,
): { stop(): Promise<boolean> } {
  const controller = new AbortController()
  let ownershipLost = false
  const heartbeat = (async () => {
    while (!controller.signal.aborted) {
      await waitForDelay(lease.heartbeatMs, controller.signal)
      if (controller.signal.aborted) return
      if (!(await coordination.renew(lease))) {
        ownershipLost = true
        return
      }
    }
  })()
  return {
    async stop() {
      controller.abort()
      await heartbeat
      return ownershipLost
    },
  }
}

async function finishLeaseWait(
  input: RunScenarioInput,
  events: RunEvent[],
  cacheOutcome: CacheOutcome,
  status: 'timed-out' | 'cancelled',
  inferenceCount: number,
): Promise<ScenarioRun> {
  const state = status === 'cancelled' ? 'cancelled' : 'infrastructure-error'
  const message =
    status === 'cancelled'
      ? 'Execution cache lease wait was cancelled'
      : 'Execution cache lease wait timed out'
  const result = {
    ...createTestResult({ ...input, mode: 'adaptive' }, state, [], 0, message),
    cacheOutcome,
    inferenceCount,
  }
  await appendEvent(events, input, {
    type: 'scenario-started',
    scenario: result.scenario,
    executionTargetProfile: input.executionTargetProfile,
  })
  return finishRun(input, events, result)
}

async function replayPublishedEntry(
  input: RunScenarioInput,
  events: RunEvent[],
  cacheKey: ExecutionCacheKey,
  inferenceOffset = 0,
): Promise<ScenarioRun | undefined> {
  const source = await input.executionCache!.store.read(cacheKey)
  if (!source) return undefined
  const entry = deserializeExecutionCacheEnvelope({
    source,
    expectedKey: cacheKey,
    payloadValidator: input.adapter.executionCache!,
  })
  if (!entry) {
    await input.executionCache!.store.delete(cacheKey)
    return undefined
  }
  await appendEvent(events, input, { type: 'cache-hit', cacheKey })
  const replay = await runCachedAttempts(input, 'replay', events, entry)
  if (replay.replayDiverged) {
    await appendEvent(events, input, { type: 'replay-diverged', cacheKey })
    return undefined
  }
  await appendEvent(events, input, {
    type: 'inference-count-updated',
    inferenceCount: inferenceOffset + replay.inferenceCount,
  })
  return finishRun(input, events, {
    ...replay.result,
    cacheOutcome: 'hit',
    inferenceCount: inferenceOffset + replay.inferenceCount,
  })
}

async function runCoordinatedAdaptive(
  input: RunScenarioInput,
  events: RunEvent[],
  cacheKey: ExecutionCacheKey,
  cacheOutcome: CacheOutcome,
  observedSource?: string,
  inferenceOffset = 0,
): Promise<ScenarioRun> {
  const coordination = input.executionCache!.store.coordination
  if (!coordination) {
    const adaptive = await runCachedAttempts(input, 'adaptive', events)
    const run = {
      ...adaptive,
      inferenceCount: inferenceOffset + adaptive.inferenceCount,
    }
    return finalizeAdaptiveRun(input, events, { run, cacheKey, cacheOutcome })
  }

  for (;;) {
    const acquisition = await coordination.acquire(cacheKey)
    if (!acquisition.acquired) {
      const waited = await coordination.wait(
        cacheKey,
        acquisition.ownerToken,
        acquisition.baselinePayloadDigest,
        input.signal,
      )
      if (waited.status !== 'released') {
        return finishLeaseWait(
          input,
          events,
          cacheOutcome,
          waited.status,
          inferenceOffset,
        )
      }
      if (waited.entryChanged) {
        const replay = await replayPublishedEntry(
          input,
          events,
          cacheKey,
          inferenceOffset,
        )
        if (replay) return replay
      }
      continue
    }

    const heartbeat = startLeaseHeartbeat(coordination, acquisition.lease)
    try {
      const currentSource = await coordination.readCurrent(cacheKey)
      if (currentSource && currentSource !== observedSource) {
        const replay = await replayPublishedEntry(
          input,
          events,
          cacheKey,
          inferenceOffset,
        )
        if (replay) return replay
      }

      const adaptive = await runCachedAttempts(input, 'adaptive', events)
      const run = {
        ...adaptive,
        inferenceCount: inferenceOffset + adaptive.inferenceCount,
      }
      if (await heartbeat.stop()) {
        await appendEvent(events, input, {
          type: 'inference-count-updated',
          inferenceCount: run.inferenceCount,
        })
        return finishRun(input, events, {
          ...run.result,
          state: 'infrastructure-error',
          cacheOutcome,
          inferenceCount: run.inferenceCount,
          message: 'Execution cache lease ownership was lost during evaluation',
        })
      }
      return finalizeAdaptiveRun(input, events, {
        run,
        cacheKey,
        cacheOutcome,
        lease: acquisition.lease,
      })
    } finally {
      await heartbeat.stop()
      await coordination.release(acquisition.lease)
    }
  }
}

export async function runCacheOnlyMiss(
  input: RunScenarioInput,
  events: RunEvent[],
  message: string,
  cacheKey?: ExecutionCacheKey,
): Promise<ScenarioRun> {
  const result = cacheMissResult(input, message)
  await appendEvent(events, input, {
    type: 'scenario-started',
    scenario: result.scenario,
    executionTargetProfile: input.executionTargetProfile,
  })
  if (cacheKey) {
    await appendEvent(events, input, { type: 'cache-miss', cacheKey })
  }
  return finishRun(input, events, result)
}

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
    if (cachePolicy === 'cache-only') {
      return runCacheOnlyMiss(
        input,
        events,
        unsafeOutline || unsafeCacheKey
          ? 'Scenario parameters cannot be separated safely for Replay'
          : 'Execution cache requires applicationRevision',
      )
    }
    const run = await runCachedAttempts(input, 'adaptive', events)
    return finalizeAdaptiveRun(input, events, {
      run,
      cacheOutcome: 'uncacheable',
      forcedUncacheableReason:
        unsafeOutline || unsafeCacheKey
          ? 'bound-parameter-value'
          : 'application-revision-missing',
    })
  }

  if (cachePolicy === 'refresh') {
    await appendEvent(events, input, { type: 'cache-refresh', cacheKey })
    const observedSource =
      await input.executionCache!.store.coordination?.readCurrent(cacheKey)
    return runCoordinatedAdaptive(
      input,
      events,
      cacheKey,
      'refresh',
      observedSource,
    )
  }

  const source = await input.executionCache!.store.read(cacheKey)
  const cacheEntry = source
    ? deserializeExecutionCacheEnvelope({
        source,
        expectedKey: cacheKey,
        payloadValidator: input.adapter.executionCache!,
      })
    : undefined
  if (!cacheEntry) {
    if (source) await input.executionCache!.store.delete(cacheKey)
    if (cachePolicy === 'cache-only') {
      return runCacheOnlyMiss(
        input,
        events,
        'Execution cache entry was not found',
        cacheKey,
      )
    }
    await appendEvent(events, input, { type: 'cache-miss', cacheKey })
    return runCoordinatedAdaptive(input, events, cacheKey, 'miss')
  }

  await appendEvent(events, input, { type: 'cache-hit', cacheKey })
  const replay = await runCachedAttempts(input, 'replay', events, cacheEntry)
  if (!replay.replayDiverged) {
    await appendEvent(events, input, {
      type: 'inference-count-updated',
      inferenceCount: replay.inferenceCount,
    })
    return finishRun(input, events, {
      ...replay.result,
      cacheOutcome: 'hit',
      inferenceCount: replay.inferenceCount,
    })
  }

  await appendEvent(events, input, { type: 'replay-diverged', cacheKey })
  if (cachePolicy === 'cache-only') {
    return finishRun(input, events, {
      ...replay.result,
      cacheOutcome: 'hit',
      inferenceCount: replay.inferenceCount,
      failureKind: 'cache-miss',
    })
  }

  await appendEvent(events, input, {
    type: 'adaptive-fallback-started',
    cacheKey,
  })
  return runCoordinatedAdaptive(
    input,
    events,
    cacheKey,
    'fallback',
    source,
    replay.inferenceCount,
  )
}
