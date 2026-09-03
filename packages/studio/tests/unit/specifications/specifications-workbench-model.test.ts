import type { ScenarioAttempt, TestResult } from '@pickle-spec/runner'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, test } from 'vitest'
import { liveViewportTargetKey } from '../../../src/features/runs/live-viewport'
import type { LiveResultInspection } from '../../../src/features/runs/result/live-result-inspection'
import { SpecificationsWorkbench } from '../../../src/features/specifications/specifications-workbench'
import { specificationsWorkbenchModel } from '../../../src/features/specifications/specifications-workbench-model'

const noEvidence: ScenarioAttempt['evidenceAvailability'] = [
  { kind: 'screenshot', state: 'not-requested' },
  { kind: 'trace', state: 'not-requested' },
  { kind: 'recording', state: 'not-requested' },
  { kind: 'device-log', state: 'not-requested' },
  { kind: 'diagnostics', state: 'not-requested' },
]

function attempt(
  state: ScenarioAttempt['state'],
  evidenceAvailability = noEvidence,
): ScenarioAttempt {
  return {
    attempt: 1,
    startedAt: '2026-09-02T12:00:00.000Z',
    finishedAt: '2026-09-02T12:00:01.000Z',
    durationMs: 1_000,
    state,
    steps: [],
    evidenceAvailability,
  }
}

function result(input: {
  attempt: ScenarioAttempt
  examplesRowId?: string
  profileId: string
  scenarioId: string
  scenarioName: string
  specificationName: string
  specificationUri: string
}): TestResult {
  return {
    schemaVersion: 2,
    specification: {
      name: input.specificationName,
      uri: input.specificationUri,
    },
    scenario: {
      id: input.scenarioId,
      name: input.scenarioName,
      examplesRowId: input.examplesRowId,
    },
    executionTargetProfile: { id: input.profileId, adapter: 'web' },
    state: input.attempt.state,
    startedAt: input.attempt.startedAt,
    finishedAt: input.attempt.finishedAt,
    durationMs: input.attempt.durationMs,
    attempts: [input.attempt],
  }
}

function workbenchInspection(): LiveResultInspection {
  const runningEvidence: ScenarioAttempt['evidenceAvailability'] = [
    {
      kind: 'screenshot',
      state: 'missing',
      message: 'This Scenario attempt is still running.',
    },
  ]
  const schedule = [
    {
      specification: { name: 'Checkout', uri: 'features/checkout.feature' },
      scenario: { id: 'pay', name: 'Pay', examplesRowId: 'row-a' },
      executionTargetProfile: { id: 'chrome', adapter: 'web' },
    },
    {
      specification: { name: 'Search', uri: 'features/search.feature' },
      scenario: { id: 'query', name: 'Query' },
      executionTargetProfile: { id: 'firefox', adapter: 'web' },
    },
    {
      specification: { name: 'Checkout', uri: 'features/checkout.feature' },
      scenario: { id: 'pay', name: 'Pay', examplesRowId: 'row-b' },
      executionTargetProfile: { id: 'chrome', adapter: 'web' },
    },
    {
      specification: { name: 'Checkout', uri: 'features/checkout.feature' },
      scenario: { id: 'pay', name: 'Pay', examplesRowId: 'row-a' },
      executionTargetProfile: { id: 'firefox', adapter: 'web' },
    },
  ]
  const results = [
    result({
      specificationName: 'Checkout',
      specificationUri: 'features/checkout.feature',
      scenarioId: 'pay',
      scenarioName: 'Pay',
      examplesRowId: 'row-a',
      profileId: 'chrome',
      attempt: {
        ...attempt('passed', runningEvidence),
        steps: [
          {
            index: 0,
            startedAt: '2026-09-02T12:00:00.000Z',
            finishedAt: '2026-09-02T12:00:01.000Z',
            durationMs: 1_000,
            state: 'passed',
            step: {
              keyword: 'When ',
              text: 'the customer signs in',
              type: 'action',
              source: {
                line: 12,
                column: 5,
                excerpt: 'When the customer signs in',
              },
            },
            resolvedActions: [],
          },
        ],
      },
    }),
    result({
      specificationName: 'Search',
      specificationUri: 'features/search.feature',
      scenarioId: 'query',
      scenarioName: 'Query',
      profileId: 'firefox',
      attempt: attempt('failed'),
    }),
  ]
  return {
    specificationUri: 'features/checkout.feature',
    runId: 'run-all',
    phase: 'running',
    events: [],
    schedule,
    liveDiagnostics: [],
    liveViewports: new Map([
      [
        liveViewportTargetKey({
          scenarioId: 'pay',
          examplesRowId: 'row-a',
          profileId: 'chrome',
        }),
        {
          kind: 'frame' as const,
          data: 'jpeg-frame',
          mimeType: 'image/jpeg' as const,
          width: 1_280,
          height: 800,
        },
      ],
    ]),
    snapshot: {
      id: 'run-all',
      events: [],
      schedule,
      manifest: {
        schemaVersion: 2,
        id: 'run-all',
        startedAt: '2026-09-02T12:00:00.000Z',
        state: 'failed',
        results,
      },
    },
    connection: { kind: 'connected' },
    following: true,
    pinned: false,
    location: {
      specificationUri: 'features/checkout.feature',
      runId: 'run-all',
      scenarioId: 'pay',
      examplesRowId: 'row-a',
      profileId: 'chrome',
      attempt: 1,
    },
  }
}

