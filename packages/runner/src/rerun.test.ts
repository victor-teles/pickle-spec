import { expect, test } from 'bun:test'
import { selectRerunResults } from '../index'
import type { TestResult } from './run-scenario'
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
    scenario: { name, id: `scn-${name.replace(/\s+/g, '-').toLowerCase()}` },
    executionTargetProfile: { id: 'web' },
    state,
    steps: [],
    durationMs: 100,
    ...extras,
  }
}

const manifest: TestRunManifest = {
  schemaVersion: 1,
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
