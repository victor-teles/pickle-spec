import { expect, test } from 'bun:test'
import {
  formatJson,
  formatJunit,
  formatNdjson,
  publicRunEvent,
  publicTestResult,
} from '../index'
import type { RunEvent, TestResult } from './run-scenario'
import type { TestRunManifest } from './test-run-store'

function result(
  name: string,
  state: TestResult['state'],
  extras: Partial<TestResult> = {},
): TestResult {
  return {
    schemaVersion: 1,
    specification: {
      name: 'Checkout',
      uri: 'features/checkout.feature',
    },
    scenario: { name },
    executionTargetProfile: { id: 'deterministic' },
    state,
    steps: [],
    ...extras,
  }
}

const manifest: TestRunManifest = {
  schemaVersion: 1,
  id: 'run-ci',
  startedAt: '2026-08-15T12:00:00.000Z',
  finishedAt: '2026-08-15T12:01:00.000Z',
  state: 'failed',
  results: [
    result('Complete a purchase', 'passed'),
    result('Review the purchase', 'passed'),
    result('Retry the purchase', 'passed', { attempts: 2, flaky: true }),
    result('Pay for the order', 'failed', { message: 'Payment was declined' }),
    result('Skip the purchase', 'skipped', {
      message: 'Scenario is tagged @ignore',
    }),
    result('Cancel the purchase', 'cancelled', {
      message: 'Scenario cancelled',
    }),
    result('Open the storefront', 'infrastructure-error', {
      message: 'Browser process exited',
    }),
  ],
}

const events: RunEvent[] = [
  {
    schemaVersion: 1,
    sequence: 1,
    type: 'run-started',
    run: { id: 'run-ci', startedAt: '2026-08-15T12:00:00.000Z' },
  },
  {
    schemaVersion: 1,
    sequence: 2,
    type: 'scenario-finished',
    result: result('Complete a purchase', 'passed', {
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 0,
    }),
  },
]

test('formats versioned JSON from the materialized test-run schema', () => {
  const formatted = JSON.parse(formatJson(manifest))
  expect(formatted).toEqual({
    schemaVersion: 1,
    id: 'run-ci',
    startedAt: '2026-08-15T12:00:00.000Z',
    finishedAt: '2026-08-15T12:01:00.000Z',
    state: 'failed',
    results: manifest.results.map((testResult) =>
      testResult.state === 'passed'
        ? { ...testResult, state: 'passed' }
        : testResult,
    ),
  })
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

test('preserves Execution cache behavior in JSON and NDJSON', () => {
  const cached = result('Replay checkout', 'passed', {
    executionMode: 'replay',
    cacheOutcome: 'hit',
    inferenceCount: 0,
  })
  const uncacheable = result('Adaptive checkout', 'passed', {
    executionMode: 'adaptive',
    cacheOutcome: 'uncacheable',
    cacheUncacheableReason: 'non-deterministic-assertion',
    inferenceCount: 2,
  })
  const structuredManifest = { ...manifest, results: [cached, uncacheable] }

  expect(JSON.parse(formatJson(structuredManifest)).results).toEqual([
    cached,
    uncacheable,
  ])
  expect(
    formatNdjson([
      {
        schemaVersion: 1,
        sequence: 1,
        type: 'scenario-finished',
        result: cached,
      },
    ]),
  ).toContain('"executionMode":"replay"')
})

test('public output boundaries omit private replay data without mutating results', () => {
  const privateResult = result('Private cache payload', 'passed', {
    executionMode: 'replay',
    cacheOutcome: 'hit',
    inferenceCount: 0,
    steps: [
      {
        step: { keyword: 'When', text: 'I submit', type: 'action' },
        state: 'passed',
        resolvedActions: [
          {
            description: 'Submit the form',
            replay: { raw: 'private-replay-payload' },
          },
        ],
      },
    ],
  })
  const privateEvent: RunEvent = {
    schemaVersion: 1,
    sequence: 1,
    type: 'scenario-finished',
    result: privateResult,
  }

  expect(formatJson({ ...manifest, results: [privateResult] })).not.toContain(
    'private-replay-payload',
  )
  expect(formatNdjson([privateEvent])).not.toContain('private-replay-payload')
  expect(publicTestResult(privateResult).steps[0]?.resolvedActions).toEqual([
    { description: 'Submit the form' },
  ])
  expect(privateResult.steps[0]?.resolvedActions[0]?.replay).toEqual({
    raw: 'private-replay-payload',
  })
})

test('public event boundaries whitelist non-result event fields', () => {
  const malicious = {
    schemaVersion: 1,
    sequence: 1,
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
    '{"type":"run-started","run":{"id":"run-public","startedAt":"2026-08-15T12:00:00.000Z"},"schemaVersion":1,"sequence":1}',
  )
})

test('formats JUnit XML with cache metadata, stable states, flaky, and error classes', () => {
  const junitManifest: TestRunManifest = {
    ...manifest,
    results: [
      result('Complete a purchase', 'passed', {
        executionMode: 'replay',
        cacheOutcome: 'hit',
        inferenceCount: 0,
      }),
      result('Adapt the purchase', 'passed', {
        executionMode: 'adaptive',
        cacheOutcome: 'fallback',
        inferenceCount: 3,
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
    executionMode: 'adaptive',
    cacheOutcome: 'uncacheable',
    cacheUncacheableReason: 'non-deterministic-action',
    inferenceCount: 2,
  })
  const cacheMiss = result('Replay checkout', 'failed', {
    executionMode: 'replay',
    cacheOutcome: 'miss',
    failureKind: 'cache-miss',
    inferenceCount: 0,
  })
  const xml = formatJunit({ ...manifest, results: [uncacheable, cacheMiss] })

  expect(xml).toContain(
    '<property name="cache-uncacheable-reason" value="non-deterministic-action"/>',
  )
  expect(xml).toContain('<property name="failure-kind" value="cache-miss"/>')
  expect(xml).toContain('<property name="inference-count" value="0"/>')
})
