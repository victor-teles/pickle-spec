import type {
  ActionEvidence,
  RunEvent,
  ScenarioAttempt,
  TestRunManifest,
} from '@pickle-spec/runner'
import { expect, test } from 'vitest'
import { timelineFor } from '../../../../src/features/runs/result/result-evidence'
import type { ResultInspectionLocation } from '../../../../src/features/runs/result/result-inspection'
import { timeTravelInspection } from '../../../../src/features/runs/result/time-travel-inspection'
import type { StudioRunSnapshot } from '../../../../src/server/contracts'

const location: ResultInspectionLocation = {
  specificationUri: 'features/checkout.feature',
  runId: 'run-1',
  scenarioId: 'checkout',
  profileId: 'chrome',
  attempt: 2,
}

const action: ActionEvidence = {
  version: 1,
  id: 'step-1-action-1',
  ordinal: 0,
  description: 'Click Pay',
  startedAt: '2026-08-30T12:00:00.000Z',
  finishedAt: '2026-08-30T12:00:00.100Z',
  durationMs: 100,
  state: 'passed',
  source: {
    uri: location.specificationUri,
    language: 'en',
    line: 4,
    column: 5,
    excerpt: 'When click Pay',
  },
  target: {
    before: { format: 'summary', summary: 'Checkout ready' },
    after: { format: 'summary', summary: 'Payment submitted' },
  },
  screenshots: {
    before: { state: 'not-requested' },
    after: { state: 'not-requested' },
  },
  diagnostics: [],
  activity: [],
}

function actionEvent(
  attempt = location.attempt,
  state: ActionEvidence['state'] = action.state,
): RunEvent {
  const eventAction = { ...action, state }
  return {
    schemaVersion: 2,
    sequence: 3,
    occurredAt: eventAction.finishedAt,
    type: 'action-finished',
    action: eventAction,
    scenario: { id: location.scenarioId, name: 'Checkout' },
    executionTargetProfile: { id: location.profileId },
    scope: {
      scenarioId: location.scenarioId,
      executionTargetProfileId: location.profileId,
      attempt,
      stepIndex: 0,
    },
  }
}

function manifest(
  resolvedAction: {
    description: string
    evidence?: ActionEvidence
  },
  trace?: ScenarioAttempt['steps'][number]['trace'],
): TestRunManifest {
  return {
    schemaVersion: 2,
    id: location.runId,
    startedAt: '2026-08-30T12:00:00.000Z',
    finishedAt: '2026-08-30T12:00:01.000Z',
    state: 'passed',
    results: [
      {
        schemaVersion: 2,
        specification: { name: 'Checkout', uri: location.specificationUri },
        scenario: { id: location.scenarioId, name: 'Checkout' },
        executionTargetProfile: { id: location.profileId },
        state: 'passed',
        startedAt: '2026-08-30T12:00:00.000Z',
        finishedAt: '2026-08-30T12:00:01.000Z',
        durationMs: 1_000,
        attempts: [
          {
            attempt: location.attempt,
            startedAt: '2026-08-30T12:00:00.000Z',
            finishedAt: '2026-08-30T12:00:01.000Z',
            durationMs: 1_000,
            state: 'passed',
            steps: [
              {
                index: 0,
                startedAt: '2026-08-30T12:00:00.000Z',
                finishedAt: '2026-08-30T12:00:01.000Z',
                durationMs: 1_000,
                step: { keyword: 'When', text: 'click Pay', type: 'action' },
                state: 'passed',
                resolvedActions: [resolvedAction],
                trace,
              },
            ],
            evidenceAvailability: [
              { kind: 'screenshot', state: 'not-requested' },
              { kind: 'trace', state: 'not-requested' },
              { kind: 'recording', state: 'not-requested' },
              { kind: 'device-log', state: 'not-requested' },
              { kind: 'diagnostics', state: 'not-requested' },
            ],
          },
        ],
      },
    ],
  }
}

test('projects equivalent live and hydrated action details', () => {
  const live: StudioRunSnapshot = {
    id: location.runId,
    events: [actionEvent()],
  }
  const hydrated: StudioRunSnapshot = {
    id: location.runId,
    events: [actionEvent()],
    manifest: manifest({ description: action.description, evidence: action }),
  }

  expect(timeTravelInspection(live, location)).toEqual(
    timeTravelInspection(hydrated, location),
  )
})

test('connects exact action evidence to its Timeline entry', () => {
  const snapshot: StudioRunSnapshot = {
    id: location.runId,
    events: [actionEvent()],
    manifest: manifest({ description: action.description, evidence: action }),
  }
  const attempt = snapshot.manifest?.results[0]?.attempts[0]
  if (!attempt) throw new Error('Expected a completed attempt')
  const actions = timeTravelInspection(snapshot, location)
  const entry = timelineFor(snapshot.events, attempt, location, actions).find(
    (candidate) => candidate.kind === 'Resolved action',
  )

  expect(entry).toMatchObject({
    startedAt: action.startedAt,
    finishedAt: action.finishedAt,
    timingPrecision: 'exact',
    action: { evidence: { id: action.id } },
  })
})

test('uses distinct cursor IDs for actions and browser trace entries', () => {
  const snapshot: StudioRunSnapshot = {
    id: location.runId,
    events: [actionEvent()],
    manifest: manifest({ description: action.description, evidence: action }, [
      {
        occurredAt: '2026-08-30T12:00:00.050Z',
        kind: 'browser-activity',
        description: 'Pay button became visible',
      },
    ]),
  }
  const attempt = snapshot.manifest?.results[0]?.attempts[0]
  if (!attempt) throw new Error('Expected a completed attempt')
  const entries = timelineFor(
    snapshot.events,
    attempt,
    location,
    timeTravelInspection(snapshot, location),
  )

  expect(new Set(entries.map((entry) => entry.id)).size).toBe(entries.length)
  expect(
    entries
      .filter(
        (entry) =>
          entry.kind === 'Resolved action' || entry.kind === 'Browser activity',
      )
      .map((entry) => entry.id.slice(entry.id.lastIndexOf(':') + 1)),
  ).toEqual(['action-0-0', 'browser-trace-0-0'])
})

test('labels legacy schema-v2 actions without inventing missing evidence', () => {
  const snapshot: StudioRunSnapshot = {
    id: location.runId,
    events: [],
    manifest: manifest({ description: 'Click Pay' }),
  }

  expect(timeTravelInspection(snapshot, location)).toMatchObject([
    {
      precision: 'legacy-step-finish',
      description: 'Click Pay',
      evidence: undefined,
    },
  ])
})

test('links the same logical action across retry attempts', () => {
  const snapshot: StudioRunSnapshot = {
    id: location.runId,
    events: [actionEvent(1, 'failed'), actionEvent(2, 'passed')],
  }

  expect(timeTravelInspection(snapshot, location)[0]?.retries).toEqual([
    { attempt: 1, state: 'failed', current: false },
    { attempt: 2, state: 'passed', current: true },
  ])
})
