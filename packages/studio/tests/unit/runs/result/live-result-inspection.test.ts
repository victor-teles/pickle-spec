import type {
  RunEvent,
  ScenarioAttempt,
  TestStepResult,
} from '@pickle-spec/runner'
import { expect, test } from 'vitest'
import { requiredValue } from '../../../../src/required-value'
import { defaultRunAttemptLocation } from '../../../../src/runs/result/live-result-follow'
import {
  cellsFromLiveInspection,
  disconnectLiveInspection,
  hydrateLiveInspection,
  liveInspectionFromSnapshot,
  liveViewportFor,
  pauseLiveFollowing,
  pinLiveInvestigation,
  receiveLiveStreamEvent,
  resumeLiveFollowing,
  startLiveInspection,
} from '../../../../src/runs/result/live-result-inspection'
import {
  artifactsFor,
  defaultResultInspectorTab,
  diagnosticsFor,
  findInspectedResult,
  timelineFor,
  visibleTimelineEntries,
} from '../../../../src/runs/result/result-evidence'

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
    diagnostics: [
      {
        occurredAt: '2026-08-23T12:00:00.004Z',
        level: 'error',
        origin: 'console',
        message: 'Payment was declined',
        scenarioId: scenario.id,
        scenarioName: scenario.name,
        stepIndex: 0,
        stepText: 'Then payment is captured',
        executionTargetProfileId: 'chrome',
      },
    ],
    trace: [
      {
        occurredAt: '2026-08-23T12:00:00.004Z',
        kind: 'resolved-action',
        description: 'Click pay on chrome',
      },
    ],
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
      { kind: 'trace', state: 'available' },
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
    requiredValue(inspection.snapshot),
    requiredValue(inspection.location),
  )
  expect(inspected?.attempt.state).toBe('failed')
  expect(
    defaultResultInspectorTab(requiredValue(inspected).attempt.state),
  ).toBe('timeline')
  const entries = timelineFor(
    requiredValue(inspection.snapshot).events,
    requiredValue(inspected).attempt,
    requiredValue(inspection.location),
  )
  expect(entries.map((entry) => entry.kind)).toEqual([
    'Run event',
    'Step',
    'Run event',
    'Resolved action',
    'Run event',
    'Diagnostic entry',
    'Test artifact',
    'Run event',
  ])
  expect(
    visibleTimelineEntries(entries, 'essential').map((entry) => entry.kind),
  ).toEqual(['Step', 'Diagnostic entry', 'Test artifact'])
  expect(artifactsFor(requiredValue(inspected).attempt)).toHaveLength(1)
  expect(
    diagnosticsFor(requiredValue(inspected).attempt).map(
      (item) => item.message,
    ),
  ).toEqual(['Payment was declined'])
})

test('restores a running inspection from an active snapshot and schedule', () => {
  const inspection = liveInspectionFromSnapshot(
    {
      id: 'run-79',
      events: [runStarted(), scenarioStarted(), stepStarted()],
      schedule: [
        {
          specification: { name: 'Checkout', uri: specificationUri },
          scenario,
          executionTargetProfile: { id: 'chrome' },
        },
      ],
    },
    specificationUri,
  )

  expect(inspection.phase).toBe('running')
  expect(inspection.schedule[0]?.specification.uri).toBe(specificationUri)
  expect(cellsFromLiveInspection(inspection)).toEqual([
    {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      profileId: 'chrome',
      state: 'running',
    },
  ])
})

test('keeps the latest viewport by Scenario and profile, independent of attempt', () => {
  let inspection = startLiveInspection({
    specificationUri,
    runId: 'run-viewport',
  })
  const target = { scenarioId: scenario.id, profileId: 'chrome' }
  inspection = receiveLiveStreamEvent(inspection, {
    type: 'viewport-updated',
    target,
    viewport: { kind: 'frame', data: 'first', mimeType: 'image/jpeg' },
  })
  inspection = receiveLiveStreamEvent(inspection, {
    type: 'viewport-updated',
    target,
    viewport: { kind: 'frame', data: 'latest', mimeType: 'image/jpeg' },
  })

  expect(
    liveViewportFor(inspection, {
      specificationUri,
      runId: 'run-viewport',
      scenarioId: scenario.id,
      profileId: 'chrome',
      attempt: 3,
    }),
  ).toEqual({ kind: 'frame', data: 'latest', mimeType: 'image/jpeg' })

  inspection = receiveLiveStreamEvent(inspection, {
    type: 'viewport-closed',
    target,
  })
  expect(inspection.liveViewports.size).toBe(0)
})

test('shows managed application output while a step is still running', () => {
  let inspection = startLiveInspection({
    specificationUri,
    runId: 'run-live-output',
  })
  for (const event of [runStarted(), scenarioStarted(), stepStarted()]) {
    inspection = receiveLiveStreamEvent(inspection, event)
  }
  inspection = receiveLiveStreamEvent(inspection, {
    type: 'diagnostic-recorded',
    profileId: 'chrome',
    scope: scope(1),
    diagnostic: {
      occurredAt: '2026-08-23T12:00:00.0035Z',
      level: 'info',
      origin: 'application',
      stream: 'stdout',
      message: 'server is still working',
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      stepIndex: 0,
      stepText: 'Then payment is captured',
      executionTargetProfileId: 'chrome',
    },
  })

  const inspected = findInspectedResult(
    requiredValue(inspection.snapshot),
    requiredValue(inspection.location),
  )
  expect(
    diagnosticsFor(requiredValue(inspected).attempt).map(
      (entry) => entry.message,
    ),
  ).toEqual(['server is still working'])
  expect(inspected?.attempt.steps[0]?.finishedAt).toBe(
    '2026-08-23T12:00:00.0035Z',
  )
})

