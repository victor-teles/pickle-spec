import { expect, test } from 'bun:test'
import type {
  RunEvent,
  ScenarioAttempt,
  TestResult,
  TestResultState,
} from '@pickle-spec/runner'
import {
  artifactLoadFailureGuidance,
  artifactsFor,
  artifactViewerKind,
  defaultResultInspectorTab,
  diagnosticPage,
  diagnosticsFor,
  filterDiagnostics,
  findInspectedResult,
  recoveryGuidance,
  timelineFor,
} from './result-evidence'
import type { StudioRunSnapshot } from './server'
import { parseStudioRoute, studioRouteHref } from './studio-route'

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

test('round-trips durable result identity through a Runs deep link', () => {
  const location = {
    specificationUri: 'features/checkout.feature',
    runId: 'run-78',
    scenarioId: 'scenario-outline',
    examplesRowId: 'row-2',
    profileId: 'chrome',
    attempt: 2,
    tab: 'diagnostics' as const,
  }

  expect(
    parseStudioRoute(studioRouteHref({ kind: 'result', location })),
  ).toEqual({ kind: 'result', location })
})

test('correlates the failed step, resolved action, and Diagnostic entry at the same instant', () => {
  const occurredAt = '2026-08-22T12:00:01.100Z'
  const actionOccurredAt = '2026-08-22T12:00:01.050Z'
  const diagnosticOccurredAt = '2026-08-22T12:00:01.090Z'
  const inspectedAttempt: ScenarioAttempt = {
    ...attempt(1, 'failed'),
    finishedAt: occurredAt,
    durationMs: 1_100,
    steps: [
      {
        index: 0,
        startedAt: '2026-08-22T12:00:01.000Z',
        finishedAt: occurredAt,
        durationMs: 100,
        step: {
          keyword: 'Then ',
          text: 'payment is captured',
          type: 'outcome',
        },
        state: 'failed',
        resolvedActions: [{ description: 'Click pay on chrome' }],
        message: 'Payment was declined',
        diagnostics: [
          {
            occurredAt: diagnosticOccurredAt,
            causalAt: occurredAt,
            level: 'error',
            origin: 'console',
            message: 'Payment was declined',
            scenarioId: 'scenario-pay',
            scenarioName: 'Pay for the order',
            stepIndex: 0,
            stepText: 'Then payment is captured',
            executionTargetProfileId: 'chrome',
          },
        ],
        trace: [
          {
            occurredAt: actionOccurredAt,
            causalAt: occurredAt,
            kind: 'resolved-action',
            description: 'Click pay on chrome',
          },
        ],
        artifacts: [
          {
            kind: 'screenshot',
            path: '/tmp/checkout.png',
            mediaType: 'image/png',
          },
        ],
      },
    ],
  }
  const location = {
    specificationUri: 'features/checkout.feature',
    runId: 'run-78',
    scenarioId: 'scenario-outline',
    examplesRowId: 'row-2',
    profileId: 'chrome',
    attempt: 1,
  }
  const atInstant = timelineFor([], inspectedAttempt, location).filter(
    (entry) => entry.occurredAt === occurredAt,
  )

  expect(atInstant.map((entry) => entry.kind)).toEqual([
    'Step',
    'Trace',
    'Diagnostic entry',
    'Test artifact',
  ])
  expect(atInstant.map((entry) => entry.title)).toEqual([
    'Then payment is captured',
    'Click pay on chrome',
    'Payment was declined',
    'screenshot',
  ])
  expect(
    diagnosticsFor(inspectedAttempt).map((entry) => entry.message),
  ).toEqual(['Payment was declined'])
})

test('keeps Run events as a distinct timeline lane', () => {
  const entries = timelineFor(
    [scenarioStarted('row-2', 2)],
    attempt(1, 'failed'),
    {
      specificationUri: 'features/checkout.feature',
      runId: 'run-78',
      scenarioId: 'scenario-outline',
      examplesRowId: 'row-2',
      profileId: 'chrome',
      attempt: 1,
    },
  )

  expect(entries.map((entry) => entry.kind)).toEqual(['Run event'])
  expect(entries[0]?.title).toBe('Scenario Started')
})

