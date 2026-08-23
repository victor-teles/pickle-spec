import { expect, test } from 'bun:test'
import type {
  RunEvent,
  ScenarioAttempt,
  TestResult,
  TestResultState,
} from '@pickle-spec/runner'
import {
  defaultResultInspectorTab,
  findInspectedResult,
  timelineFor,
} from './result-evidence'
import { historyLocationHref, parseHistoryLocation } from './result-inspection'
import type { StudioRunSnapshot } from './server'

const evidenceAvailability: ScenarioAttempt['evidenceAvailability'] = [
  { kind: 'screenshot', state: 'not-requested' },
  { kind: 'trace', state: 'not-requested' },
  { kind: 'recording', state: 'not-requested' },
  { kind: 'device-log', state: 'not-requested' },
  { kind: 'diagnostics', state: 'not-supported' },
]

function attempt(
  attemptNumber: number,
  state: TestResultState = 'passed',
): ScenarioAttempt {
  return {
    attempt: attemptNumber,
    startedAt: '2026-08-22T12:00:00.000Z',
    finishedAt: '2026-08-22T12:00:01.000Z',
    durationMs: 1_000,
    state,
    steps: [],
    evidenceAvailability,
  }
}

function result(
  specificationUri: string,
  examplesRowId: string,
  attempts: ScenarioAttempt[],
): TestResult {
  return {
    schemaVersion: 2,
    specification: { name: specificationUri, uri: specificationUri },
    scenario: {
      id: 'scenario-outline',
      name: 'Pay for each order',
      examplesRowId,
    },
    executionTargetProfile: { id: 'chrome' },
    state: attempts.at(-1)?.state ?? 'cancelled',
    startedAt: attempts[0]?.startedAt ?? '2026-08-22T12:00:00.000Z',
    finishedAt: attempts.at(-1)?.finishedAt ?? '2026-08-22T12:00:01.000Z',
    durationMs: attempts.reduce((total, item) => total + item.durationMs, 0),
    attempts,
  }
}

function snapshot(
  results: TestResult[],
  events: RunEvent[] = [],
): StudioRunSnapshot {
  return {
    id: 'run-78',
    events,
    manifest: {
      schemaVersion: 2,
      id: 'run-78',
      startedAt: '2026-08-22T12:00:00.000Z',
      finishedAt: '2026-08-22T12:00:02.000Z',
      state: 'failed',
      results,
    },
  }
}

function scenarioStarted(examplesRowId: string, sequence: number): RunEvent {
  return {
    schemaVersion: 2,
    sequence,
    occurredAt: `2026-08-22T12:00:00.00${sequence}Z`,
    type: 'scenario-started',
    scenario: {
      id: 'scenario-outline',
      name: 'Pay for each order',
      examplesRowId,
    },
    executionTargetProfile: { id: 'chrome' },
    scope: {
      scenarioId: 'scenario-outline',
      examplesRowId,
      executionTargetProfileId: 'chrome',
      attempt: 1,
    },
  }
}

test('selects one persisted attempt by Specification and Examples-row identity', () => {
  const expectedAttempt = attempt(1, 'failed')
  const run = snapshot([
    result('features/first.feature', 'row-1', [attempt(1)]),
    result('features/second.feature', 'row-2', [expectedAttempt, attempt(2)]),
  ])

  expect(
    findInspectedResult(run, {
      specificationUri: 'features/second.feature',
      runId: run.id,
      scenarioId: 'scenario-outline',
      examplesRowId: 'row-2',
      profileId: 'chrome',
      attempt: 1,
    })?.attempt,
  ).toBe(expectedAttempt)
})

test('keeps Run events scoped to the selected Examples row', () => {
  const selectedAttempt = attempt(1, 'failed')
  const entries = timelineFor(
    [scenarioStarted('row-1', 1), scenarioStarted('row-2', 2)],
    selectedAttempt,
    {
      specificationUri: 'features/checkout.feature',
      runId: 'run-78',
      scenarioId: 'scenario-outline',
      examplesRowId: 'row-2',
      profileId: 'chrome',
      attempt: 1,
    },
  )

  expect(entries.map((entry) => entry.detail)).toEqual(['Sequence 2'])
  expect(entries.some((entry) => entry.causal)).toBe(false)
})

test('opens failed attempts in Timeline and passed attempts in Overview', () => {
  expect(defaultResultInspectorTab('infrastructure-error')).toBe('timeline')
  expect(defaultResultInspectorTab('passed')).toBe('overview')
})

test('round-trips durable result identity through a deep link', () => {
  const location = {
    specificationUri: 'features/checkout.feature',
    runId: 'run-78',
    scenarioId: 'scenario-outline',
    examplesRowId: 'row-2',
    profileId: 'chrome',
    attempt: 2,
    tab: 'diagnostics' as const,
  }

  expect(parseHistoryLocation(historyLocationHref(location))).toEqual(location)
})
