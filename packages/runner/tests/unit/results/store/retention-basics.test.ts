import { truncate } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  openTestRunStore,
  passedResult,
  scenarioFinished,
  storageFor,
  tempRoot,
} from './fixtures'

test('retention removes eligible local data without changing retained test runs', async () => {
  const root = await tempRoot()
  let clock = new Date('2026-07-01T00:00:00.000Z')
  let nextId = 1
  const store = openTestRunStore({
    root,
    createId: () => `run-${nextId++}`,
    now: () => clock,
  })

  const expired = await store.create()
  await expired.append(scenarioFinished(passedResult('Expired purchase')))
  await expired.materialize()

  clock = new Date('2026-08-15T00:00:00.000Z')
  const retained = await store.create()
  await retained.append(scenarioFinished(passedResult('Retained purchase')))
  await retained.materialize()

  const retainedDirectory = join(storageFor(root).runsDirectory, 'run-2')
  const eventsBefore = await Bun.file(
    join(retainedDirectory, 'events.ndjson'),
  ).text()
  const manifestBefore = await Bun.file(
    join(retainedDirectory, 'manifest.json'),
  ).text()

  const result = await store.applyRetention({
    maxAgeMs: 14 * 24 * 60 * 60 * 1000,
  })

  expect(result.removed).toEqual(['run-1'])
  expect(
    await Bun.file(
      join(storageFor(root).runsDirectory, 'run-1', 'events.ndjson'),
    ).exists(),
  ).toBe(false)
  expect(await Bun.file(join(retainedDirectory, 'events.ndjson')).text()).toBe(
    eventsBefore,
  )
  expect(await Bun.file(join(retainedDirectory, 'manifest.json')).text()).toBe(
    manifestBefore,
  )
  expect(await store.list()).toEqual([
    {
      id: 'run-2',
      executionTargetProfileIds: ['deterministic'],
      specificationUris: ['features/checkout.feature'],
      startedAt: '2026-08-15T00:00:00.000Z',
      finishedAt: '2026-08-15T00:00:00.000Z',
      durationMs: 0,
      state: 'passed',
      resultCount: 1,
      executionModes: ['adaptive'],
      cacheOutcomes: ['uncacheable'],
      inferenceCount: 0,
    },
  ])
})

test('retention is disabled when no age or storage limit is configured', async () => {
  const root = await tempRoot()
  let clock = new Date('2026-07-01T00:00:00.000Z')
  const store = openTestRunStore({
    root,
    createId: () => 'run-unconfigured-retention',
    now: () => clock,
  })
  const run = await store.create()
  await run.append(scenarioFinished(passedResult()))
  await run.materialize()
  const eventsPath = join(
    storageFor(root).runsDirectory,
    run.id,
    'events.ndjson',
  )
  const eventsBefore = await Bun.file(eventsPath).text()
  clock = new Date('2026-08-15T00:00:00.000Z')

  const result = await store.applyRetention()

  expect(result.removed).toEqual([])
  expect(await Bun.file(eventsPath).text()).toBe(eventsBefore)
})

test('inspects total Test run storage against the default 5 GB warning threshold', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-storage-inspection',
  })
  const run = await store.create()
  await run.append(scenarioFinished(passedResult()))
  await run.materialize()

  const inspection = await store.inspectStorage()

  expect(inspection.totalBytes).toBeGreaterThan(0)
  expect(inspection.warningThresholdBytes).toBe(5 * 1024 * 1024 * 1024)
  expect(inspection.warning).toBe(false)
  expect(inspection.pinnedRunIds).toEqual([])

  const sparseArtifact = join(
    storageFor(root).runsDirectory,
    run.id,
    'large-recording.bin',
  )
  await Bun.write(sparseArtifact, '')
  await truncate(sparseArtifact, 5 * 1024 * 1024 * 1024)

  expect((await store.inspectStorage()).warning).toBe(true)
})
