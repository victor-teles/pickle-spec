import { expect, test } from 'bun:test'
import { formatJson, formatJunit, formatNdjson } from '../index'
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
    result('Adapt the purchase', 'passed-with-adaptation'),
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
    result: result('Complete a purchase', 'passed'),
  },
]

test('formats versioned JSON from the materialized test-run schema', () => {
  expect(JSON.parse(formatJson(manifest))).toEqual({
    schemaVersion: 1,
    id: 'run-ci',
    startedAt: '2026-08-15T12:00:00.000Z',
    finishedAt: '2026-08-15T12:01:00.000Z',
    state: 'failed',
    results: manifest.results,
  })
})

test('formats NDJSON from the versioned run-event schema', () => {
  expect(
    formatNdjson(events)
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line)),
  ).toEqual(events)
})

test('formats JUnit XML with stable states, flaky, and error classes', () => {
  expect(formatJunit(manifest)).toBe(`<?xml version="1.0" encoding="UTF-8"?>
<testsuites id="run-ci" name="run-ci" tests="7" failures="1" errors="2" skipped="1">
  <testsuite name="Checkout" tests="7" failures="1" errors="2" skipped="1">
    <testcase name="Complete a purchase" classname="features/checkout.feature"/>
    <testcase name="Adapt the purchase" classname="features/checkout.feature">
      <properties>
        <property name="state" value="passed-with-adaptation"/>
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
