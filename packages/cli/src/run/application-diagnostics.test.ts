import { expect, test } from 'bun:test'
import type { RunEvent } from '@pickle-spec/runner'
import { createApplicationDiagnosticBuffer } from './application-diagnostics'

const scenario = { id: 'checkout', name: 'Checkout succeeds' }
const executionTargetProfile = { id: 'desktop', adapter: 'web' }
const scope = {
  scenarioId: 'checkout',
  executionTargetProfileId: 'desktop',
  attempt: 1,
}

type RunEventData<Event extends RunEvent> = Event extends RunEvent
  ? Omit<Event, 'schemaVersion' | 'sequence' | 'occurredAt'>
  : never

function event(input: RunEventData<RunEvent>) {
  return {
    schemaVersion: 2,
    sequence: 1,
    occurredAt: '2026-08-23T12:00:00.000Z',
    ...input,
  } as RunEvent
}

test('correlates managed output to an active step without changing its state', () => {
  const diagnostics = createApplicationDiagnosticBuffer({
    profiles: { stdout: ['desktop'], stderr: [] },
    availability: { stdout: 'available', stderr: 'not-requested' },
  })
  diagnostics.project(
    event({
      type: 'scenario-started',
      scenario,
      executionTargetProfile,
      scope,
    }),
  )
  diagnostics.project(
    event({
      type: 'step-started',
      scenario,
      executionTargetProfile,
      scope: { ...scope, stepIndex: 0 },
      step: { keyword: 'When', text: 'I pay', type: 'action' },
    }),
  )
  diagnostics.record({
    occurredAt: '2026-08-23T12:00:00.100Z',
    stream: 'stdout',
    line: 'payment accepted',
  })

  const projected = diagnostics.project(
    event({
      type: 'step-finished',
      scenario,
      executionTargetProfile,
      scope: { ...scope, stepIndex: 0 },
      result: {
        index: 0,
        startedAt: '2026-08-23T12:00:00.000Z',
        finishedAt: '2026-08-23T12:00:00.200Z',
        durationMs: 200,
        step: { keyword: 'When', text: 'I pay', type: 'action' },
        state: 'passed',
        resolvedActions: [],
      },
    }),
  )

  expect(projected.type).toBe('step-finished')
  if (projected.type !== 'step-finished') throw new Error('unexpected event')
  expect(projected.result.state).toBe('passed')
  expect(projected.result.diagnostics).toEqual([
    {
      occurredAt: '2026-08-23T12:00:00.100Z',
      level: 'info',
      origin: 'application',
      stream: 'stdout',
      message: 'payment accepted',
      scenarioId: 'checkout',
      scenarioName: 'Checkout succeeds',
      stepIndex: 0,
      stepText: 'When I pay',
      executionTargetProfileId: 'desktop',
    },
  ])

  const finished = diagnostics.project(
    event({
      type: 'scenario-finished',
      specification: { name: 'Checkout', uri: 'checkout.feature' },
      scenario,
      executionTargetProfile,
      scope,
      attempt: {
        attempt: 1,
        startedAt: '2026-08-23T12:00:00.000Z',
        finishedAt: '2026-08-23T12:00:01.000Z',
        durationMs: 1_000,
        state: 'failed',
        steps: [{ ...projected.result, diagnostics: undefined }],
        evidenceAvailability: [
          { kind: 'screenshot', state: 'not-requested' },
          { kind: 'trace', state: 'not-requested' },
          { kind: 'recording', state: 'not-supported' },
          { kind: 'device-log', state: 'not-supported' },
          { kind: 'diagnostics', state: 'not-requested' },
        ],
      },
    }),
  )

  if (finished.type !== 'scenario-finished') throw new Error('unexpected event')
  expect(finished.attempt.steps[0]?.diagnostics).toEqual(
    projected.result.diagnostics,
  )
  expect(
    finished.attempt.evidenceAvailability.find(
      (item) => item.kind === 'diagnostics',
    ),
  ).toEqual({ kind: 'diagnostics', state: 'available' })
})

test('attaches startup output to the first matching Scenario attempt', () => {
  const diagnostics = createApplicationDiagnosticBuffer({
    profiles: { stdout: [], stderr: ['desktop'] },
    availability: { stdout: 'not-requested', stderr: 'available' },
  })
  diagnostics.record({
    occurredAt: '2026-08-23T11:59:59.000Z',
    stream: 'stderr',
    line: 'warming database pool',
  })
  diagnostics.project(
    event({
      type: 'scenario-started',
      scenario,
      executionTargetProfile,
      scope,
    }),
  )

  const projected = diagnostics.project(
    event({
      type: 'scenario-finished',
      specification: { name: 'Checkout', uri: 'checkout.feature' },
      scenario,
      executionTargetProfile,
      scope,
      attempt: {
        attempt: 1,
        startedAt: '2026-08-23T12:00:00.000Z',
        finishedAt: '2026-08-23T12:00:01.000Z',
        durationMs: 1_000,
        state: 'passed',
        steps: [],
        evidenceAvailability: [
          { kind: 'screenshot', state: 'not-requested' },
          { kind: 'trace', state: 'not-requested' },
          { kind: 'recording', state: 'not-supported' },
          { kind: 'device-log', state: 'not-supported' },
          { kind: 'diagnostics', state: 'not-requested' },
        ],
      },
    }),
  )

  if (projected.type !== 'scenario-finished')
    throw new Error('unexpected event')
  expect(projected.attempt.diagnostics?.[0]).toMatchObject({
    origin: 'application',
    stream: 'stderr',
    executionTargetProfileId: 'desktop',
  })
  expect(projected.attempt.diagnostics?.[0]?.scenarioId).toBeUndefined()
  expect(
    projected.attempt.evidenceAvailability.find(
      (item) => item.kind === 'diagnostics',
    ),
  ).toEqual({ kind: 'diagnostics', state: 'available' })
  expect(projected.attempt.applicationOutputAvailability).toEqual([
    { stream: 'stdout', state: 'not-requested' },
    { stream: 'stderr', state: 'available' },
  ])
})

