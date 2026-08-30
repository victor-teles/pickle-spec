import type {
  RunEvent,
  ScenarioAttempt,
  TestResult,
  TestStepResult,
} from '../../../../src/execution/run-scenario'
import { requiredValue } from '../../../../src/required-value'
import type { TestRunManifest } from '../../../../src/results/test-run-store'

export const startedAt = '2026-08-15T12:00:01.000Z'

export const finishedAt = '2026-08-15T12:00:02.000Z'

export interface ResultExtras {
  attempt?: Partial<ScenarioAttempt>
  attempts?: ScenarioAttempt[]
  flaky?: boolean
}

export function step(
  index: number,
  state: TestStepResult['state'],
  extras: Partial<TestStepResult> = {},
): TestStepResult {
  return {
    index,
    startedAt,
    finishedAt,
    durationMs: 1_000,
    step: { keyword: 'Then', text: 'the outcome is visible', type: 'outcome' },
    state,
    resolvedActions: [],
    ...extras,
  }
}

export function attempt(
  state: ScenarioAttempt['state'],
  extras: Partial<ScenarioAttempt> = {},
  attemptNumber = 1,
): ScenarioAttempt {
  return {
    attempt: attemptNumber,
    startedAt,
    finishedAt,
    durationMs: 1_000,
    state,
    steps: [],
    evidenceAvailability: [
      { kind: 'screenshot', state: 'not-supported' },
      { kind: 'trace', state: 'not-supported' },
      { kind: 'recording', state: 'not-supported' },
      { kind: 'device-log', state: 'not-supported' },
      { kind: 'diagnostics', state: 'not-supported' },
    ],
    ...extras,
  }
}

export function result(
  name: string,
  state: TestResult['state'],
  extras: ResultExtras = {},
): TestResult {
  const attempts = extras.attempts ?? [attempt(state, extras.attempt)]
  return {
    schemaVersion: 2,
    specification: {
      name: 'Checkout',
      uri: 'features/checkout.feature',
    },
    scenario: { name, id: 'scncheckout00000' },
    executionTargetProfile: { id: 'deterministic' },
    state,
    startedAt: requiredValue(attempts[0]).startedAt,
    finishedAt: requiredValue(attempts.at(-1)).finishedAt,
    durationMs: 1_000,
    attempts,
    flaky: extras.flaky,
  }
}

export function scenarioFinishedEvent(testResult: TestResult): RunEvent {
  const scenarioAttempt = requiredValue(testResult.attempts.at(-1))
  return {
    schemaVersion: 2,
    sequence: 2,
    occurredAt: scenarioAttempt.finishedAt,
    type: 'scenario-finished',
    specification: testResult.specification,
    scenario: testResult.scenario,
    executionTargetProfile: testResult.executionTargetProfile,
    scope: {
      scenarioId: requiredValue(testResult.scenario.id),
      examplesRowId: testResult.scenario.examplesRowId,
      executionTargetProfileId: testResult.executionTargetProfile.id,
      attempt: scenarioAttempt.attempt,
    },
    attempt: scenarioAttempt,
  }
}

export const manifest: TestRunManifest = {
  schemaVersion: 2,
  id: 'run-ci',
  startedAt: '2026-08-15T12:00:00.000Z',
  finishedAt: '2026-08-15T12:01:00.000Z',
  state: 'failed',
  results: [
    result('Complete a purchase', 'passed'),
    result('Review the purchase', 'passed'),
    result('Retry the purchase', 'passed', {
      attempts: [
        attempt('failed', { message: 'First attempt failed' }, 1),
        attempt('passed', {}, 2),
      ],
      flaky: true,
    }),
    result('Pay for the order', 'failed', {
      attempt: { message: 'Payment was declined' },
    }),
    result('Skip the purchase', 'skipped', {
      attempt: { message: 'Scenario is tagged @ignore' },
    }),
    result('Cancel the purchase', 'cancelled', {
      attempt: { message: 'Scenario cancelled' },
    }),
    result('Open the storefront', 'infrastructure-error', {
      attempt: { message: 'Browser process exited' },
    }),
  ],
}

