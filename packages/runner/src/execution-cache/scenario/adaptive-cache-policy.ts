import type {
  RunScenarioInput,
  ScenarioAttempt,
} from '../../execution/run-scenario-types'
import {
  nonemptyBindings,
  stringContainsBinding,
} from '../../execution/scenario/scenario-runtime'
import { requiredValue } from '../../required-value'
import type { AttemptCacheUse, CachedStepPrefix } from '../cached-step-prefix'
import { sealCachedStepPrefix } from '../cached-step-prefix'
import type {
  ExecutionCacheKey,
  ExecutionCacheLease,
  ExecutionCacheUncacheableReason,
} from '../execution-cache'
import { prefixPolicyOf } from '../execution-cache'
import {
  type RetriedScenarioRun,
  requiredVariablesAreValid,
} from './scenario-cache-run'

export interface FinalizeAdaptiveRunInput {
  run: RetriedScenarioRun
  cacheKey?: ExecutionCacheKey
  startedFrom: 'entry' | 'miss' | 'refresh'
  forcedUncacheableReason?: ExecutionCacheUncacheableReason
  lease?: ExecutionCacheLease
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

export function cacheFields(use: AttemptCacheUse): Partial<ScenarioAttempt> {
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

export function publishableCachedPrefix(
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

export function attemptUncacheableReason(
  run: RetriedScenarioRun,
  policyReason: ExecutionCacheUncacheableReason | undefined,
  publishablePrefix: CachedStepPrefix | undefined,
): ExecutionCacheUncacheableReason | undefined {
  if (run.result.state === 'passed' && policyReason && !publishablePrefix) {
    return policyReason
  }
  return undefined
}
