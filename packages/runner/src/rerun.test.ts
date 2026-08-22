import { expect, test } from 'bun:test'
import { selectRerunResults } from '../index'
import type { TestResult } from './run-scenario'
import type { TestRunManifest } from './test-run-store'

interface ResultFixtureOptions {
  executionTargetProfile?: TestResult['executionTargetProfile']
}

function result(
  name: string,
  state: TestResult['state'],
  options: ResultFixtureOptions = {},
): TestResult {
  const startedAt = '2026-08-15T12:00:00.000Z'
  const finishedAt = '2026-08-15T12:00:00.100Z'
  return {
    schemaVersion: 2,
    specification: {
      name: 'Checkout',
      uri: 'features/checkout.feature',
    },
    scenario: { name, id: `scn-${name.replace(/\s+/g, '-').toLowerCase()}` },
    executionTargetProfile: options.executionTargetProfile ?? { id: 'web' },
    state,
    startedAt,
    finishedAt,
    durationMs: 100,
    attempts: [
      {
        attempt: 1,
        startedAt,
        finishedAt,
        durationMs: 100,
        state,
        steps: [],
        evidenceAvailability: [
          { kind: 'screenshot', state: 'not-supported' },
          { kind: 'trace', state: 'not-supported' },
          { kind: 'recording', state: 'not-supported' },
          { kind: 'device-log', state: 'not-supported' },
          { kind: 'diagnostics', state: 'not-supported' },
        ],
      },
    ],
  }
}

const manifest: TestRunManifest = {
  schemaVersion: 2,
  id: 'run-source',
  startedAt: '2026-08-15T12:00:00.000Z',
  finishedAt: '2026-08-15T12:01:00.000Z',
  state: 'failed',
  results: [
    result('Complete a purchase', 'passed'),
    result('Review the purchase', 'passed'),
    result('Pay for the order', 'failed'),
    result('Retry the purchase', 'infrastructure-error'),
    result('Mobile purchase', 'failed', {
      executionTargetProfile: { id: 'android' },
    }),
  ],
}

test('selectRerunResults returns every result when no filter is provided', () => {
  expect(selectRerunResults(manifest, {})).toEqual(manifest.results)
})

test('selectRerunResults selects failures', () => {
  expect(
    selectRerunResults(manifest, { failures: true }).map(
      (item) => item.scenario.name,
    ),
  ).toEqual(['Pay for the order', 'Retry the purchase', 'Mobile purchase'])
})

test('selectRerunResults intersects state filters with Scenario and profile identifiers', () => {
  expect(
    selectRerunResults(manifest, {
      failures: true,
      scenarioIds: ['scn-pay-for-the-order'],
    }).map((item) => item.scenario.name),
  ).toEqual(['Pay for the order'])

  expect(
    selectRerunResults(manifest, {
      failures: true,
      profileIds: ['android'],
    }).map((item) => item.scenario.name),
  ).toEqual(['Mobile purchase'])

  expect(
    selectRerunResults(manifest, {
      scenarioNames: ['Complete a purchase'],
      profileIds: ['web'],
    }).map((item) => item.scenario.name),
  ).toEqual(['Complete a purchase'])
})
