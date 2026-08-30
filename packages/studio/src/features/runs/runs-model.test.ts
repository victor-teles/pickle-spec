import type { TestRunSummary } from '@pickle-spec/runner'
import { expect, test } from 'vitest'
import {
  receiveLiveStreamEvent,
  startLiveInspection,
} from './result/live-result-inspection'
import {
  activeRunListItem,
  filterRuns,
  type RunListItem,
  runProgress,
} from './runs-model'

const checkoutRun: TestRunSummary = {
  id: 'run-checkout',
  startedAt: '2026-08-24T12:00:00.000Z',
  finishedAt: '2026-08-24T12:00:01.000Z',
  suite: 'smoke',
  executionTargetProfileIds: ['chrome'],
  specificationUris: ['features/checkout.feature'],
  state: 'failed',
  resultCount: 1,
}

const searchRun: TestRunSummary = {
  ...checkoutRun,
  id: 'run-search',
  suite: 'regression',
  executionTargetProfileIds: ['firefox'],
  specificationUris: ['features/search.feature'],
  state: 'passed',
}

const checkoutItem: RunListItem = { summary: checkoutRun, state: 'running' }
const searchItem: RunListItem = { summary: searchRun, state: 'passed' }
const items: RunListItem[] = [checkoutItem, searchItem]

test('filters indexed runs by operational metadata and live state', () => {
  const names = new Map([
    ['features/checkout.feature', 'Checkout'],
    ['features/search.feature', 'Catalog search'],
  ])

  expect(filterRuns(items, { state: 'running' }, names)).toEqual([checkoutItem])
  expect(
    filterRuns(items, { specification: 'features/search.feature' }, names),
  ).toEqual([searchItem])
  expect(filterRuns(items, { profile: 'firefox' }, names)).toEqual([searchItem])
  expect(filterRuns(items, { suite: 'smoke' }, names)).toEqual([checkoutItem])
  expect(filterRuns(items, { q: 'catalog' }, names)).toEqual([searchItem])
})

test('derives scheduled, running, completed, and failed live progress', () => {
  let inspection = startLiveInspection({
    runId: 'run-live',
    specificationUri: '',
  })
  inspection = receiveLiveStreamEvent(inspection, {
    type: 'run-scheduled',
    schedule: [
      {
        specification: { name: 'Checkout', uri: 'features/checkout.feature' },
        scenario: { id: 'scenario-pay', name: 'Pay' },
        executionTargetProfile: { id: 'chrome' },
      },
      {
        specification: { name: 'Search', uri: 'features/search.feature' },
        scenario: { id: 'scenario-search', name: 'Search' },
        executionTargetProfile: { id: 'chrome' },
      },
    ],
  })
  inspection = receiveLiveStreamEvent(inspection, {
    schemaVersion: 2,
    sequence: 1,
    occurredAt: '2026-08-24T12:00:00.000Z',
    type: 'scenario-started',
    scenario: { id: 'scenario-pay', name: 'Pay' },
    executionTargetProfile: { id: 'chrome' },
    scope: {
      scenarioId: 'scenario-pay',
      executionTargetProfileId: 'chrome',
      attempt: 1,
    },
  })

  expect(runProgress(inspection)).toEqual({
    scheduled: 2,
    completed: 0,
    running: 1,
    failed: 0,
  })
  expect(inspection.snapshot?.manifest?.results[0]?.specification.uri).toBe(
    'features/checkout.feature',
  )

  const activeItem = activeRunListItem('run-live', inspection, undefined)
  expect(activeItem).toMatchObject({
    state: 'running',
    summary: {
      id: 'run-live',
      executionTargetProfileIds: ['chrome'],
      specificationUris: [
        'features/checkout.feature',
        'features/search.feature',
      ],
    },
  })
  expect(
    filterRuns(
      [activeItem],
      {
        state: 'running',
        specification: 'features/search.feature',
        profile: 'chrome',
      },
      new Map(),
    ),
  ).toEqual([activeItem])
})
