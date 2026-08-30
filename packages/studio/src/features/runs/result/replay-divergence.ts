import type {
  ExecutionCacheKey,
  RunEvent,
  ScenarioAttempt,
  TestResult,
  TestStepResult,
} from '@pickle-spec/runner'

type ReplayDivergenceEvent = Extract<RunEvent, { type: 'replay-diverged' }>
type AdaptiveFallbackEvent = Extract<
  RunEvent,
  { type: 'adaptive-fallback-started' }
>
type ReplayLifecycleEvent = ReplayDivergenceEvent | AdaptiveFallbackEvent

export type ReplayDivergenceExplanation = {
  divergence: {
    attempt: number
    stepIndex: number
    stepText: string
  }
  sealedPrefix: {
    stepCount: number
    boundaryStepText?: string
  }
  fallback:
    | { kind: 'continued-same-attempt'; attempt: number }
    | { kind: 'restarted-next-attempt'; attempt: number }
}

type ProjectReplayDivergenceInput = {
  events: readonly RunEvent[]
  result: TestResult
  selectedAttemptNumber: number
}

function sameCacheKey(
  left: ExecutionCacheKey,
  right: ExecutionCacheKey,
): boolean {
  return (
    left.projectKey === right.projectKey &&
    left.scenarioId === right.scenarioId &&
    left.scenarioRevision === right.scenarioRevision &&
    left.executionTargetProfileId === right.executionTargetProfileId &&
    left.targetConfigurationFingerprint ===
      right.targetConfigurationFingerprint &&
    left.applicationRevision === right.applicationRevision &&
    left.adapterKind === right.adapterKind &&
    left.adapterCacheSchemaVersion === right.adapterCacheSchemaVersion
  )
}

function belongsToResult(
  event: ReplayDivergenceEvent | AdaptiveFallbackEvent,
  result: TestResult,
): boolean {
  return (
    event.scope.scenarioId === (result.scenario.id ?? result.scenario.name) &&
    event.scope.examplesRowId === result.scenario.examplesRowId &&
    event.scope.executionTargetProfileId === result.executionTargetProfile.id
  )
}

function stepText(step: TestStepResult): string {
  return `${step.step.keyword.trim()} ${step.step.text}`
}

function divergenceStep(
  attempt: ScenarioAttempt,
  sameAttemptFallback: boolean,
): TestStepResult | undefined {
  if (sameAttemptFallback) {
    const divergenceIndex = attempt.prefixStepCount ?? 0
    return attempt.steps.find((step) => step.index === divergenceIndex)
  }
  return (
    attempt.steps.find(
      (step) =>
        step.state === 'failed' || step.state === 'infrastructure-error',
    ) ?? attempt.steps.at(-1)
  )
}

function explanationFor(
  divergence: ReplayDivergenceEvent,
  fallback: AdaptiveFallbackEvent,
  result: TestResult,
): ReplayDivergenceExplanation | undefined {
  const attempt = result.attempts.find(
    (candidate) => candidate.attempt === divergence.scope.attempt,
  )
  if (!attempt) return undefined

  const sameAttemptFallback =
    fallback.scope.attempt === divergence.scope.attempt
  const step = divergenceStep(attempt, sameAttemptFallback)
  if (!step) return undefined

  const boundary = attempt.steps
    .filter((candidate) => candidate.index < step.index)
    .sort((left, right) => right.index - left.index)[0]

  return {
    divergence: {
      attempt: divergence.scope.attempt,
      stepIndex: step.index,
      stepText: stepText(step),
    },
    sealedPrefix: {
      stepCount: step.index,
      boundaryStepText: boundary ? stepText(boundary) : undefined,
    },
    fallback: sameAttemptFallback
      ? {
          kind: 'continued-same-attempt',
          attempt: fallback.scope.attempt,
        }
      : {
          kind: 'restarted-next-attempt',
          attempt: fallback.scope.attempt,
        },
  }
}

function orderedReplayEvents(
  events: readonly RunEvent[],
  result: TestResult,
): ReplayLifecycleEvent[] {
  return [...events]
    .sort((left, right) => left.sequence - right.sequence)
    .filter(
      (event): event is ReplayLifecycleEvent =>
        (event.type === 'replay-diverged' ||
          event.type === 'adaptive-fallback-started') &&
        belongsToResult(event, result),
    )
}

function pairedDivergence(
  events: readonly ReplayLifecycleEvent[],
  fallbackIndex: number,
  fallback: AdaptiveFallbackEvent,
): ReplayDivergenceEvent | undefined {
  return events
    .slice(0, fallbackIndex)
    .findLast(
      (event): event is ReplayDivergenceEvent =>
        event.type === 'replay-diverged' &&
        sameCacheKey(event.cacheKey, fallback.cacheKey) &&
        (fallback.scope.attempt === event.scope.attempt ||
          fallback.scope.attempt === event.scope.attempt + 1),
    )
}

function pairInvolvesAttempt(
  divergence: ReplayDivergenceEvent,
  fallback: AdaptiveFallbackEvent,
  attemptNumber: number,
): boolean {
  return (
    divergence.scope.attempt === attemptNumber ||
    fallback.scope.attempt === attemptNumber
  )
}

export function projectReplayDivergenceExplanation(
  input: ProjectReplayDivergenceInput,
): ReplayDivergenceExplanation | undefined {
  if (
    !input.result.attempts.some(
      (attempt) => attempt.attempt === input.selectedAttemptNumber,
    )
  ) {
    return undefined
  }

  const events = orderedReplayEvents(input.events, input.result)

  for (const [index, event] of events.entries()) {
    if (event.type !== 'adaptive-fallback-started') continue
    const divergence = pairedDivergence(events, index, event)
    if (
      !divergence ||
      !pairInvolvesAttempt(divergence, event, input.selectedAttemptNumber)
    ) {
      continue
    }
    return explanationFor(divergence, event, input.result)
  }

  return undefined
}