test('filters Diagnostic entries without changing chronological order', () => {
  const diagnostics = diagnosticsFor({
    ...attempt(1, 'failed'),
    diagnostics: [
      {
        occurredAt: '2026-08-22T12:00:01.000Z',
        level: 'info',
        origin: 'adapter',
        message: 'Opened chrome',
        scenarioId: 'scenario-pay',
        stepIndex: 0,
        executionTargetProfileId: 'chrome',
      },
      {
        occurredAt: '2026-08-22T12:00:01.025Z',
        level: 'info',
        origin: 'application',
        stream: 'stdout',
        message: 'Application ready',
        scenarioId: 'scenario-pay',
        stepIndex: 0,
        executionTargetProfileId: 'chrome',
      },
    ],
    steps: [
      {
        index: 0,
        startedAt: '2026-08-22T12:00:01.000Z',
        finishedAt: '2026-08-22T12:00:01.100Z',
        durationMs: 100,
        step: {
          keyword: 'Then ',
          text: 'payment is captured',
          type: 'outcome',
        },
        state: 'failed',
        resolvedActions: [],
        diagnostics: [
          {
            occurredAt: '2026-08-22T12:00:01.050Z',
            level: 'warning',
            origin: 'network',
            message: 'Retrying capture',
            scenarioId: 'scenario-pay',
            stepIndex: 0,
            executionTargetProfileId: 'chrome',
          },
          {
            occurredAt: '2026-08-22T12:00:01.100Z',
            level: 'error',
            origin: 'console',
            message: 'Payment was declined',
            scenarioId: 'scenario-pay',
            stepIndex: 0,
            executionTargetProfileId: 'chrome',
          },
        ],
      },
    ],
  })

  expect(diagnostics.map((entry) => entry.message)).toEqual([
    'Opened chrome',
    'Application ready',
    'Retrying capture',
    'Payment was declined',
  ])
  expect(
    filterDiagnostics(diagnostics, { level: 'error' }).map(
      (entry) => entry.message,
    ),
  ).toEqual(['Payment was declined'])
  expect(
    filterDiagnostics(diagnostics, { origin: 'network' }).map(
      (entry) => entry.message,
    ),
  ).toEqual(['Retrying capture'])
  expect(
    filterDiagnostics(diagnostics, { query: 'stdout' }).map(
      (entry) => entry.message,
    ),
  ).toEqual(['Application ready'])
  expect(
    filterDiagnostics(diagnostics, {
      scenarioId: 'scenario-pay',
      stepIndex: 0,
      executionTargetProfileId: 'chrome',
    }).map((entry) => entry.message),
  ).toEqual([
    'Opened chrome',
    'Application ready',
    'Retrying capture',
    'Payment was declined',
  ])
})

test('searches the complete 10,000-entry Diagnostic set before rendering is bounded', () => {
  const diagnostics = Array.from({ length: 10_000 }, (_, index) => ({
    id: `diagnostic-${index}`,
    occurredAt: new Date(Date.UTC(2026, 7, 22, 12, 0, 0, index)).toISOString(),
    level: 'info' as const,
    origin: 'adapter' as const,
    source: 'Scenario attempt' as const,
    message:
      index === 9_999
        ? 'Deep device failure marker omega-9999'
        : `Routine device entry ${index}`,
    scenarioName: 'Pay for the order',
    executionTargetProfileId: 'android-pixel',
  }))

  expect(
    filterDiagnostics(diagnostics, { query: 'OMEGA-9999' }).map(
      (entry) => entry.id,
    ),
  ).toEqual(['diagnostic-9999'])
  expect(
    filterDiagnostics(diagnostics, { query: 'android-pixel' }),
  ).toHaveLength(10_000)
  const page = diagnosticPage(filterDiagnostics(diagnostics, {}), 99)
  expect(page.entries).toHaveLength(100)
  expect(page.entries.at(-1)?.id).toBe('diagnostic-9999')
  expect(page).toMatchObject({ page: 99, pageCount: 100, first: 9_901 })
})

test('gives distinct recovery actions for unavailable and unreadable evidence', () => {
  const guidance = [
    recoveryGuidance('not-requested'),
    recoveryGuidance('not-supported'),
    recoveryGuidance('not-retained'),
    recoveryGuidance('capture-failed'),
    recoveryGuidance('missing'),
    artifactLoadFailureGuidance('corrupt'),
    artifactLoadFailureGuidance('load-failed'),
  ]

  expect(guidance[0]).toContain('Request')
  expect(guidance[1]).toContain('execution target')
  expect(guidance[2]).toContain('retention policy')
  expect(guidance[3]).toContain('Diagnostics')
  expect(guidance[4]).toContain('re-import')
  expect(guidance[5]).toContain('corrupt')
  expect(guidance[6]).toContain('Retry')
  expect(new Set(guidance)).toHaveLength(guidance.length)
})

test('uses canonical artifact capture time and selects viewers without adapter knowledge', () => {
  const inspectedAttempt: ScenarioAttempt = {
    ...attempt(1),
    steps: [
      {
        index: 0,
        startedAt: '2026-08-22T12:00:00.000Z',
        finishedAt: '2026-08-22T12:00:01.000Z',
        durationMs: 1_000,
        step: { keyword: 'Then', text: 'receipt appears', type: 'outcome' },
        state: 'passed',
        resolvedActions: [],
        artifacts: [
          {
            kind: 'recording',
            path: '/tmp/scenario.mp4',
            mediaType: 'video/mp4',
            capturedAt: '2026-08-22T12:00:00.750Z',
          },
        ],
      },
    ],
  }

  expect(artifactsFor(inspectedAttempt)[0]?.capturedAt).toBe(
    '2026-08-22T12:00:00.750Z',
  )
  expect(
    artifactViewerKind({ kind: 'recording', mediaType: 'video/mp4' }),
  ).toBe('video')
  expect(
    artifactViewerKind({ kind: 'device-log', mediaType: 'text/plain' }),
  ).toBe('text')
  expect(artifactViewerKind({ kind: 'trace' })).toBe('download')
  expect(
    artifactViewerKind({ kind: 'screenshot', mediaType: 'image/png' }),
  ).toBe('image')
})
