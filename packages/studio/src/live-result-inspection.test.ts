import { expect, test } from 'bun:test'
import type {
  RunEvent,
  ScenarioAttempt,
  TestStepResult,
} from '@pickle-spec/runner'
import {
  cellsFromLiveInspection,
  disconnectLiveInspection,
  hydrateLiveInspection,
  pauseLiveFollowing,
  pinLiveInvestigation,
  receiveLiveStreamEvent,
  resumeLiveFollowing,
  startLiveInspection,
} from './live-result-inspection'
import {
  artifactsFor,
  defaultResultInspectorTab,
  diagnosticsFor,
  findInspectedResult,
  timelineFor,
} from './result-evidence'

const specificationUri = 'features/checkout.feature'
const scenario = {
  id: 'scnpaybbbbbbbbbb',
  name: 'Pay for the order',
}

function envelope(
  sequence: number,
  occurredAt = `2026-08-23T12:00:00.00${sequence}Z`,
) {
  return {
    schemaVersion: 2 as const,
    sequence,
    occurredAt,
  }
}

function scope(attempt = 1, stepIndex?: number) {
  return {
    scenarioId: scenario.id,
    executionTargetProfileId: 'chrome',
    attempt,
    stepIndex,
  }
}

function runStarted(): RunEvent {
  return {
    ...envelope(1),
    type: 'run-started',
    run: { id: 'run-79', startedAt: '2026-08-23T12:00:00.000Z' },
  }
}

function scenarioStarted(sequence = 2): RunEvent {
  return {
    ...envelope(sequence),
    type: 'scenario-started',
    scenario,
    executionTargetProfile: { id: 'chrome' },
    scope: scope(1),
  }
}

function stepStarted(sequence = 3): RunEvent {
  return {
    ...envelope(sequence),
    type: 'step-started',
    step: { keyword: 'Then ', text: 'payment is captured', type: 'outcome' },
    scenario,
    executionTargetProfile: { id: 'chrome' },
    scope: scope(1, 0),
  }
}

function failedStep(): TestStepResult {
  return {
    index: 0,
    startedAt: '2026-08-23T12:00:00.003Z',
    finishedAt: '2026-08-23T12:00:00.004Z',
    durationMs: 1,
    step: { keyword: 'Then ', text: 'payment is captured', type: 'outcome' },
    state: 'failed',
    resolvedActions: [{ description: 'Click pay on chrome' }],
    message: 'Payment was declined',
    artifacts: [
      {
        kind: 'screenshot',
        path: '/tmp/pay.png',
        mediaType: 'image/png',
      },
    ],
  }
}

function stepFinished(sequence = 4): RunEvent {
  return {
    ...envelope(sequence),
    type: 'step-finished',
    result: failedStep(),
    scenario,
    executionTargetProfile: { id: 'chrome' },
    scope: scope(1, 0),
  }
}

function failedAttempt(): ScenarioAttempt {
  return {
    attempt: 1,
    startedAt: '2026-08-23T12:00:00.002Z',
    finishedAt: '2026-08-23T12:00:00.005Z',
    durationMs: 3,
    state: 'failed',
    steps: [failedStep()],
    evidenceAvailability: [
      { kind: 'screenshot', state: 'available' },
      { kind: 'trace', state: 'not-requested' },
      { kind: 'recording', state: 'not-requested' },
      { kind: 'device-log', state: 'not-requested' },
      { kind: 'diagnostics', state: 'available' },
    ],
    message: 'Payment was declined',
  }
}

function scenarioFinished(sequence = 5): RunEvent {
  return {
    ...envelope(sequence),
    type: 'scenario-finished',
    specification: { name: 'Checkout', uri: specificationUri },
    scenario,
    executionTargetProfile: { id: 'chrome' },
    scope: scope(1),
    attempt: failedAttempt(),
  }
}

function passingStarted(sequence: number): RunEvent {
  return {
    ...envelope(sequence),
    type: 'scenario-started',
    scenario: { id: 'scnpassdddddddd', name: 'Complete a purchase' },
    executionTargetProfile: { id: 'chrome' },
    scope: {
      scenarioId: 'scnpassdddddddd',
      executionTargetProfileId: 'chrome',
      attempt: 1,
    },
  }
}

test('live Run events update the same Overview, Timeline, Artifacts, and Diagnostics surfaces', () => {
  let inspection = startLiveInspection({
    specificationUri,
    runId: 'run-79',
  })
  for (const event of [
    runStarted(),
    scenarioStarted(),
    stepStarted(),
    stepFinished(),
    scenarioFinished(),
  ]) {
    inspection = receiveLiveStreamEvent(inspection, event)
  }

  const inspected = findInspectedResult(
    inspection.snapshot!,
    inspection.location!,
  )
  expect(inspected?.attempt.state).toBe('failed')
  expect(defaultResultInspectorTab(inspected!.attempt.state)).toBe('timeline')
  expect(
    timelineFor(
      inspection.snapshot!.events,
      inspected!.attempt,
      inspection.location!,
    ).map((entry) => entry.kind),
  ).toEqual([
    'Run event',
    'Run event',
    'Step',
    'Run event',
    'Diagnostic entry',
    'Test artifact',
    'Run event',
  ])
  expect(artifactsFor(inspected!.attempt)).toHaveLength(1)
  expect(
    diagnosticsFor(inspected!.attempt).map((item) => item.message),
  ).toEqual(['Payment was declined'])
})