test('does not duplicate shared process output across concurrent Scenarios', () => {
  const live: unknown[] = []
  const diagnostics = createApplicationDiagnosticBuffer({
    profiles: { stdout: ['desktop'], stderr: [] },
    availability: { stdout: 'available', stderr: 'not-requested' },
    onDiagnostic: (entry) => live.push(entry),
  })
  const otherScenario = { id: 'refund', name: 'Refund succeeds' }
  const otherScope = { ...scope, scenarioId: 'refund' }
  diagnostics.project(
    event({
      type: 'scenario-started',
      scenario,
      executionTargetProfile,
      scope,
    }),
  )
  diagnostics.project(
    event({
      type: 'scenario-started',
      scenario: otherScenario,
      executionTargetProfile,
      scope: otherScope,
    }),
  )
  diagnostics.record({
    occurredAt: '2026-08-23T12:00:00.100Z',
    stream: 'stdout',
    line: 'shared server line',
  })

  const first = diagnostics.project(
    event({
      type: 'scenario-finished',
      specification: { name: 'Checkout', uri: 'checkout.feature' },
      scenario,
      executionTargetProfile,
      scope,
      attempt: {
        attempt: 1,
        startedAt: '2026-08-23T12:00:00.000Z',
        finishedAt: '2026-08-23T12:00:01.000Z',
        durationMs: 1_000,
        state: 'failed',
        steps: [],
        evidenceAvailability: [
          { kind: 'screenshot', state: 'not-requested' },
          { kind: 'trace', state: 'not-requested' },
          { kind: 'recording', state: 'not-requested' },
          { kind: 'device-log', state: 'not-requested' },
          { kind: 'diagnostics', state: 'not-requested' },
        ],
      },
    }),
  )
  const second = diagnostics.project(
    event({
      type: 'scenario-finished',
      specification: { name: 'Checkout', uri: 'checkout.feature' },
      scenario: otherScenario,
      executionTargetProfile,
      scope: otherScope,
      attempt: {
        attempt: 1,
        startedAt: '2026-08-23T12:00:00.000Z',
        finishedAt: '2026-08-23T12:00:01.000Z',
        durationMs: 1_000,
        state: 'passed',
        steps: [],
        evidenceAvailability: [
          { kind: 'screenshot', state: 'not-requested' },
          { kind: 'trace', state: 'not-requested' },
          { kind: 'recording', state: 'not-requested' },
          { kind: 'device-log', state: 'not-requested' },
          { kind: 'diagnostics', state: 'not-requested' },
        ],
      },
    }),
  )
  if (first.type !== 'scenario-finished' || second.type !== 'scenario-finished')
    throw new Error('unexpected event')

  expect(first.attempt.diagnostics).toEqual([
    expect.objectContaining({ message: 'shared server line' }),
  ])
  expect(first.attempt.diagnostics?.[0]?.scenarioId).toBeUndefined()
  expect(second.attempt.diagnostics).toBeUndefined()
  expect(live).toEqual([expect.objectContaining({ profileId: 'desktop' })])
  expect('scope' in (live[0] as object)).toBe(false)
})

test('reports reused managed output as not-supported when no diagnostics exist', () => {
  const diagnostics = createApplicationDiagnosticBuffer({
    profiles: { stdout: ['desktop'], stderr: [] },
    availability: { stdout: 'not-supported', stderr: 'not-requested' },
  })
  diagnostics.project(
    event({
      type: 'scenario-started',
      scenario,
      executionTargetProfile,
      scope,
    }),
  )
  const projected = diagnostics.project(
    event({
      type: 'scenario-finished',
      specification: { name: 'Checkout', uri: 'checkout.feature' },
      scenario,
      executionTargetProfile,
      scope,
      attempt: {
        attempt: 1,
        startedAt: '2026-08-23T12:00:00.000Z',
        finishedAt: '2026-08-23T12:00:01.000Z',
        durationMs: 1_000,
        state: 'passed',
        steps: [],
        evidenceAvailability: [
          { kind: 'screenshot', state: 'not-requested' },
          { kind: 'trace', state: 'not-requested' },
          { kind: 'recording', state: 'not-supported' },
          { kind: 'device-log', state: 'not-supported' },
          { kind: 'diagnostics', state: 'not-requested' },
        ],
      },
    }),
  )

  if (projected.type !== 'scenario-finished')
    throw new Error('unexpected event')
  expect(
    projected.attempt.evidenceAvailability.find(
      (item) => item.kind === 'diagnostics',
    ),
  ).toEqual({
    kind: 'diagnostics',
    state: 'not-supported',
    message: 'Managed application stdout is unavailable for a reused server.',
  })
})
