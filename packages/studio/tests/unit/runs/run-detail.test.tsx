import type { ScenarioAttempt, TestResult } from '@pickle-spec/runner'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { LiveResultInspection } from '../../../src/features/runs/result/live-result-inspection'
import { RunDetail } from '../../../src/features/runs/run-detail'
import type { StudioRunSnapshot } from '../../../src/server/contracts'

function attempt(number: number, state: 'passed' | 'failed'): ScenarioAttempt {
  return {
    attempt: number,
    startedAt: '2026-08-30T12:00:00.000Z',
    finishedAt: '2026-08-30T12:00:01.000Z',
    durationMs: 1_000,
    state,
    steps: [],
    evidenceAvailability: [],
  }
}

function result(name: string, state: 'passed' | 'failed'): TestResult {
  const scenarioAttempt = attempt(1, state)
  return {
    schemaVersion: 2,
    specification: {
      name: 'Checkout',
      uri: 'features/checkout.feature',
    },
    scenario: { id: `scenario-${state}`, name },
    executionTargetProfile: { id: 'chrome' },
    state,
    startedAt: scenarioAttempt.startedAt,
    finishedAt: scenarioAttempt.finishedAt,
    durationMs: scenarioAttempt.durationMs,
    attempts: [scenarioAttempt],
  }
}

const snapshot: StudioRunSnapshot = {
  id: 'run-42',
  events: [],
  manifest: {
    schemaVersion: 2,
    id: 'run-42',
    startedAt: '2026-08-30T12:00:00.000Z',
    finishedAt: '2026-08-30T12:00:02.000Z',
    state: 'failed',
    results: [
      result('Complete a purchase', 'passed'),
      result('Pay for the order', 'failed'),
    ],
  },
}

const live: LiveResultInspection = {
  specificationUri: 'features/checkout.feature',
  runId: 'run-42',
  phase: 'finished',
  events: [],
  schedule: [],
  liveDiagnostics: [],
  liveViewports: new Map(),
  snapshot,
  connection: { kind: 'connected' },
  following: false,
  pinned: false,
}

test('keeps run actions and selects an attempt on the run page', () => {
  const markup = renderToStaticMarkup(
    <RunDetail
      api={async <Value,>() => snapshot as Value}
      runId="run-42"
      live={live}
      runsBlocked={false}
      onBack={() => {}}
      onCancel={() => {}}
      onOpenArtifact={() => {}}
      onRerun={async () => {}}
      onSelectLocation={() => {}}
    />,
  )

  expect(markup).toContain('Test run run-42')
  expect(markup).toContain('Download report')
  expect(markup).toContain('Rerun failures')
  expect(markup).toContain('id="run-attempt-select"')
  expect(markup).toContain('Pay for the order · chrome')
  expect(markup).toContain('Rerun Scenario')
  expect(markup).toContain('Rerun target')
})
