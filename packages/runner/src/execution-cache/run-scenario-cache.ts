import { type Scenario, scenarioRevision } from '@pickle-spec/spec'
import {
  type AttemptScenarioRun,
  createSyntheticTestResult,
  createTestResult,
  type ExecutionCachePolicy,
  type ExecutionMode,
  type RunEvent,
  type RunEventPayload,
  type RunEventScope,
  type RunScenarioInput,
  runScenarioAttempt,
  type ScenarioAttempt,
  type ScenarioRun,
  scenarioFinishedPayload,
  type TargetSessionReplayRepresentation,
  type TestResult,
  testRunSchemaVersion,
  withFinalAttempt,
} from '../execution/run-scenario'
import { createScenarioRetryTracker } from '../execution/scenario-retry'
import {
  nonemptyBindings,
  scenarioDefinitionId,
  stringContainsBinding,
} from '../execution/scenario-runtime'
import {
  type CacheOutcome,
  deserializeExecutionCacheEnvelope,
  deserializeExecutionCacheTerminalOutcome,
  type ExecutionCacheEnvelope,
  type ExecutionCacheKey,
  type ExecutionCacheLease,
  type ExecutionCacheUncacheableReason,
  resolveExecutionCacheKey,
  type SerializedExecutionCacheEnvelope,
  type SerializedExecutionCacheTerminalOutcome,
  serializeExecutionCacheEnvelope,
  serializeExecutionCacheTerminalOutcome,
} from './execution-cache'
import { coordinateExecutionCacheRun } from './execution-cache-run-coordinator'

interface RetriedScenarioRun extends AttemptScenarioRun {
  inferenceCount: number
}

function attemptScope(input: RunScenarioInput, attempt: number): RunEventScope {
  return {
    scenarioId: scenarioDefinitionId(input.specification, input.scenario),
    examplesRowId: input.scenario.examplesRowId,
    executionTargetProfileId: input.executionTargetProfile.id,
    attempt,
  }
}

function finalAttemptScope(
  input: RunScenarioInput,
  result: TestResult,
): RunEventScope {
  const attempt = result.attempts.at(-1)
  if (!attempt) throw new Error('A Test result requires a Scenario attempt')
  return attemptScope(input, attempt.attempt)
}

function nextAttemptScope(
  input: RunScenarioInput,
  attempts: readonly ScenarioAttempt[] = [],
): RunEventScope {
  return attemptScope(input, (attempts.at(-1)?.attempt ?? 0) + 1)
}

async function appendEvent(
  events: RunEvent[],
  input: RunScenarioInput,
  payload: RunEvent | RunEventPayload,
  occurredAtOverride?: string,
): Promise<void> {
  const occurredAt =
    occurredAtOverride ??
    ('occurredAt' in payload
      ? payload.occurredAt
      : (input.now ?? (() => new Date()))().toISOString())
  const event = {
    ...payload,
    schemaVersion: testRunSchemaVersion,
    sequence: events.length + 1,
    occurredAt,
  } as RunEvent
  events.push(event)
  await input.onEvent?.(event)
}

