import type { TestRunSummary } from '@pickle-spec/runner'
import { expect, test } from 'vitest'
import type { StudioRunsIndex } from '../../../src/features/history/history.contracts'
import {
  allSpecificationsReportHref,
  specificationReportHref,
  specificationRunReport,
} from '../../../src/features/specifications/specification-run-report'

const finishedRun: TestRunSummary = {
  id: 'run/with spaces',
  startedAt: '2026-08-31T12:00:00.000Z',
  finishedAt: '2026-08-31T12:00:01.000Z',
  executionTargetProfileIds: ['chrome'],
  specificationUris: ['features/checkout.feature'],
  state: 'passed',
  resultCount: 1,
}

function runsIndex(
  runs: readonly TestRunSummary[],
  activeRunIds: readonly string[] = [],
): StudioRunsIndex {
  return {
    activeRunIds,
    retention: {},
    runs,
    storage: {
      pinnedRunIds: [],
      totalBytes: 0,
      warning: false,
      warningThresholdBytes: 0,
    },
  }
}

test('builds an encoded HTML report URL for a completed indexed run', () => {
  const report = specificationRunReport({
    projectSpecificationUris: ['features/checkout.feature'],
    runId: finishedRun.id,
    runsIndex: runsIndex([finishedRun]),
  })

  expect(report?.href).toBe('/api/history/run%2Fwith%20spaces/html')
})

test('exposes the selected Specification action only for a matching run', () => {
  const report = specificationRunReport({
    projectSpecificationUris: [
      'features/checkout.feature',
      'features/search.feature',
    ],
    runId: finishedRun.id,
    runsIndex: runsIndex([finishedRun]),
  })

  expect(specificationReportHref(report, 'features/checkout.feature')).toBe(
    report?.href,
  )
  expect(specificationReportHref(report, 'features/search.feature')).toBe(
    undefined,
  )
  expect(allSpecificationsReportHref(report)).toBe(undefined)
})

test('does not expose a stale, active, or unindexed run report', () => {
  const input = {
    projectSpecificationUris: ['features/checkout.feature'],
    runId: finishedRun.id,
  }

  expect(specificationRunReport(input)).toBe(undefined)
  expect(specificationRunReport({ ...input, runsIndex: runsIndex([]) })).toBe(
    undefined,
  )
  expect(
    specificationRunReport({
      ...input,
      runsIndex: runsIndex([finishedRun], [finishedRun.id]),
    }),
  ).toBe(undefined)
})

test('exposes the all-Specifications action only for an exact current scope', () => {
  const allRun = {
    ...finishedRun,
    specificationUris: ['features/search.feature', 'features/checkout.feature'],
  }
  const report = specificationRunReport({
    projectSpecificationUris: [
      'features/checkout.feature',
      'features/search.feature',
    ],
    runId: allRun.id,
    runsIndex: runsIndex([allRun]),
  })

  expect(allSpecificationsReportHref(report)).toBe(report?.href)

  const staleScope = specificationRunReport({
    projectSpecificationUris: ['features/checkout.feature'],
    runId: allRun.id,
    runsIndex: runsIndex([allRun]),
  })
  expect(allSpecificationsReportHref(staleScope)).toBe(undefined)
})
