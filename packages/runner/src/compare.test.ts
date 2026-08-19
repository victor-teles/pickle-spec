import { expect, test } from 'bun:test'
import { compareTestRuns } from '../index'
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
    steps: [
      {
        step: {
          keyword: 'Then',
          text: 'the purchase succeeds',
          type: 'outcome',
        },
        state,
        resolvedActions: [{ description: 'Click purchase' }],
      },
    ],
    durationMs: 100,
    executionMode: 'replay',
    ...extras,
  }
}

const baseline: TestRunManifest = {
  schemaVersion: 1,
  id: 'run-baseline',
  startedAt: '2026-08-15T12:00:00.000Z',
  finishedAt: '2026-08-15T12:01:00.000Z',
  state: 'failed',
  results: [
    result('Complete a purchase', 'passed'),
    result('Pay for the order', 'failed', { durationMs: 200 }),
    result('Skip the purchase', 'skipped'),
  ],
}

test('compareTestRuns matches results by Scenario and execution target profile identifiers', () => {
  const candidate: TestRunManifest = {
    ...baseline,
    id: 'run-candidate',
    results: [
      result('Complete a purchase', 'passed', { durationMs: 150, flaky: true }),
      result('Pay for the order', 'passed-with-adaptation', {
        durationMs: 200,
        executionMode: 'adaptive',
        steps: [
          {
            step: {
              keyword: 'Then',
              text: 'the purchase succeeds',
              type: 'outcome',
            },
            state: 'passed-with-adaptation',
            resolvedActions: [{ description: 'Click buy now' }],
            artifacts: [
              {
                kind: 'screenshot',
                path: '.pickle/runs/run-candidate/artifacts/pay.png',
                mediaType: 'image/png',
              },
            ],
          },
        ],
      }),
      result('Mobile purchase', 'passed', {
        executionTargetProfile: { id: 'android' },
      }),
    ],
  }

  expect(compareTestRuns(baseline, candidate)).toEqual({
    schemaVersion: 1,
    baselineRunId: 'run-baseline',
    candidateRunId: 'run-candidate',
    pairs: [
      {
        scenarioId: 'scn-complete-a-purchase',
        executionTargetProfileId: 'web',
        baseline: baseline.results[0]!,
        candidate: candidate.results[0]!,
        changes: ['duration', 'flaky'],
      },
      {
        scenarioId: 'scn-pay-for-the-order',
        executionTargetProfileId: 'web',
        baseline: baseline.results[1]!,
        candidate: candidate.results[1]!,
        changes: ['state', 'adaptation', 'plan', 'artifacts'],
      },
    ],
    removed: [
      {
        scenarioId: 'scn-skip-the-purchase',
        executionTargetProfileId: 'web',
        result: baseline.results[2]!,
      },
    ],
    added: [
      {
        scenarioId: 'scn-mobile-purchase',
        executionTargetProfileId: 'android',
        result: candidate.results[2]!,
      },
    ],
  })
})

test('compareTestRuns falls back to Scenario name when identifiers are absent', () => {
  const olderBaseline: TestRunManifest = {
    schemaVersion: 1,
    id: 'run-old',
    startedAt: '2026-08-15T12:00:00.000Z',
    state: 'passed',
    results: [
      {
        ...result('Complete a purchase', 'passed'),
        scenario: { name: 'Complete a purchase' },
        durationMs: undefined,
      },
    ],
  }
  const candidate: TestRunManifest = {
    schemaVersion: 1,
    id: 'run-new',
    startedAt: '2026-08-15T12:00:00.000Z',
    state: 'failed',
    results: [result('Complete a purchase', 'failed')],
  }

  expect(compareTestRuns(olderBaseline, candidate)).toMatchObject({
    pairs: [
      {
        scenarioId: 'Complete a purchase',
        executionTargetProfileId: 'web',
        changes: ['state'],
      },
    ],
  })
})

test('compareTestRuns does not pair different durable Scenario identifiers by name', () => {
  const renamed: TestRunManifest = {
    ...baseline,
    id: 'run-renamed',
    results: [
      {
        ...baseline.results[0]!,
        scenario: {
          name: baseline.results[0]!.scenario.name,
          id: 'scn-different-scenario',
        },
      },
    ],
  }

  expect(compareTestRuns(baseline, renamed)).toMatchObject({
    pairs: [],
    removed: [
      { scenarioId: 'scn-complete-a-purchase' },
      { scenarioId: 'scn-pay-for-the-order' },
      { scenarioId: 'scn-skip-the-purchase' },
    ],
    added: [{ scenarioId: 'scn-different-scenario' }],
  })
})
