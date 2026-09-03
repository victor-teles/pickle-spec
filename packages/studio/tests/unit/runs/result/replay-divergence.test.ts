import type {
  ExecutionCacheKey,
  RunEvent,
  ScenarioAttempt,
  TestResult,
  TestResultState,
} from '@pickle-spec/runner'
import { expect, test } from 'vitest'
import { projectReplayDivergenceExplanation } from '../../../../src/features/runs/result/replay-divergence'

const evidenceAvailability: ScenarioAttempt['evidenceAvailability'] = [
  { kind: 'screenshot', state: 'not-requested' },
  { kind: 'trace', state: 'not-requested' },
  { kind: 'recording', state: 'not-requested' },
  { kind: 'device-log', state: 'not-requested' },
  { kind: 'diagnostics', state: 'not-supported' },
]

const cacheKey: ExecutionCacheKey = {
  projectKey: 'project-key-do-not-render',
  scenarioId: 'scenario-checkout',
  scenarioRevision: 'revision-1',
  executionTargetProfileId: 'chrome',
  targetConfigurationFingerprint: 'target-1',
  applicationRevision: 'application-1',
  adapterKind: 'web',
  adapterCacheSchemaVersion: '1',
}

function step(
  index: number,
  text: string,
  state: TestResultState = 'passed',
): ScenarioAttempt['steps'][number] {
  return {
    index,
    startedAt: `2026-08-30T12:00:0${index}.000Z`,
    finishedAt: `2026-08-30T12:00:0${index}.500Z`,
    durationMs: 500,
    step: {
      keyword: index === 0 ? 'Given ' : 'Then ',
      text,
      type: index === 0 ? 'context' : 'outcome',
    },
    state,
    resolvedActions: [],
  }
}

function attempt(
  attemptNumber: number,
  steps: ScenarioAttempt['steps'],
  options: Pick<ScenarioAttempt, 'prefixStepCount' | 'cacheOutcome'> = {},
): ScenarioAttempt {
  return {
    attempt: attemptNumber,
    startedAt: '2026-08-30T12:00:00.000Z',
    finishedAt: '2026-08-30T12:00:10.000Z',
    durationMs: 10_000,
    state: steps.some(
      (item) =>
        item.state === 'failed' || item.state === 'infrastructure-error',
    )
      ? 'failed'
      : 'passed',
    steps,
    prefixStepCount: options.prefixStepCount,
    cacheOutcome: options.cacheOutcome,
    evidenceAvailability,
  }
}

function result(attempts: ScenarioAttempt[]): TestResult {
  return {
    schemaVersion: 2,
    specification: {
      name: 'Checkout',
      uri: 'features/checkout.feature',
    },
    scenario: {
      id: 'scenario-checkout',
      name: 'Pay for the order',
      examplesRowId: 'row-1',
    },
    executionTargetProfile: { id: 'chrome' },
    state: attempts.at(-1)?.state ?? 'cancelled',
    startedAt: '2026-08-30T12:00:00.000Z',
    finishedAt: '2026-08-30T12:00:10.000Z',
    durationMs: 10_000,
    attempts,
  }
}

function cacheEvent(
  type: 'replay-diverged' | 'adaptive-fallback-started',
  sequence: number,
  attemptNumber: number,
  options: {
    key?: ExecutionCacheKey
    scenarioId?: string
  } = {},
): RunEvent {
  return {
    schemaVersion: 2,
    sequence,
    occurredAt: `2026-08-30T12:00:0${sequence}.000Z`,
    type,
    cacheKey: options.key ?? cacheKey,
    scope: {
      scenarioId: options.scenarioId ?? 'scenario-checkout',
      examplesRowId: 'row-1',
      executionTargetProfileId: 'chrome',
      attempt: attemptNumber,
    },
  }
}

test('explains a mixed partial hit from its sealed prefix', () => {
  const testResult = result([
    attempt(
      1,
      [
        step(0, 'an order exists'),
        step(1, 'the customer checks out'),
        step(2, 'payment is captured'),
      ],
      { prefixStepCount: 2, cacheOutcome: 'partial-hit' },
    ),
  ])

  expect(
    projectReplayDivergenceExplanation({
      events: [
        cacheEvent('adaptive-fallback-started', 3, 1),
        cacheEvent('replay-diverged', 2, 1),
      ],
      result: testResult,
      selectedAttemptNumber: 1,
    }),
  ).toEqual({
    divergence: {
      attempt: 1,
      stepIndex: 2,
      stepText: 'Then payment is captured',
    },
    sealedPrefix: {
      stepCount: 2,
      boundaryStepText: 'Then the customer checks out',
    },
    fallback: { kind: 'continued-same-attempt', attempt: 1 },
  })
})

test('treats a missing mixed prefix count as first-step divergence', () => {
  const testResult = result([
    attempt(1, [step(0, 'an order exists'), step(1, 'payment is captured')], {
      cacheOutcome: 'miss',
    }),
  ])

  expect(
    projectReplayDivergenceExplanation({
      events: [
        cacheEvent('replay-diverged', 1, 1),
        cacheEvent('adaptive-fallback-started', 2, 1),
      ],
      result: testResult,
      selectedAttemptNumber: 1,
    }),
  ).toMatchObject({
    divergence: { stepIndex: 0, stepText: 'Given an order exists' },
    sealedPrefix: { stepCount: 0, boundaryStepText: undefined },
  })
})

test('shows a cross-attempt restart from either involved attempt', () => {
  const testResult = result([
    attempt(1, [
      step(0, 'an order exists'),
      step(1, 'payment is captured', 'failed'),
    ]),
    attempt(2, [step(0, 'an order exists'), step(1, 'payment is captured')]),
  ])
  const events = [
    cacheEvent('replay-diverged', 5, 1),
    cacheEvent('adaptive-fallback-started', 6, 2),
  ]

  const fromReplay = projectReplayDivergenceExplanation({
    events,
    result: testResult,
    selectedAttemptNumber: 1,
  })
  const fromAdaptive = projectReplayDivergenceExplanation({
    events,
    result: testResult,
    selectedAttemptNumber: 2,
  })

  expect(fromReplay).toEqual(fromAdaptive)
  expect(fromReplay).toEqual({
    divergence: {
      attempt: 1,
      stepIndex: 1,
      stepText: 'Then payment is captured',
    },
    sealedPrefix: {
      stepCount: 1,
      boundaryStepText: 'Given an order exists',
    },
    fallback: { kind: 'restarted-next-attempt', attempt: 2 },
  })
})

test('does not pair events across result scope or cache identity', () => {
  const testResult = result([attempt(1, [step(0, 'an order exists')])])
  const otherCacheKey = { ...cacheKey, applicationRevision: 'application-2' }

  expect(
    projectReplayDivergenceExplanation({
      events: [
        cacheEvent('replay-diverged', 1, 1, {
          scenarioId: 'another-scenario',
        }),
        cacheEvent('adaptive-fallback-started', 2, 1),
        cacheEvent('replay-diverged', 3, 1),
        cacheEvent('adaptive-fallback-started', 4, 1, {
          key: otherCacheKey,
        }),
      ],
      result: testResult,
      selectedAttemptNumber: 1,
    }),
  ).toBeUndefined()
})

test('does not explain an unpaired cache-only divergence', () => {
  const testResult = result([
    attempt(1, [step(0, 'an order exists', 'failed')]),
  ])

  expect(
    projectReplayDivergenceExplanation({
      events: [cacheEvent('replay-diverged', 1, 1)],
      result: testResult,
      selectedAttemptNumber: 1,
    }),
  ).toBeUndefined()
})
