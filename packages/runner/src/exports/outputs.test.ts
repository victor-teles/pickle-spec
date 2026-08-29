import { expect, test } from 'vitest'
import {
  formatJson,
  formatJunit,
  formatNdjson,
  publicRunEvent,
  publicTestResult,
} from '../../index'
import type {
  RunEvent,
  ScenarioAttempt,
  TestResult,
  TestStepResult,
} from '../execution/run-scenario'
import { requiredValue } from '../required-value'
import type { TestRunManifest } from '../results/test-run-store'

const startedAt = '2026-08-15T12:00:01.000Z'
const finishedAt = '2026-08-15T12:00:02.000Z'

interface ResultExtras {
  attempt?: Partial<ScenarioAttempt>
  attempts?: ScenarioAttempt[]
  flaky?: boolean
}

function step(
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

function attempt(
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

function result(
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

function scenarioFinishedEvent(testResult: TestResult): RunEvent {
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

const manifest: TestRunManifest = {
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

const cachedResult = result('Complete a purchase', 'passed', {
  attempt: {
    executionMode: 'replay',
    cacheOutcome: 'hit',
    inferenceCount: 0,
  },
})
const events: RunEvent[] = [
  {
    schemaVersion: 2,
    sequence: 1,
    occurredAt: '2026-08-15T12:00:00.000Z',
    type: 'run-started',
    run: { id: 'run-ci', startedAt: '2026-08-15T12:00:00.000Z' },
  },
  scenarioFinishedEvent(cachedResult),
]

const canonicalAttempt = {
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

const canonicalResult = {
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

const canonicalManifest = {
  schemaVersion: 2,
  id: 'run-evidence',
  startedAt: '2026-08-15T12:00:00.000Z',
  finishedAt: '2026-08-15T12:00:04.000Z',
  state: 'failed',
  results: [canonicalResult],
} as const

const canonicalEvents = [
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

test('formats versioned JSON from the materialized test-run schema', () => {
  expect(JSON.parse(formatJson(manifest))).toEqual(manifest)
  expect(manifest.results[1]?.state).toBe('passed')
})

test('formats NDJSON from the versioned run-event schema', () => {
  expect(
    formatNdjson(events)
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
  ).toEqual(events)
})

test('projects canonical schema-v2 Test evidence to exact JSON', () => {
  expect(
    JSON.parse(formatJson(canonicalManifest as unknown as TestRunManifest)),
  ).toEqual(canonicalManifest)
})

test('projects canonical schema-v2 Run events to exact NDJSON', () => {
  expect(
    formatNdjson(canonicalEvents as unknown as RunEvent[])
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
  ).toEqual([...canonicalEvents])
})

test('preserves Execution cache behavior in JSON and NDJSON', () => {
  const cached = result('Replay checkout', 'passed', {
    attempt: {
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 0,
    },
  })
  const uncacheable = result('Adaptive checkout', 'passed', {
    attempt: {
      executionMode: 'adaptive',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'non-deterministic-assertion',
      inferenceCount: 2,
    },
  })
  const structuredManifest = { ...manifest, results: [cached, uncacheable] }

  expect(JSON.parse(formatJson(structuredManifest)).results).toEqual([
    cached,
    uncacheable,
  ])
  expect(formatNdjson([scenarioFinishedEvent(cached)])).toContain(
    '"executionMode":"replay"',
  )
})

test('public output boundaries omit private replay data without mutating results', () => {
  const privateStep = step(0, 'passed', {
    step: { keyword: 'When', text: 'I submit', type: 'action' },
    resolvedActions: [
      {
        description: 'Submit the form',
        replay: { raw: 'private-replay-payload' },
      },
    ],
  })
  const privateResult = result('Private cache payload', 'passed', {
    attempt: {
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 0,
      steps: [privateStep],
    },
  })
  const privateEvent = scenarioFinishedEvent(privateResult)

  expect(formatJson({ ...manifest, results: [privateResult] })).not.toContain(
    'private-replay-payload',
  )
  expect(formatNdjson([privateEvent])).not.toContain('private-replay-payload')
  expect(
    publicTestResult(privateResult).attempts[0]?.steps[0]?.resolvedActions,
  ).toEqual([{ description: 'Submit the form' }])
  expect(privateStep.resolvedActions[0]?.replay).toEqual({
    raw: 'private-replay-payload',
  })
})

test('public event boundaries whitelist non-result event fields', () => {
  const malicious = {
    schemaVersion: 2,
    sequence: 1,
    occurredAt: '2026-08-15T12:00:00.000Z',
    type: 'run-started',
    prompt: 'private-system-prompt',
    adapterPayload: { secret: 'private-adapter-payload' },
    run: {
      id: 'run-public',
      startedAt: '2026-08-15T12:00:00.000Z',
      privateValue: 'private-bound-value',
    },
  } as unknown as RunEvent

  const source = JSON.stringify(publicRunEvent(malicious))
  expect(source).toBe(
    '{"type":"run-started","run":{"id":"run-public","startedAt":"2026-08-15T12:00:00.000Z"},"schemaVersion":2,"sequence":1,"occurredAt":"2026-08-15T12:00:00.000Z"}',
  )
})

test('formats JUnit XML with cache metadata, stable states, flaky, and error classes', () => {
  const junitManifest: TestRunManifest = {
    ...manifest,
    results: [
      result('Complete a purchase', 'passed', {
        attempt: {
          executionMode: 'replay',
          cacheOutcome: 'hit',
          inferenceCount: 0,
        },
      }),
      result('Adapt the purchase', 'passed', {
        attempt: {
          executionMode: 'adaptive',
          cacheOutcome: 'fallback',
          inferenceCount: 3,
        },
      }),
      ...manifest.results.slice(2),
    ],
  }
  expect(
    formatJunit(junitManifest),
  ).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<testsuites id="run-ci" name="run-ci" tests="7" failures="1" errors="2" skipped="1">
  <testsuite name="Checkout" tests="7" failures="1" errors="2" skipped="1">
    <testcase name="Complete a purchase" classname="features/checkout.feature">
      <properties>
        <property name="execution-mode" value="replay"/>
        <property name="cache-outcome" value="hit"/>
        <property name="inference-count" value="0"/>
      </properties>
    </testcase>
    <testcase name="Adapt the purchase" classname="features/checkout.feature">
      <properties>
        <property name="execution-mode" value="adaptive"/>
        <property name="cache-outcome" value="fallback"/>
        <property name="inference-count" value="3"/>
      </properties>
    </testcase>
    <testcase name="Retry the purchase" classname="features/checkout.feature">
      <properties>
        <property name="flaky" value="true"/>
      </properties>
    </testcase>
    <testcase name="Pay for the order" classname="features/checkout.feature">
      <failure message="Payment was declined"/>
    </testcase>
    <testcase name="Skip the purchase" classname="features/checkout.feature">
      <skipped message="Scenario is tagged @ignore"/>
    </testcase>
    <testcase name="Cancel the purchase" classname="features/checkout.feature">
      <error type="cancelled" message="Scenario cancelled"/>
    </testcase>
    <testcase name="Open the storefront" classname="features/checkout.feature">
      <error type="infrastructure-error" message="Browser process exited"/>
    </testcase>
  </testsuite>
</testsuites>
`)
})

test('exposes uncacheable and cache-only failure metadata in JUnit properties', () => {
  const uncacheable = result('Adaptive checkout', 'passed', {
    attempt: {
      executionMode: 'adaptive',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'non-deterministic-action',
      inferenceCount: 2,
    },
  })
  const cacheMiss = result('Replay checkout', 'failed', {
    attempt: {
      executionMode: 'replay',
      cacheOutcome: 'miss',
      failureKind: 'cache-miss',
      inferenceCount: 0,
    },
  })
  const xml = formatJunit({ ...manifest, results: [uncacheable, cacheMiss] })

  expect(xml).toContain(
    '<property name="cache-uncacheable-reason" value="non-deterministic-action"/>',
  )
  expect(xml).toContain('<property name="failure-kind" value="cache-miss"/>')
  expect(xml).toContain('<property name="inference-count" value="0"/>')
})
