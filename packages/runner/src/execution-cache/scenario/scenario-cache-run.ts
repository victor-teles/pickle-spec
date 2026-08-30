import { type Scenario, scenarioRevision } from '@pickle-spec/spec'
import {
  type AttemptScenarioRun,
  createSyntheticTestResult,
  createTestResult,
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
} from '../../execution/run-scenario'
import { createScenarioRetryTracker } from '../../execution/scenario/scenario-retry'
import {
  nonemptyBindings,
  scenarioDefinitionId,
  stringContainsBinding,
} from '../../execution/scenario/scenario-runtime'
import { requiredValue } from '../../required-value'
import { withSharedEvidenceObservations } from '../../results/shared-evidence-observations'
import type {
  ExecutionCacheEnvelope,
  ExecutionCacheKey,
} from '../execution-cache'
import { resolveExecutionCacheKey } from '../execution-cache'

export interface RetriedScenarioRun extends AttemptScenarioRun {
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

export function finalAttemptScope(
  input: RunScenarioInput,
  result: TestResult,
): RunEventScope {
  const attempt = result.attempts.at(-1)
  if (!attempt) throw new Error('A Test result requires a Scenario attempt')
  return attemptScope(input, attempt.attempt)
}

export function nextAttemptScope(
  input: RunScenarioInput,
  attempts: readonly ScenarioAttempt[] = [],
): RunEventScope {
  return attemptScope(input, (attempts.at(-1)?.attempt ?? 0) + 1)
}

export async function appendEvent(
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
  const versioned = withSharedEvidenceObservations(event)
  events.push(versioned)
  await input.onEvent?.(versioned)
}

export async function runCachedAttempts(
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

export async function appendScenarioFinishedEvent(
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

export async function appendSyntheticScenarioStartedEvent(
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

export function cacheKeyFor(
  input: RunScenarioInput,
): ExecutionCacheKey | undefined {
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

export function hasSeparatedOutlineBindings(scenario: Scenario): boolean {
  return (
    scenario.examplesRowId === undefined ||
    (scenario.template !== undefined && scenario.runtimeBindings !== undefined)
  )
}

export function cacheMissResult(
  input: RunScenarioInput,
  message: string,
): TestResult {
  return withFinalAttempt(
    createSyntheticTestResult(input, 'replay', 'failed', message),
    {
      cacheOutcome: 'miss',
      inferenceCount: 0,
      failureKind: 'cache-miss',
    },
  )
}

export async function finishRun(
  input: RunScenarioInput,
  events: RunEvent[],
  result: TestResult,
): Promise<ScenarioRun> {
  await appendScenarioFinishedEvent(events, input, result)
  return { events, result }
}

export function syntheticResultWithAttempts(
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

export function serializedContainsRuntimeValue(
  source: string,
  scenario: Scenario,
): boolean {
  return stringContainsBinding(
    source,
    nonemptyBindings(scenario.runtimeBindings),
  )
}

export function requiredVariablesAreValid(
  requiredVariables: readonly string[],
  scenario: Scenario,
): boolean {
  const allowed = new Set(scenario.template?.variableNames ?? [])
  return (
    new Set(requiredVariables).size === requiredVariables.length &&
    requiredVariables.every((name) => allowed.has(name))
  )
}
