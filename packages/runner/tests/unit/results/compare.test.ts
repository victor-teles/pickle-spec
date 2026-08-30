import { expect, test } from 'vitest'
import { compareTestRuns } from '../../../index'
import {
  finalScenarioAttempt,
  type ScenarioAttempt,
  type TestResult,
} from '../../../src/execution/run-scenario'
import { requiredValue } from '../../../src/required-value'
import type { TestRunManifest } from '../../../src/results/test-run-store'

interface ResultFixtureOptions {
  durationMs?: number
  executionTargetProfile?: TestResult['executionTargetProfile']
  flaky?: boolean
  attempt?: Partial<ScenarioAttempt>
}

const fixtureStartedAt = '2026-08-15T12:00:00.000Z'

function result(
  name: string,
  state: TestResult['state'],
  options: ResultFixtureOptions = {},
): TestResult {
  const durationMs = options.durationMs ?? 100
  const finishedAt = new Date(
    Date.parse(fixtureStartedAt) + durationMs,
  ).toISOString()
  return {
    schemaVersion: 2,
    specification: {
      name: 'Checkout',
      uri: 'features/checkout.feature',
    },
    scenario: { name, id: `scn-${name.replace(/\s+/g, '-').toLowerCase()}` },
    executionTargetProfile: options.executionTargetProfile ?? { id: 'web' },
    state,
    startedAt: fixtureStartedAt,
    finishedAt,
    durationMs,
    attempts: [
      {
        attempt: 1,
        startedAt: fixtureStartedAt,
        finishedAt,
        durationMs,
        state,
        steps: [
          {
            index: 0,
            startedAt: fixtureStartedAt,
            finishedAt,
            durationMs,
            step: {
              keyword: 'Then',
              text: 'the purchase succeeds',
              type: 'outcome',
            },
            state,
            resolvedActions: [{ description: 'Click purchase' }],
          },
        ],
        executionMode: 'replay',
        evidenceAvailability: [
          { kind: 'screenshot', state: 'not-supported' },
          { kind: 'trace', state: 'not-supported' },
          { kind: 'recording', state: 'not-supported' },
          { kind: 'device-log', state: 'not-supported' },
          { kind: 'diagnostics', state: 'not-supported' },
        ],
        ...options.attempt,
      },
    ],
    ...(options.flaky ? { flaky: true } : {}),
  }
}

const baseline: TestRunManifest = {
  schemaVersion: 2,
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

test('finalScenarioAttempt rejects a noncanonical Test result without attempts', () => {
  const malformedResult = {
    ...result('Complete a purchase', 'passed'),
    attempts: [],
  }

  expect(() => finalScenarioAttempt(malformedResult)).toThrow(
    'A Test result requires at least one Scenario attempt',
  )
})

test('compareTestRuns matches results by Scenario and execution target profile identifiers', () => {
  const candidate: TestRunManifest = {
    ...baseline,
    id: 'run-candidate',
    results: [
      result('Complete a purchase', 'passed', { durationMs: 150, flaky: true }),
      result('Pay for the order', 'passed', {
        durationMs: 200,
        attempt: {
          executionMode: 'adaptive',
          steps: [
            {
              index: 0,
              startedAt: fixtureStartedAt,
              finishedAt: '2026-08-15T12:00:00.200Z',
              durationMs: 200,
              step: {
                keyword: 'Then',
                text: 'the purchase succeeds',
                type: 'outcome',
              },
              state: 'passed',
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
        },
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
        baseline: requiredValue(baseline.results[0]),
        candidate: requiredValue(candidate.results[0]),
        changes: ['duration', 'flaky'],
      },
      {
        scenarioId: 'scn-pay-for-the-order',
        executionTargetProfileId: 'web',
        baseline: requiredValue(baseline.results[1]),
        candidate: requiredValue(candidate.results[1]),
        changes: ['state', 'execution-mode', 'resolved-actions', 'artifacts'],
      },
    ],
    removed: [
      {
        scenarioId: 'scn-skip-the-purchase',
        executionTargetProfileId: 'web',
        result: requiredValue(baseline.results[2]),
      },
    ],
    added: [
      {
        scenarioId: 'scn-mobile-purchase',
        executionTargetProfileId: 'android',
        result: requiredValue(candidate.results[2]),
      },
    ],
  })
})

test('compareTestRuns falls back to Scenario name when identifiers are absent', () => {
  const olderBaseline: TestRunManifest = {
    schemaVersion: 2,
    id: 'run-old',
    startedAt: '2026-08-15T12:00:00.000Z',
    state: 'passed',
    results: [
      {
        ...result('Complete a purchase', 'passed'),
        scenario: { name: 'Complete a purchase' },
      },
    ],
  }
  const candidate: TestRunManifest = {
    schemaVersion: 2,
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
        ...requiredValue(baseline.results[0]),
        scenario: {
          name: requiredValue(baseline.results[0]).scenario.name,
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

test('compareTestRuns reports execution mode, Cache outcome, and inference changes independently', () => {
  const cacheBaseline: TestRunManifest = {
    ...baseline,
    id: 'run-cache-baseline',
    results: [
      result('Complete a purchase', 'passed', {
        attempt: {
          executionMode: 'replay',
          cacheOutcome: 'hit',
          inferenceCount: 0,
        },
      }),
    ],
  }
  const cacheCandidate: TestRunManifest = {
    ...cacheBaseline,
    id: 'run-cache-candidate',
    results: [
      result('Complete a purchase', 'passed', {
        attempt: {
          executionMode: 'adaptive',
          cacheOutcome: 'fallback',
          inferenceCount: 4,
        },
      }),
    ],
  }

  expect(compareTestRuns(cacheBaseline, cacheCandidate)).toMatchObject({
    pairs: [
      {
        changes: ['execution-mode', 'cache-outcome', 'inference-count'],
      },
    ],
  })
})