test('follows the newest causal activity until the user intervenes', () => {
  let inspection = startLiveInspection({
    specificationUri,
    runId: 'run-79',
  })
  inspection = receiveLiveStreamEvent(inspection, runStarted())
  inspection = receiveLiveStreamEvent(inspection, scenarioStarted())
  inspection = receiveLiveStreamEvent(inspection, stepStarted())
  const followedThroughStart = inspection.followedEntryId
  expect(followedThroughStart).toBeTruthy()

  inspection = receiveLiveStreamEvent(inspection, stepFinished())
  expect(inspection.followedEntryId).not.toBe(followedThroughStart)
  expect(inspection.following).toBe(true)

  inspection = pauseLiveFollowing(inspection)
  const pausedEntry = inspection.followedEntryId
  inspection = receiveLiveStreamEvent(inspection, scenarioFinished())
  expect(inspection.following).toBe(false)
  expect(inspection.followedEntryId).toBe(pausedEntry)
})

test('keeps the current investigation after the user intervenes unless they pinned a later failure', () => {
  let inspection = startLiveInspection({
    specificationUri,
    runId: 'run-79',
  })
  inspection = receiveLiveStreamEvent(inspection, runStarted())
  inspection = receiveLiveStreamEvent(inspection, scenarioStarted())
  inspection = pauseLiveFollowing(inspection)
  inspection = receiveLiveStreamEvent(inspection, passingStarted(6))

  expect(inspection.following).toBe(false)
  expect(inspection.location?.scenarioId).toBe(scenario.id)
})

test('resumes following after manual navigation', () => {
  let inspection = startLiveInspection({
    specificationUri,
    runId: 'run-79',
  })
  inspection = receiveLiveStreamEvent(inspection, runStarted())
  inspection = receiveLiveStreamEvent(inspection, scenarioStarted())
  inspection = receiveLiveStreamEvent(inspection, stepStarted())
  inspection = pauseLiveFollowing(inspection)
  inspection = receiveLiveStreamEvent(inspection, stepFinished())
  inspection = receiveLiveStreamEvent(inspection, scenarioFinished())
  const pausedEntry = inspection.followedEntryId

  inspection = resumeLiveFollowing(inspection)
  expect(inspection.following).toBe(true)
  expect(inspection.followedEntryId).not.toBe(pausedEntry)
  expect(inspection.followedEntryId).toBe('step-0')
})

test('keeps a pinned investigation when a later failure arrives', () => {
  let inspection = startLiveInspection({
    specificationUri,
    runId: 'run-79',
  })
  inspection = receiveLiveStreamEvent(inspection, runStarted())
  inspection = receiveLiveStreamEvent(inspection, passingStarted(2))
  inspection = pinLiveInvestigation(inspection, inspection.location!)
  inspection = receiveLiveStreamEvent(inspection, scenarioStarted(3))
  inspection = receiveLiveStreamEvent(inspection, stepFinished(4))
  inspection = receiveLiveStreamEvent(inspection, scenarioFinished(5))

  expect(inspection.pinned).toBe(true)
  expect(inspection.location?.scenarioId).toBe('scnpassdddddddd')
})

test('selects a failed Scenario attempt when the investigation is not pinned', () => {
  let inspection = startLiveInspection({
    specificationUri,
    runId: 'run-79',
  })
  inspection = receiveLiveStreamEvent(inspection, runStarted())
  inspection = receiveLiveStreamEvent(inspection, passingStarted(2))
  expect(inspection.location?.scenarioId).toBe('scnpassdddddddd')
  inspection = receiveLiveStreamEvent(inspection, scenarioStarted(3))
  inspection = receiveLiveStreamEvent(inspection, scenarioFinished(5))
  expect(inspection.location?.scenarioId).toBe(scenario.id)
})

test('represents event loss instead of silently dropping later Run events', () => {
  let inspection = startLiveInspection({
    specificationUri,
    runId: 'run-79',
  })
  inspection = receiveLiveStreamEvent(inspection, runStarted())
  inspection = receiveLiveStreamEvent(inspection, scenarioFinished(5))

  expect(inspection.connection).toEqual({
    kind: 'event-loss',
    lastReceivedSequence: 1,
    receivedSequence: 5,
  })
  expect(inspection.events.map((event) => event.sequence)).toEqual([1, 5])
  const inspected = findInspectedResult(
    inspection.snapshot!,
    inspection.location!,
  )
  expect(inspected?.attempt.state).toBe('failed')
})

test('represents a missing opening Run event instead of starting mid-stream silently', () => {
  let inspection = startLiveInspection({
    specificationUri,
    runId: 'run-79',
  })
  inspection = receiveLiveStreamEvent(inspection, scenarioFinished(5))

  expect(inspection.connection).toEqual({
    kind: 'event-loss',
    lastReceivedSequence: 0,
    receivedSequence: 5,
  })
})