export const cachedResult = result('Complete a purchase', 'passed', {
  attempt: {
    executionMode: 'replay',
    cacheOutcome: 'hit',
    inferenceCount: 0,
  },
})

export const events: RunEvent[] = [
  {
    schemaVersion: 2,
    sequence: 1,
    occurredAt: '2026-08-15T12:00:00.000Z',
    type: 'run-started',
    run: { id: 'run-ci', startedAt: '2026-08-15T12:00:00.000Z' },
  },
  scenarioFinishedEvent(cachedResult),
]

export const canonicalAttempt = {
  attempt: 1,
  startedAt: '2026-08-15T12:00:01.000Z',
  finishedAt: '2026-08-15T12:00:03.500Z',
  durationMs: 2_500,
  state: 'failed',
  steps: [
    {
      index: 0,
      startedAt: '2026-08-15T12:00:01.000Z',
      finishedAt: '2026-08-15T12:00:02.000Z',
      durationMs: 1_000,
      step: { keyword: 'When', text: 'I click pay', type: 'action' },
      state: 'passed',
      resolvedActions: [{ description: 'Click pay on chrome' }],
    },
    {
      index: 1,
      startedAt: '2026-08-15T12:00:02.000Z',
      finishedAt: '2026-08-15T12:00:03.500Z',
      durationMs: 1_500,
      step: {
        keyword: 'Then',
        text: 'payment is captured',
        type: 'outcome',
      },
      state: 'failed',
      resolvedActions: [],
      message: 'Payment was declined',
      artifacts: [
        {
          kind: 'screenshot',
          path: '/pickle-home/projects/checkout/runs/run-evidence/artifacts/attempt-1/step-2.png',
          mediaType: 'image/png',
        },
      ],
    },
  ],
  executionMode: 'adaptive',
  cacheOutcome: 'uncacheable',
  inferenceCount: 0,
  message: 'Payment was declined',
  evidenceAvailability: [
    { kind: 'screenshot', state: 'available' },
    { kind: 'trace', state: 'not-supported' },
    { kind: 'recording', state: 'not-supported' },
    { kind: 'device-log', state: 'not-supported' },
    { kind: 'diagnostics', state: 'not-supported' },
  ],
} as const

export const canonicalResult = {
  schemaVersion: 2,
  specification: {
    name: 'Checkout',
    uri: 'features/checkout.feature',
  },
  scenario: {
    name: 'Pay for the order',
    id: 'scnpaybbbbbbbbbb',
    examplesId: 'exspayccccccccbb',
    examplesRowId: 'rowpayddddddddbb',
  },
  executionTargetProfile: {
    id: 'chrome',
    adapter: 'web',
    capabilities: ['web', 'screenshots'],
  },
  state: 'failed',
  startedAt: canonicalAttempt.startedAt,
  finishedAt: canonicalAttempt.finishedAt,
  durationMs: canonicalAttempt.durationMs,
  attempts: [canonicalAttempt],
} as const

export const canonicalManifest = {
  schemaVersion: 2,
  id: 'run-evidence',
  startedAt: '2026-08-15T12:00:00.000Z',
  finishedAt: '2026-08-15T12:00:04.000Z',
  state: 'failed',
  results: [canonicalResult],
} as const

export const canonicalEvents = [
  {
    schemaVersion: 2,
    sequence: 1,
    occurredAt: '2026-08-15T12:00:00.000Z',
    type: 'run-started',
    run: {
      id: 'run-evidence',
      startedAt: '2026-08-15T12:00:00.000Z',
    },
  },
  {
    schemaVersion: 2,
    sequence: 8,
    occurredAt: '2026-08-15T12:00:03.500Z',
    type: 'scenario-finished',
    scope: {
      scenarioId: 'scnpaybbbbbbbbbb',
      examplesRowId: 'rowpayddddddddbb',
      executionTargetProfileId: 'chrome',
      attempt: 1,
    },
    specification: canonicalResult.specification,
    scenario: canonicalResult.scenario,
    executionTargetProfile: canonicalResult.executionTargetProfile,
    attempt: canonicalAttempt,
  },
] as const
