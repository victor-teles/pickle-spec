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
import { requiredValue } from '../required-value'
import {
  type AttemptCacheUse,
  attemptCacheUse,
  type CachedStepPrefix,
  cachedStepPrefixFrom,
  sealCachedStepPrefix,
} from './cached-step-prefix'
import {
  type CacheOutcome,
  deserializeExecutionCacheEnvelope,
  deserializeExecutionCacheTerminalOutcome,
  type ExecutionCacheEnvelope,
  type ExecutionCacheKey,
  type ExecutionCacheLease,
  type ExecutionCacheUncacheableReason,
  isTerminalCacheOutcome,
  prefixPolicyOf,
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
      !run.adaptiveEvaluated &&
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
      scenarioId: requiredValue(result.scenario.id),
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
  startedFrom: 'entry' | 'miss' | 'refresh'
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
  if (!attempt?.cacheOutcome || !isTerminalCacheOutcome(attempt.cacheOutcome)) {
    throw new Error(
      'Terminal Test result requires a miss, refresh, fallback, or uncacheable Cache outcome',
    )
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
  return requiredValue(
    requiredValue(input.executionCache).store.coordination,
  ).complete(lease, terminalOutcomeFor(result))
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

function cacheFields(use: AttemptCacheUse): Partial<ScenarioAttempt> {
  if (use.cacheOutcome === 'partial-hit') {
    return {
      cacheOutcome: use.cacheOutcome,
      inferenceCount: use.inferenceCount,
      prefixStepCount: use.prefixStepCount,
    }
  }
  if (use.cacheOutcome === 'uncacheable') {
    return {
      cacheOutcome: use.cacheOutcome,
      inferenceCount: use.inferenceCount,
      cacheUncacheableReason: use.cacheUncacheableReason,
    }
  }
  return {
    cacheOutcome: use.cacheOutcome,
    inferenceCount: use.inferenceCount,
  }
}

function serializedPrefixEntry(
  input: RunScenarioInput,
  cacheKey: ExecutionCacheKey,
  prefix: CachedStepPrefix,
): SerializedExecutionCacheEnvelope | undefined {
  try {
    return serializeExecutionCacheEnvelope(
      {
        schemaVersion: 1,
        key: cacheKey,
        requiredVariables: [...prefix.requiredVariables],
        adapterPayload: prefix.adapterPayload,
      },
      requiredValue(input.adapter.executionCache),
    )
  } catch {
    return undefined
  }
}

async function publishAdaptiveEntry(
  context: AdaptiveResultContext,
  run: RetriedScenarioRun,
  cacheKey: ExecutionCacheKey,
  prefix: CachedStepPrefix,
): Promise<AdaptiveCachePublication> {
  const { events, input, lease, result, scope } = context
  const serialized = serializedPrefixEntry(input, cacheKey, prefix)
  if (!serialized) {
    return { status: 'uncacheable', reason: 'payload-validation-failed' }
  }
  if (serializedContainsRuntimeValue(serialized.source, input.scenario)) {
    return { status: 'uncacheable', reason: 'bound-parameter-value' }
  }

  const metadata = {
    sourceRunId: requiredValue(input.executionCache).sourceRunId,
    evaluationModel: run.completion?.evaluationModel,
    evaluationInferenceCount: run.inferenceCount,
  }
  const write = lease
    ? await requiredValue(
        requiredValue(input.executionCache).store.coordination,
      ).publish(lease, serialized, metadata)
    : await requiredValue(input.executionCache).store.write(
        serialized,
        metadata,
      )
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

function publishableCachedPrefix(
  input: RunScenarioInput,
  run: RetriedScenarioRun,
  finalization: FinalizeAdaptiveRunInput,
): {
  prefix: CachedStepPrefix | undefined
  policyReason: ExecutionCacheUncacheableReason | undefined
} {
  const adapter = requiredValue(input.adapter.executionCache)
  const scenarioStepCount = input.scenario.steps.length
  const prefix = sealCachedStepPrefix({
    compiledPayload: run.completion?.replayRepresentation,
    scenarioStepCount,
    adapter,
  })
  const passedCount = run.attempt.steps.filter(
    (step) => step.state === 'passed',
  ).length
  const policy = prefixPolicyOf(adapter)
  const policyReason = adaptiveUncacheableReason(
    input,
    run,
    finalization.forcedUncacheableReason,
  )
  const publishable =
    !finalization.forcedUncacheableReason &&
    !policyReason &&
    prefix &&
    prefix.stepCount <= passedCount &&
    (policy.write === 'prefix' || prefix.stepCount === scenarioStepCount)
      ? prefix
      : undefined
  return { prefix: publishable, policyReason }
}

function attemptUncacheableReason(
  run: RetriedScenarioRun,
  policyReason: ExecutionCacheUncacheableReason | undefined,
  publishablePrefix: CachedStepPrefix | undefined,
): ExecutionCacheUncacheableReason | undefined {
  if (run.result.state === 'passed' && policyReason && !publishablePrefix) {
    return policyReason
  }
  return undefined
}

async function finishPublishedAdaptive(
  context: AdaptiveResultContext,
  publicationReason: ExecutionCacheUncacheableReason | undefined,
): Promise<ScenarioRun> {
  if (context.result.state !== 'passed') {
    return finishRun(context.input, context.events, context.result)
  }
  return finishSuccessfulAdaptiveRun(context, publicationReason)
}

async function finishUnpublishedAdaptive(
  context: AdaptiveResultContext,
  publishablePrefix: CachedStepPrefix | undefined,
  policyReason: ExecutionCacheUncacheableReason | undefined,
  publicationReason: ExecutionCacheUncacheableReason | undefined,
): Promise<ScenarioRun> {
  if (context.result.state !== 'passed') {
    return finishFailedAdaptiveRun(context)
  }
  return finishSuccessfulAdaptiveRun(
    context,
    publishablePrefix ? publicationReason : (policyReason ?? publicationReason),
  )
}

async function publishThenFinishAdaptive(
  context: AdaptiveResultContext,
  run: RetriedScenarioRun,
  cacheKey: ExecutionCacheKey | undefined,
  publishablePrefix: CachedStepPrefix | undefined,
  policyReason: ExecutionCacheUncacheableReason | undefined,
): Promise<ScenarioRun> {
  const { events, input, result } = context
  const canPublish =
    Boolean(publishablePrefix && cacheKey) &&
    (result.state === 'passed' || result.state === 'failed')
  const publication =
    canPublish && publishablePrefix && cacheKey
      ? await publishAdaptiveEntry(context, run, cacheKey, publishablePrefix)
      : undefined
  if (publication?.status === 'failed') {
    return finishRun(input, events, publication.result)
  }
  const publicationReason =
    publication?.status === 'uncacheable' ? publication.reason : undefined
  if (publication?.status === 'published') {
    return finishPublishedAdaptive(context, publicationReason)
  }
  return finishUnpublishedAdaptive(
    context,
    publishablePrefix,
    policyReason,
    publicationReason,
  )
}

async function finalizeAdaptiveRun(
  input: RunScenarioInput,
  events: RunEvent[],
  finalization: FinalizeAdaptiveRunInput,
): Promise<ScenarioRun> {
  const { run, cacheKey } = finalization
  const { prefix: publishablePrefix, policyReason } = publishableCachedPrefix(
    input,
    run,
    finalization,
  )
  const cacheUse = attemptCacheUse({
    prefixStepCount: run.replayedStepCount,
    scenarioStepCount: input.scenario.steps.length,
    inferenceCount: run.inferenceCount,
    startedFrom: finalization.startedFrom,
    uncacheableReason: attemptUncacheableReason(
      run,
      policyReason,
      publishablePrefix,
    ),
  })
  const result = withFinalAttempt(run.result, cacheFields(cacheUse))
  const scope = finalAttemptScope(input, result)
  await appendEvent(events, input, {
    type: 'inference-count-updated',
    inferenceCount: run.inferenceCount,
    scope,
  })
  return publishThenFinishAdaptive(
    {
      input,
      events,
      result,
      lease: finalization.lease,
      scope,
    },
    run,
    cacheKey,
    publishablePrefix,
    policyReason,
  )
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

async function runCoordinatedAdaptive(
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

async function runReplayCacheHit(
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