describe('Specifications workbench model', () => {
  test('keeps idle browsing separate but opens every live run in the workbench', () => {
    const live = workbenchInspection()
    const specifications = [
      {
        id: 'checkout',
        name: 'Checkout',
        uri: 'features/checkout.feature',
        scenarios: [],
      },
    ]

    expect(specificationsWorkbenchModel({ specifications }).kind).toBe('browse')
    expect(
      specificationsWorkbenchModel({
        specifications,
        live: {
          ...live,
          schedule: live.schedule.filter(
            (target) =>
              target.specification.uri === 'features/checkout.feature',
          ),
        },
      }).kind,
    ).toBe('batch')
  })

  test('projects a multi-Specification batch in stable schedule order', () => {
    const model = specificationsWorkbenchModel({
      specifications: [],
      live: workbenchInspection(),
    })

    expect(model.kind).toBe('batch')
    if (model.kind !== 'batch') return
    expect(model.running.map((target) => target.scheduleIndex)).toEqual([0])
    expect(model.completed.map((target) => target.scheduleIndex)).toEqual([1])
    expect(model.queued.map((target) => target.scheduleIndex)).toEqual([2, 3])
    expect(model.running[0]).toMatchObject({
      kind: 'running',
      durationMs: 1_000,
      identity: {
        specificationUri: 'features/checkout.feature',
        scenarioId: 'pay',
        examplesRowId: 'row-a',
        profileId: 'chrome',
      },
      location: {
        runId: 'run-all',
        scenarioId: 'pay',
        examplesRowId: 'row-a',
        profileId: 'chrome',
      },
    })
    expect(model.completed[0]).toMatchObject({
      kind: 'completed',
      state: 'failed',
    })
    expect(model.queued[0]).not.toHaveProperty('location')
    expect(
      new Set(
        [...model.running, ...model.completed, ...model.queued].map(
          (target) => target.key,
        ),
      ).size,
    ).toBe(4)
    expect(model.environmentLabel).toBe('web')
    expect(model.focus?.displayState).toBe('running')
    expect(model.focus?.currentStep).toMatchObject({
      index: 0,
      sourceLine: 12,
      state: 'running',
      text: 'When the customer signs in',
    })
    expect(model.totals).toEqual({
      scheduled: 4,
      queued: 2,
      running: 1,
      passed: 0,
      failed: 1,
      skipped: 0,
      cancelled: 0,
      infrastructureError: 0,
    })
  })

  test('renders idle browsing inside the same Specifications workbench', () => {
    const model = specificationsWorkbenchModel({
      specifications: [
        {
          id: 'checkout',
          name: 'Checkout',
          uri: 'features/checkout.feature',
          scenarios: [{ id: 'pay', name: 'Pay' }],
        },
      ],
    })
    const markup = renderToStaticMarkup(
      createElement(SpecificationsWorkbench, {
        alertMessage: 'Specification missing was not found in this project.',
        canRunAll: true,
        model,
        onCancel: () => undefined,
        onDismissFinishedRun: () => undefined,
        onInspectLocation: () => undefined,
        onPauseFollowing: () => undefined,
        onEditSpecification: () => undefined,
        onResumeFollowing: () => undefined,
        onRun: () => undefined,
        onSelectInspectorTab: () => undefined,
        onSelectScenario: () => undefined,
        onSelectSpecification: () => undefined,
        running: false,
        selectedScenario: { id: 'pay', name: 'Pay' },
        selectedSpecificationId: 'checkout',
        selectedSpecification: model.specifications[0],
      }),
    )

    expect(markup).toContain('Run all Specifications')
    expect(markup).toContain('Specification missing was not found')
    expect(markup).toContain('Queue')
    expect(markup).toContain('Specifications')
    expect(markup).toContain('Checkout')
    expect(markup).toContain('Browser preview')
    expect(markup).toContain('Scenario ready to run')
    expect(markup).toContain('Run Scenario')
    expect(markup).toContain('data-slot="button-group"')
    expect(markup).toContain('aria-label="Workbench panels"')
    expect(markup).toContain('Hide Left sidebar')
    expect(markup).toContain('Hide Bottom panel')
    expect(markup).toContain('Hide Right sidebar')
  })

  test('renders the reference workbench regions without unsupported controls', () => {
    const model = specificationsWorkbenchModel({
      specifications: [
        {
          id: 'checkout',
          name: 'Checkout',
          uri: 'features/checkout.feature',
          scenarios: [{ id: 'pay', name: 'Pay' }],
        },
      ],
      live: workbenchInspection(),
    })
    const markup = renderToStaticMarkup(
      createElement(SpecificationsWorkbench, {
        canRunAll: true,
        model,
        onCancel: () => undefined,
        onDismissFinishedRun: () => undefined,
        onInspectLocation: () => undefined,
        onPauseFollowing: () => undefined,
        onEditSpecification: () => undefined,
        onResumeFollowing: () => undefined,
        onRun: () => undefined,
        onSelectInspectorTab: () => undefined,
        onSelectScenario: () => undefined,
        onSelectSpecification: () => undefined,
        running: true,
      }),
    )

    expect(markup).toContain('Run all 4')
    expect(markup).toContain('Now running (1)')
    expect(markup).toContain('Up next (2)')
    expect(markup).toContain('Browser preview')
    expect(markup).toContain('Live browser viewport for Pay')
    expect(markup).toContain('1280×800')
    expect(markup).toContain('Timeline')
    expect(markup).toContain('Artifacts 0')
    expect(markup).toContain('Current step')
    expect(markup).toContain('When the customer signs in')
    expect(markup).toContain('features/checkout.feature:12')
    expect(markup).toMatch(/Total.*Queued.*Passed.*Failed/s)
    expect(markup).toContain('Cancel run')
    const removedContent = />Running<\/dt>|<footer|Run selected|Concurrency/
    expect(markup).not.toMatch(removedContent)
  })
})
