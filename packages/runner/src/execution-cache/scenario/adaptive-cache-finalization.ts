import type {
  RunEvent,
  RunEventScope,
  RunScenarioInput,
  ScenarioRun,
  TestResult,
} from '../../execution/run-scenario-types'
import { withFinalAttempt } from '../../execution/scenario/scenario-results'
import { requiredValue } from '../../required-value'
import { attemptCacheUse, type CachedStepPrefix } from '../cached-step-prefix'
import {
  type ExecutionCacheKey,
  type ExecutionCacheLease,
  type ExecutionCacheUncacheableReason,
  isTerminalCacheOutcome,
  type SerializedExecutionCacheEnvelope,
  type SerializedExecutionCacheTerminalOutcome,
  serializeExecutionCacheEnvelope,
  serializeExecutionCacheTerminalOutcome,
} from '../execution-cache'
import {
  attemptUncacheableReason,
  cacheFields,
  type FinalizeAdaptiveRunInput,
  publishableCachedPrefix,
} from './adaptive-cache-policy'
import {
  appendEvent,
  finalAttemptScope,
  finishRun,
  type RetriedScenarioRun,
  serializedContainsRuntimeValue,
} from './scenario-cache-run'

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

export async function finalizeAdaptiveRun(
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