test('recovers previously missing Run events when the stream replays them', () => {
  let inspection = startLiveInspection({
    specificationUri,
    runId: 'run-79',
  })
  inspection = receiveLiveStreamEvent(inspection, runStarted())
  inspection = receiveLiveStreamEvent(inspection, scenarioFinished(5))
  inspection = receiveLiveStreamEvent(inspection, scenarioStarted(2))
  inspection = receiveLiveStreamEvent(inspection, stepStarted(3))
  inspection = receiveLiveStreamEvent(inspection, stepFinished(4))

  expect(inspection.events.map((event) => event.sequence)).toEqual([
    1, 2, 3, 4, 5,
  ])
  expect(inspection.connection).toEqual({ kind: 'connected' })
})

test('represents disconnection instead of clearing live evidence', () => {
  let inspection = startLiveInspection({
    specificationUri,
    runId: 'run-79',
  })
  inspection = receiveLiveStreamEvent(inspection, runStarted())
  inspection = receiveLiveStreamEvent(inspection, scenarioStarted())
  inspection = disconnectLiveInspection(
    inspection,
    'The live event stream closed.',
  )

  expect(inspection.connection).toEqual({
    kind: 'disconnected',
    message: 'The live event stream closed.',
  })
  expect(
    findInspectedResult(inspection.snapshot!, inspection.location!)?.result
      .scenario.name,
  ).toBe('Pay for the order')
})

test('represents incomplete evidence while a Scenario attempt is still running', () => {
  let inspection = startLiveInspection({
    specificationUri,
    runId: 'run-79',
  })
  inspection = receiveLiveStreamEvent(inspection, runStarted())
  inspection = receiveLiveStreamEvent(inspection, scenarioStarted())
  expect(inspection.location?.tab).toBe('timeline')
  const inspected = findInspectedResult(
    inspection.snapshot!,
    inspection.location!,
  )

  expect(inspected?.attempt.evidenceAvailability).toEqual([
    {
      kind: 'screenshot',
      state: 'missing',
      message: 'This Scenario attempt is still running.',
    },
    {
      kind: 'trace',
      state: 'missing',
      message: 'This Scenario attempt is still running.',
    },
    {
      kind: 'recording',
      state: 'missing',
      message: 'This Scenario attempt is still running.',
    },
    {
      kind: 'device-log',
      state: 'missing',
      message: 'This Scenario attempt is still running.',
    },
    {
      kind: 'diagnostics',
      state: 'missing',
      message: 'This Scenario attempt is still running.',
    },
  ])
  expect(cellsFromLiveInspection(inspection)).toEqual([
    {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      profileId: 'chrome',
      state: 'running',
    },
  ])

  inspection = receiveLiveStreamEvent(inspection, stepFinished(3))
  expect(
    findInspectedResult(inspection.snapshot!, inspection.location!)?.attempt
      .evidenceAvailability,
  ).toEqual([
    { kind: 'screenshot', state: 'available' },
    {
      kind: 'trace',
      state: 'missing',
      message: 'This Scenario attempt is still running.',
    },
    {
      kind: 'recording',
      state: 'missing',
      message: 'This Scenario attempt is still running.',
    },
    {
      kind: 'device-log',
      state: 'missing',
      message: 'This Scenario attempt is still running.',
    },
    { kind: 'diagnostics', state: 'available' },
  ])
})

test('reconstructs the same visible evidence from persisted Test evidence', () => {
  let inspection = startLiveInspection({
    specificationUri,
    runId: 'run-79',
  })
  for (const event of [
    runStarted(),
    scenarioStarted(),
    stepStarted(),
    stepFinished(),
    scenarioFinished(),
  ]) {
    inspection = receiveLiveStreamEvent(inspection, event)
  }
  const live = findInspectedResult(inspection.snapshot!, inspection.location!)
  const liveTimeline = timelineFor(
    inspection.snapshot!.events,
    live!.attempt,
    inspection.location!,
  )

  inspection = hydrateLiveInspection(inspection, {
    id: 'run-79',
    events: inspection.events,
    manifest: {
      schemaVersion: 2,
      id: 'run-79',
      startedAt: '2026-08-23T12:00:00.000Z',
      finishedAt: '2026-08-23T12:00:00.005Z',
      state: 'failed',
      results: [
        {
          schemaVersion: 2,
          specification: { name: 'Checkout', uri: specificationUri },
          scenario,
          executionTargetProfile: { id: 'chrome' },
          state: 'failed',
          startedAt: failedAttempt().startedAt,
          finishedAt: failedAttempt().finishedAt,
          durationMs: failedAttempt().durationMs,
          attempts: [failedAttempt()],
        },
      ],
    },
  })

  const hydrated = findInspectedResult(
    inspection.snapshot!,
    inspection.location!,
  )
  expect(hydrated?.attempt).toEqual(live?.attempt)
  expect(
    timelineFor(
      inspection.snapshot!.events,
      hydrated!.attempt,
      inspection.location!,
    ),
  ).toEqual(liveTimeline)
  expect(inspection.phase).toBe('finished')
})
