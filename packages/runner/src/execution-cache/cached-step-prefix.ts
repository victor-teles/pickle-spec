import type {
  ReplayCacheInput,
  StepEvaluation,
  TargetSessionReplayRepresentation,
} from '../execution/run-scenario-types'
import type {
  ExecutionCachePayloadValidator,
  ExecutionCachePrefixPolicy,
  ExecutionCacheUncacheableReason,
} from './execution-cache'

const cachedStepPrefixBrand: unique symbol = Symbol('CachedStepPrefix')

export type CachedStepPrefix = {
  readonly [cachedStepPrefixBrand]: true
  readonly stepCount: number
  readonly requiredVariables: readonly string[]
  readonly adapterPayload: unknown
}

export type GapCursor = {
  readonly replayUntil: number
}

export type AttemptCacheUse =
  | {
      cacheOutcome: 'hit'
      inferenceCount: 0
    }
  | {
      cacheOutcome: 'partial-hit'
      prefixStepCount: number
      inferenceCount: number
    }
  | {
      cacheOutcome: 'miss' | 'refresh'
      inferenceCount: number
    }
  | {
      cacheOutcome: 'uncacheable'
      inferenceCount: number
      cacheUncacheableReason: ExecutionCacheUncacheableReason
    }

export type SealCachedStepPrefixInput = {
  compiledPayload: TargetSessionReplayRepresentation | undefined
  scenarioStepCount: number
  adapter: ExecutionCachePayloadValidator
}

export type CachedStepPrefixSource = {
  adapterPayload: unknown
  requiredVariables: readonly string[]
}

export type AttemptCacheUseInput = {
  prefixStepCount: number
  scenarioStepCount: number
  inferenceCount: number
  startedFrom: 'entry' | 'miss' | 'refresh'
  uncacheableReason?: ExecutionCacheUncacheableReason
}

type PrefixCapableValidator = ExecutionCachePayloadValidator & {
  prefixPolicy?: ExecutionCachePrefixPolicy
}

function mintCachedStepPrefix(input: {
  stepCount: number
  requiredVariables: readonly string[]
  adapterPayload: unknown
}): CachedStepPrefix {
  return {
    [cachedStepPrefixBrand]: true,
    stepCount: input.stepCount,
    requiredVariables: input.requiredVariables,
    adapterPayload: input.adapterPayload,
  }
}

function policyOf(adapter: PrefixCapableValidator): ExecutionCachePrefixPolicy {
  return adapter.prefixPolicy ?? { mixedReplay: true, write: 'prefix' }
}

export function cachedStepPrefixFrom(
  envelope: CachedStepPrefixSource,
  scenarioStepCount: number,
  adapter: PrefixCapableValidator,
): CachedStepPrefix | undefined {
  const payload = adapter.parse(
    envelope.adapterPayload,
    envelope.requiredVariables,
  )
  if (payload === undefined) return undefined
  const reported = adapter.prefixStepCount(payload)
  if (!Number.isSafeInteger(reported) || reported < 1) return undefined
  const stepCount = policyOf(adapter).mixedReplay ? reported : scenarioStepCount
  if (stepCount < 1 || stepCount > scenarioStepCount) return undefined
  if (policyOf(adapter).mixedReplay && reported > scenarioStepCount) {
    return undefined
  }
  return mintCachedStepPrefix({
    stepCount,
    requiredVariables: envelope.requiredVariables,
    adapterPayload: payload,
  })
}

export function sealCachedStepPrefix(
  input: SealCachedStepPrefixInput,
): CachedStepPrefix | undefined {
  const representation = input.compiledPayload
  if (!representation?.cacheable) return undefined
  return cachedStepPrefixFrom(
    {
      adapterPayload: representation.adapterPayload,
      requiredVariables: representation.requiredVariables,
    },
    input.scenarioStepCount,
    input.adapter,
  )
}

export function gapCursor(prefix: CachedStepPrefix | undefined): GapCursor {
  return { replayUntil: prefix?.stepCount ?? 0 }
}

export function evaluationAt(
  cursor: GapCursor,
  stepIndex: number,
): StepEvaluation {
  return stepIndex < cursor.replayUntil ? 'replay' : 'adaptive'
}

export function reseatGap(cursor: GapCursor, divergedAt: number): GapCursor {
  const replayUntil = Math.max(0, Math.min(divergedAt, cursor.replayUntil))
  return { replayUntil }
}

export function prefixCache(
  prefix: CachedStepPrefix | undefined,
): ReplayCacheInput | undefined {
  if (!prefix) return undefined
  return {
    adapterPayload: prefix.adapterPayload,
    requiredVariables: prefix.requiredVariables,
  }
}

export function attemptCacheUse(input: AttemptCacheUseInput): AttemptCacheUse {
  if (input.uncacheableReason) {
    return {
      cacheOutcome: 'uncacheable',
      inferenceCount: input.inferenceCount,
      cacheUncacheableReason: input.uncacheableReason,
    }
  }
  if (input.startedFrom === 'miss' || input.startedFrom === 'refresh') {
    return {
      cacheOutcome: input.startedFrom,
      inferenceCount: input.inferenceCount,
    }
  }
  if (
    input.prefixStepCount === input.scenarioStepCount &&
    input.inferenceCount === 0
  ) {
    return { cacheOutcome: 'hit', inferenceCount: 0 }
  }
  if (
    input.prefixStepCount === input.scenarioStepCount &&
    input.inferenceCount !== 0
  ) {
    throw new Error(
      'Replay must complete the Scenario with zero evaluation inference',
    )
  }
  if (
    input.prefixStepCount > 0 &&
    input.prefixStepCount < input.scenarioStepCount
  ) {
    return {
      cacheOutcome: 'partial-hit',
      prefixStepCount: input.prefixStepCount,
      inferenceCount: input.inferenceCount,
    }
  }
  return {
    cacheOutcome: 'miss',
    inferenceCount: input.inferenceCount,
  }
}