async function runCachedAttempts(
  input: RunScenarioInput,
  mode: ExecutionMode,
  events: RunEvent[],
  cacheEntry?: ExecutionCacheEnvelope,
  attempts: ScenarioAttempt[] = [],
): Promise<RetriedScenarioRun> {
  const retries = createScenarioRetryTracker(input.retry)
  let inferenceCount = 0
  let runtimeValueExposed = false

  for (;;) {
    const attempt = (attempts.at(-1)?.attempt ?? 0) + 1
    const attemptInput = {
      ...input,
      mode,
      attempt,
      cacheEntry,
      retry: undefined,
      onEvent: async (event: RunEvent) => {
        if (event.type === 'scenario-finished') return
        await appendEvent(events, input, event)
      },
    } as const
    const run = await runScenarioAttempt(attemptInput)
    inferenceCount += run.completion?.inferenceCount ?? 0
    runtimeValueExposed ||= run.runtimeValueExposed
    const replayCompletionInvalid =
      mode === 'replay' &&
      run.result.state === 'passed' &&
      (run.completion === undefined || run.completion.inferenceCount !== 0)
    const completedAttempt = replayCompletionInvalid
      ? {
          ...run.attempt,
          state: 'failed' as const,
          message:
            'Replay must complete the Scenario with zero evaluation inference',
        }
      : run.attempt
    attempts.push(completedAttempt)
    const result = createTestResult(attemptInput, [...attempts])
    const completedRun: AttemptScenarioRun = {
      ...run,
      attempt: completedAttempt,
      replayDiverged: replayCompletionInvalid || run.replayDiverged,
      result,
    }
    const shouldRetry = retries.shouldRetry({
      state: completedRun.result.state,
      replayDiverged: completedRun.replayDiverged,
      aborted: Boolean(input.signal?.aborted),
    })
    if (shouldRetry) {
      await appendScenarioFinishedEvent(events, input, result)
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

async function appendScenarioFinishedEvent(
  events: RunEvent[],
  input: RunScenarioInput,
  result: TestResult,
): Promise<void> {
  const attempt = result.attempts.at(-1)
  if (!attempt) throw new Error('A Test result requires a Scenario attempt')
  await appendEvent(
    events,
    input,
    scenarioFinishedPayload(result),
    attempt.finishedAt,
  )
}

async function appendSyntheticScenarioStartedEvent(
  events: RunEvent[],
  input: RunScenarioInput,
  result: TestResult,
): Promise<void> {
  const attempt = result.attempts.at(-1)
  if (!attempt) throw new Error('A Test result requires a Scenario attempt')
  await appendEvent(
    events,
    input,
    scenarioStartedPayload(result),
    attempt.startedAt,
  )
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
  return withFinalAttempt(
    createSyntheticTestResult(input, 'replay', 'failed', message),
    {
      cacheOutcome: 'miss',
      inferenceCount: 0,
      failureKind: 'cache-miss',
    },
  )
}

async function finishRun(
  input: RunScenarioInput,
  events: RunEvent[],
  result: TestResult,
): Promise<ScenarioRun> {
  await appendScenarioFinishedEvent(events, input, result)
  return { events, result }
}

function syntheticResultWithAttempts(
  input: RunScenarioInput,
  mode: ExecutionMode,
  state: TestResult['state'],
  message: string | undefined,
  attempts: ScenarioAttempt[],
): TestResult {
  const synthetic = createSyntheticTestResult(input, mode, state, message)
  const syntheticAttempt = synthetic.attempts[0]
  if (!syntheticAttempt) {
    throw new Error('A synthetic Test result requires a Scenario attempt')
  }
  const attempt = {
    ...syntheticAttempt,
    attempt: (attempts.at(-1)?.attempt ?? 0) + 1,
  }
  attempts.push(attempt)
  return createTestResult({ ...input, mode, attempt: attempt.attempt }, [
    ...attempts,
  ])
}

function scenarioStartedPayload(result: TestResult): RunEventPayload {
  const attempt = result.attempts.at(-1)
  if (!attempt) throw new Error('A Test result requires a Scenario attempt')
  return {
    type: 'scenario-started',
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
    scope: {
      scenarioId: result.scenario.id!,
      examplesRowId: result.scenario.examplesRowId,
      executionTargetProfileId: result.executionTargetProfile.id,
      attempt: attempt.attempt,
    },
  }
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

type AdaptiveCachePublication =
  | { status: 'published' }
  | { status: 'uncacheable'; reason: ExecutionCacheUncacheableReason }
  | { status: 'failed'; result: TestResult }

interface AdaptiveResultContext {
  input: RunScenarioInput
  events: RunEvent[]
  result: TestResult
  lease?: ExecutionCacheLease
  scope: RunEventScope
}

function terminalOutcomeFor(
  result: TestResult,
): SerializedExecutionCacheTerminalOutcome {
  if (result.state === 'cancelled') {
    throw new Error('Cancelled Test results do not have terminal outcomes')
  }
  const attempt = result.attempts.at(-1)
  if (!attempt?.cacheOutcome || attempt.cacheOutcome === 'hit') {
    throw new Error('Terminal Test result requires a non-hit Cache outcome')
  }
  return serializeExecutionCacheTerminalOutcome({
    state: result.state,
    cacheOutcome: attempt.cacheOutcome,
    cacheUncacheableReason: attempt.cacheUncacheableReason,
    failureKind: attempt.failureKind,
  })
}

async function completeLeaseWithTerminalOutcome(
  input: RunScenarioInput,
  lease: ExecutionCacheLease | undefined,
  result: TestResult,
): Promise<boolean> {
  if (!lease || result.state === 'cancelled') return true
  return input.executionCache!.store.coordination!.complete(
    lease,
    terminalOutcomeFor(result),
  )
}

function adaptiveUncacheableReason(
  input: RunScenarioInput,
  run: RetriedScenarioRun,
  forcedReason: ExecutionCacheUncacheableReason | undefined,
): ExecutionCacheUncacheableReason | undefined {
  if (forcedReason) return forcedReason
  const bindings = nonemptyBindings(input.scenario.runtimeBindings)
  if (
    run.runtimeValueExposed ||
    (run.completion?.evaluationModel &&
      stringContainsBinding(run.completion.evaluationModel, bindings))
  ) {
    return 'bound-parameter-value'
  }

  const representation = run.completion?.replayRepresentation
  if (!representation) return 'non-deterministic-action'
  if (!representation.cacheable) return representation.reason
  if (
    !requiredVariablesAreValid(representation.requiredVariables, input.scenario)
  )
    return 'payload-validation-failed'
  return undefined
}

function serializedAdaptiveEntry(
  input: RunScenarioInput,
  cacheKey: ExecutionCacheKey,
  representation: Extract<
    TargetSessionReplayRepresentation,
    { cacheable: true }
  >,
): SerializedExecutionCacheEnvelope | undefined {
  try {
    return serializeExecutionCacheEnvelope(
      {
        schemaVersion: 1,
        key: cacheKey,
        requiredVariables: [...representation.requiredVariables],
        adapterPayload: representation.adapterPayload,
      },
      input.adapter.executionCache!,
    )
  } catch {
    return undefined
  }
}

async function publishAdaptiveEntry(
  context: AdaptiveResultContext,
  run: RetriedScenarioRun,
  cacheKey: ExecutionCacheKey,
): Promise<AdaptiveCachePublication> {
  const { events, input, lease, result, scope } = context
  const representation = run.completion?.replayRepresentation
  if (!representation) {
    return { status: 'uncacheable', reason: 'non-deterministic-action' }
  }
  if (!representation.cacheable) {
    return { status: 'uncacheable', reason: representation.reason }
  }

  const serialized = serializedAdaptiveEntry(input, cacheKey, representation)
  if (!serialized) {
    return { status: 'uncacheable', reason: 'payload-validation-failed' }
  }
  if (serializedContainsRuntimeValue(serialized.source, input.scenario)) {
    return { status: 'uncacheable', reason: 'bound-parameter-value' }
  }

  const metadata = {
    sourceRunId: input.executionCache!.sourceRunId,
    evaluationModel: run.completion?.evaluationModel,
    evaluationInferenceCount: run.inferenceCount,
  }
  const write = lease
    ? await input.executionCache!.store.coordination!.publish(
        lease,
        serialized,
        metadata,
      )
    : await input.executionCache!.store.write(serialized, metadata)
  if ('published' in write && !write.published) {
    return {
      status: 'failed',
      result: withFinalAttempt(result, {
        state: 'infrastructure-error',
        message: 'Execution cache lease ownership was lost before publication',
      }),
    }
  }
  if (!write.stored) {
    return { status: 'uncacheable', reason: 'entry-too-large' }
  }

  await appendEvent(events, input, { type: 'cache-written', cacheKey, scope })
  return { status: 'published' }
}

async function finishFailedAdaptiveRun(
  context: AdaptiveResultContext,
): Promise<ScenarioRun> {
  const { events, input, lease, result } = context
  if (await completeLeaseWithTerminalOutcome(input, lease, result)) {
    return finishRun(input, events, result)
  }
  return finishRun(
    input,
    events,
    withFinalAttempt(result, {
      state: 'infrastructure-error',
      message: 'Execution cache lease ownership was lost after evaluation',
    }),
  )
}

async function finishSuccessfulAdaptiveRun(
  context: AdaptiveResultContext,
  reason: ExecutionCacheUncacheableReason | undefined,
): Promise<ScenarioRun> {
  const { events, input, lease, result, scope } = context
  if (!reason) return finishRun(input, events, result)

  await appendEvent(events, input, {
    type: 'cache-uncacheable',
    reason,
    scope,
  })
  let finalResult = withFinalAttempt(result, {
    cacheOutcome: 'uncacheable',
    cacheUncacheableReason: reason,
  })
  if (!(await completeLeaseWithTerminalOutcome(input, lease, finalResult))) {
    finalResult = withFinalAttempt(finalResult, {
      state: 'infrastructure-error',
      message: 'Execution cache lease ownership was lost after evaluation',
    })
  }
  return finishRun(input, events, finalResult)
}

async function finalizeAdaptiveRun(
  input: RunScenarioInput,
  events: RunEvent[],
  finalization: FinalizeAdaptiveRunInput,
): Promise<ScenarioRun> {
  const { run, cacheKey } = finalization
  const result = withFinalAttempt(run.result, {
    cacheOutcome: finalization.cacheOutcome,
    inferenceCount: run.inferenceCount,
  })
  const scope = finalAttemptScope(input, result)
  await appendEvent(events, input, {
    type: 'inference-count-updated',
    inferenceCount: run.inferenceCount,
    scope,
  })

  const context: AdaptiveResultContext = {
    input,
    events,
    result,
    lease: finalization.lease,
    scope,
  }
  if (result.state !== 'passed') {
    return finishFailedAdaptiveRun(context)
  }

  const policyReason = adaptiveUncacheableReason(
    input,
    run,
    finalization.forcedUncacheableReason,
  )
  const publication =
    !policyReason && cacheKey
      ? await publishAdaptiveEntry(context, run, cacheKey)
      : undefined
  if (publication?.status === 'failed') {
    return finishRun(input, events, publication.result)
  }
  const publicationReason =
    publication?.status === 'uncacheable' ? publication.reason : undefined
  return finishSuccessfulAdaptiveRun(context, policyReason ?? publicationReason)
}

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

async function replayPublishedEntry(
  input: RunScenarioInput,
  events: RunEvent[],
  cacheKey: ExecutionCacheKey,
  inferenceOffset = 0,
  attempts: ScenarioAttempt[] = [],
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
  await appendEvent(events, input, {
    type: 'cache-hit',
    cacheKey,
    scope: nextAttemptScope(input, attempts),
  })
  const replay = await runCachedAttempts(
    input,
    'replay',
    events,
    entry,
    attempts,
  )
  if (replay.replayDiverged) {
    await appendScenarioFinishedEvent(events, input, replay.result)
    await appendEvent(events, input, {
      type: 'replay-diverged',
      cacheKey,
      scope: finalAttemptScope(input, replay.result),
    })
    return undefined
  }
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
      inferenceCount: inferenceOffset + replay.inferenceCount,
    }),
  )
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
  const result = withFinalAttempt(
    syntheticResultWithAttempts(
      input,
      'adaptive',
      outcome.state,
      outcome.state === 'failed'
        ? 'Concurrent Adaptive evaluation failed'
        : outcome.state === 'infrastructure-error'
          ? 'Concurrent Adaptive evaluation ended with an infrastructure error'
          : undefined,
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

async function runCoordinatedAdaptive(
  options: RunCoordinatedAdaptiveInput,
): Promise<ScenarioRun> {
  const { cacheKey, cacheOutcome, events, input } = options
  const inferenceOffset = options.inferenceOffset ?? 0
  const attempts = [...(options.priorAttempts ?? [])]
  const coordination = input.executionCache!.store.coordination
  if (!coordination) {
    const adaptive = await runCachedAttempts(
      input,
      'adaptive',
      events,
      undefined,
      attempts,
    )
    const run = {
      ...adaptive,
      inferenceCount: inferenceOffset + adaptive.inferenceCount,
    }
    return finalizeAdaptiveRun(input, events, { run, cacheKey, cacheOutcome })
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
    async ownershipLost(adaptive) {
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
    },
    completeOwner(adaptive, lease) {
      const run = {
        ...adaptive,
        inferenceCount: inferenceOffset + adaptive.inferenceCount,
      }
      return finalizeAdaptiveRun(input, events, {
        run,
        cacheKey,
        cacheOutcome,
        lease,
      })
    },
  })
}

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

async function runUncacheableScenario(
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
    cacheOutcome: 'uncacheable',
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

async function runReplayCacheHit(
  options: RunReplayCacheHitInput,
): Promise<ScenarioRun> {
  const { cacheEntry, cacheKey, cachePolicy, events, input, observedRevision } =
    options
  await appendEvent(events, input, {
    type: 'cache-hit',
    cacheKey,
    scope: nextAttemptScope(input),
  })
  const replay = await runCachedAttempts(input, 'replay', events, cacheEntry)
  if (!replay.replayDiverged) {
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
        inferenceCount: replay.inferenceCount,
      }),
    )
  }

  if (cachePolicy === 'cache-only') {
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
    cacheOutcome: 'fallback',
    observedRevision,
    inferenceOffset: replay.inferenceCount,
    priorAttempts: replay.result.attempts,
  })
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
    return runUncacheableScenario({
      input,
      events,
      cachePolicy,
      unsafeOutline,
      unsafeCacheKey,
    })
  }

  if (cachePolicy === 'refresh') {
    await appendEvent(events, input, {
      type: 'cache-refresh',
      cacheKey,
      scope: nextAttemptScope(input),
    })
    const observedSnapshot =
      await input.executionCache!.store.coordination?.readCurrent(cacheKey)
    return runCoordinatedAdaptive({
      input,
      events,
      cacheKey,
      cacheOutcome: 'refresh',
      observedRevision: observedSnapshot?.revision,
    })
  }

  const observedSnapshot =
    await input.executionCache!.store.coordination?.readCurrent(cacheKey)
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