test('follows the newest causal activity until the user intervenes', () => {
  let inspection = startLiveInspection({
    specificationUri,
    runId: 'run-79',
  })
  inspection = receiveLiveStreamEvent(inspection, runStarted())
  inspection = receiveLiveStreamEvent(inspection, scenarioStarted())
  inspection = receiveLiveStreamEvent(inspection, stepStarted())
  expect(inspection.followedEntryId?.endsWith(':step-0')).toBe(true)

  inspection = receiveLiveStreamEvent(inspection, stepFinished())
  expect(inspection.followedEntryId?.endsWith(':step-0')).toBe(true)
  expect(inspection.following).toBe(true)

  inspection = pauseLiveFollowing(inspection)
  const pausedEntry = inspection.followedEntryId
  inspection = receiveLiveStreamEvent(inspection, scenarioFinished())
  expect(inspection.following).toBe(false)
  expect(inspection.followedEntryId).toBe(pausedEntry)
})

test('follows the evidence closest to a shared causal timestamp', () => {
  let inspection = startLiveInspection({
    specificationUri,
    runId: 'run-79',
  })
  for (const event of [runStarted(), scenarioStarted(), stepStarted()]) {
    inspection = receiveLiveStreamEvent(inspection, event)
  }
  const finished = stepFinished()
  if (finished.type !== 'step-finished') {
    throw new Error('Expected a step-finished event')
  }
  const causalAt = '2026-08-23T12:00:00.004Z'
  inspection = receiveLiveStreamEvent(inspection, {
    ...finished,
    result: {
      ...finished.result,
      trace: [
        {
          occurredAt: '2026-08-23T12:00:00.003Z',
          causalAt,
          kind: 'browser-activity',
          description: 'Browser navigation failed',
        },
      ],
      diagnostics: [
        {
          occurredAt: causalAt,
          causalAt,
          level: 'error',
          origin: 'network',
          message: 'Payment request failed',
        },
      ],
    },
  })

  expect(inspection.followedEntryId?.endsWith(':diagnostic-step-0-0')).toBe(
    true,
  )
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

  inspection = resumeLiveFollowing(inspection)
  expect(inspection.following).toBe(true)
  expect(inspection.followedEntryId?.endsWith(':step-0')).toBe(true)
  expect(inspection.followedEntryId?.includes(':event-')).toBe(false)
})

test('keeps a pinned investigation when a later failure arrives', () => {
  let inspection = startLiveInspection({
    specificationUri,
    runId: 'run-79',
  })
  inspection = receiveLiveStreamEvent(inspection, runStarted())
  inspection = receiveLiveStreamEvent(inspection, passingStarted(2))
  inspection = pinLiveInvestigation(
    inspection,
    requiredValue(inspection.location),
  )
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

test('opens a persisted Run at the attempt that needs attention', () => {
  let inspection = startLiveInspection({
    specificationUri,
    runId: 'run-79',
  })
  inspection = receiveLiveStreamEvent(inspection, runStarted())
  inspection = receiveLiveStreamEvent(inspection, passingStarted(2))
  inspection = receiveLiveStreamEvent(inspection, scenarioStarted(3))
  inspection = receiveLiveStreamEvent(inspection, scenarioFinished(5))

  expect(
    defaultRunAttemptLocation(requiredValue(inspection.snapshot)),
  ).toMatchObject({
    runId: 'run-79',
    scenarioId: scenario.id,
    attempt: 1,
    tab: 'timeline',
  })
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
    requiredValue(inspection.snapshot),
    requiredValue(inspection.location),
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
    findInspectedResult(
      requiredValue(inspection.snapshot),
      requiredValue(inspection.location),
    )?.result.scenario.name,
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
    requiredValue(inspection.snapshot),
    requiredValue(inspection.location),
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
    findInspectedResult(
      requiredValue(inspection.snapshot),
      requiredValue(inspection.location),
    )?.attempt.evidenceAvailability,
  ).toEqual([
    { kind: 'screenshot', state: 'available' },
    { kind: 'trace', state: 'available' },
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
  const live = findInspectedResult(
    requiredValue(inspection.snapshot),
    requiredValue(inspection.location),
  )
  const liveTimeline = timelineFor(
    requiredValue(inspection.snapshot).events,
    requiredValue(live).attempt,
    requiredValue(inspection.location),
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
    requiredValue(inspection.snapshot),
    requiredValue(inspection.location),
  )
  expect(hydrated?.attempt).toEqual(live?.attempt)
  expect(
    timelineFor(
      requiredValue(inspection.snapshot).events,
      requiredValue(hydrated).attempt,
      requiredValue(inspection.location),
    ),
  ).toEqual(liveTimeline)
  expect(inspection.phase).toBe('finished')
})
