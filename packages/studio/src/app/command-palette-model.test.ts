import type { TestRunSummary } from '@pickle-spec/runner'
import { expect, test } from 'vitest'
import type { StudioProject, StudioRunsIndex } from '../server/server'
import {
  buildCommandPaletteItems,
  commandActionAvailability,
  limitCommandPaletteItems,
  targetNewRun,
} from './command-palette-model'

const project: StudioProject = {
  name: 'shop',
  root: '/shop',
  profiles: ['chrome', 'mobile'],
  suites: ['smoke'],
  specifications: [
    {
      id: 'spec-checkout',
      name: 'Checkout',
      uri: 'features/checkout.feature',
      scenarios: [
        { id: 'scenario-pay', name: 'Pay for the order' },
        { id: 'scenario-review', name: 'Review the purchase' },
      ],
    },
    {
      id: 'spec-subscription',
      name: 'Subscription',
      uri: 'features/subscription.feature',
      scenarios: [{ id: 'scenario-renew', name: 'Pay for the order' }],
    },
  ],
}

function run(overrides: Partial<TestRunSummary>): TestRunSummary {
  return {
    id: 'run-1',
    startedAt: '2026-08-25T10:00:00.000Z',
    state: 'passed',
    executionTargetProfileIds: ['chrome'],
    specificationUris: ['features/checkout.feature'],
    resultCount: 2,
    ...overrides,
  }
}

function index(
  runs: readonly TestRunSummary[],
  activeRunIds: readonly string[] = [],
): StudioRunsIndex {
  return {
    runs,
    activeRunIds,
    retention: {},
    storage: {
      totalBytes: 0,
      warningThresholdBytes: 1,
      warning: false,
      pinnedRunIds: [],
    },
  }
}

test('indexes Specifications and disambiguates duplicate Scenario names', () => {
  const items = buildCommandPaletteItems({ project, query: '' })

  expect(items.specifications.map((item) => item.specification.name)).toEqual([
    'Checkout',
    'Subscription',
  ])
  expect(
    items.scenarios
      .filter((item) => item.scenario.name === 'Pay for the order')
      .map((item) => item.specification.name),
  ).toEqual(['Checkout', 'Subscription'])
})

test('matches every query token across entity metadata', () => {
  const items = buildCommandPaletteItems({
    project,
    index: index([
      run({
        id: 'run-mobile-smoke',
        suite: 'smoke',
        state: 'failed',
        executionTargetProfileIds: ['mobile'],
      }),
    ]),
    query: 'failed mobile checkout',
  })

  expect(items.runs.map((item) => item.id)).toEqual(['run-mobile-smoke'])
  expect(items.specifications).toEqual([])
  expect(items.scenarios).toEqual([])
})

test('limits idle collections to 20 and searched collections to 50', () => {
  const manyRuns = Array.from({ length: 80 }, (_, itemIndex) =>
    run({ id: `matching-run-${itemIndex.toString().padStart(2, '0')}` }),
  )

  expect(
    buildCommandPaletteItems({ project, index: index(manyRuns), query: '' })
      .runs,
  ).toHaveLength(20)
  expect(
    buildCommandPaletteItems({
      project,
      index: index(manyRuns),
      query: 'matching',
    }).runs,
  ).toHaveLength(50)
  expect(
    buildCommandPaletteItems({
      project,
      index: index(manyRuns),
      query: 'matching-run-79',
    }).runs.map((item) => item.id),
  ).toEqual(['matching-run-79'])
  expect(limitCommandPaletteItems(manyRuns, '')).toHaveLength(20)
  expect(limitCommandPaletteItems(manyRuns, '   ')).toHaveLength(20)
  expect(limitCommandPaletteItems(manyRuns, 'run')).toHaveLength(50)
})

test('makes contextual actions available only for runnable idle scopes', () => {
  expect(
    commandActionAvailability({
      hasScenario: true,
      hasSpecification: true,
      hasSpecifications: true,
      projectCanRun: true,
      running: false,
      scenarioCanRun: true,
      specificationCanRun: true,
    }),
  ).toEqual({
    runAll: true,
    runScenario: true,
    runSpecification: true,
    refreshSpecification: true,
  })
  expect(
    commandActionAvailability({
      hasScenario: true,
      hasSpecification: true,
      hasSpecifications: true,
      projectCanRun: true,
      running: true,
      scenarioCanRun: true,
      specificationCanRun: true,
    }),
  ).toEqual({
    runAll: false,
    runScenario: false,
    runSpecification: false,
    refreshSpecification: false,
  })
})

test('puts active runs first and deduplicates persisted summaries', () => {
  const items = buildCommandPaletteItems({
    project,
    index: index(
      [run({ id: 'run-active' }), run({ id: 'run-finished' })],
      ['run-active', 'run-external'],
    ),
    query: '',
  })

  expect(items.runs.map((item) => [item.id, item.active])).toEqual([
    ['run-active', true],
    ['run-external', true],
    ['run-finished', false],
  ])
})

test('targets new runs at one profile or all configured profiles', () => {
  expect(
    targetNewRun({ paths: ['features/checkout.feature'] }, 'mobile'),
  ).toEqual({
    paths: ['features/checkout.feature'],
    profiles: ['mobile'],
  })
  expect(
    targetNewRun({ paths: ['features/checkout.feature'] }, undefined),
  ).toEqual({
    paths: ['features/checkout.feature'],
    profiles: undefined,
  })
})
