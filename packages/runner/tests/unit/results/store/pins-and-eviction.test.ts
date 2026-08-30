import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  openTestRunStore,
  passedResult,
  scenarioFinished,
  storageFor,
  tempRoot,
} from './fixtures'

test('persists explicit Pin state without changing the immutable Test run', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-pinned',
  })
  const run = await store.create()
  await run.append(scenarioFinished(passedResult()))
  await run.materialize()
  const runDirectory = join(storageFor(root).runsDirectory, run.id)
  const eventsBefore = await Bun.file(
    join(runDirectory, 'events.ndjson'),
  ).text()
  const manifestBefore = await Bun.file(
    join(runDirectory, 'manifest.json'),
  ).text()

  await store.pin(run.id)

  const reopened = openTestRunStore({ root })
  expect((await reopened.inspectStorage()).pinnedRunIds).toEqual([run.id])
  expect(await Bun.file(join(runDirectory, 'events.ndjson')).text()).toBe(
    eventsBefore,
  )
  expect(await Bun.file(join(runDirectory, 'manifest.json')).text()).toBe(
    manifestBefore,
  )

  await reopened.unpin(run.id)
  expect(
    (await openTestRunStore({ root }).inspectStorage()).pinnedRunIds,
  ).toEqual([])
})

test('retention removes only complete unpinned Test runs and reports storage totals', async () => {
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
  const pinned = await store.create()
  await pinned.append(scenarioFinished(passedResult('Pinned purchase')))
  await pinned.materialize()
  await store.pin(pinned.id)
  const active = await store.create()
  await active.append(scenarioFinished(passedResult('Active purchase')))
  await active.materialize({ finished: false })
  clock = new Date('2026-08-15T00:00:00.000Z')

  const result = await store.applyRetention({
    maxAgeMs: 14 * 24 * 60 * 60 * 1000,
  })

  expect(result.removed).toEqual([expired.id])
  expect(result.beforeBytes).toBeGreaterThan(result.afterBytes)
  expect(result.afterBytes).toBe((await store.inspectStorage()).totalBytes)
  expect((await store.list()).map((run) => run.id)).toEqual([
    pinned.id,
    active.id,
  ])
  expect((await store.inspectStorage()).pinnedRunIds).toEqual([pinned.id])
})

test('a rerun creates a new test run with a source-run reference', async () => {
  const root = await tempRoot()
  let nextId = 1
  const store = openTestRunStore({
    root,
    createId: () => `run-${nextId++}`,
    now: () => new Date('2026-08-15T12:00:00.000Z'),
  })
  const source = await store.create()
  await source.append(scenarioFinished(passedResult()))
  const sourceManifest = await source.materialize()
  const sourceEvents = await Bun.file(
    join(storageFor(root).runsDirectory, source.id, 'events.ndjson'),
  ).text()

  const rerun = await store.create({ sourceRunId: source.id })
  await rerun.append(scenarioFinished(passedResult()))
  const rerunManifest = await rerun.materialize()

  expect(rerun.id).toBe('run-2')
  expect(rerun.id).not.toBe(source.id)
  expect(rerunManifest.sourceRunId).toBe(source.id)
  expect(
    (await rerun.events()).find((event) => event.type === 'run-started'),
  ).toMatchObject({
    type: 'run-started',
    run: { id: 'run-2', sourceRunId: source.id },
  })
  expect(
    await Bun.file(
      join(storageFor(root).runsDirectory, source.id, 'events.ndjson'),
    ).text(),
  ).toBe(sourceEvents)
  expect(
    await Bun.file(
      join(storageFor(root).runsDirectory, source.id, 'manifest.json'),
    ).json(),
  ).toEqual(sourceManifest)
})

test('retention evicts the oldest runs when stored bytes exceed the limit', async () => {
  const root = await tempRoot()
  let nextId = 1
  const store = openTestRunStore({
    root,
    createId: () => `run-${nextId++}`,
    now: () => new Date('2026-08-15T00:00:00.000Z'),
  })
  const first = await store.create()
  await first.append(scenarioFinished(passedResult('First purchase')))
  await first.materialize()
  const second = await store.create()
  await second.append(scenarioFinished(passedResult('Second purchase')))
  await second.materialize()
  const result = await store.applyRetention({ maxBytes: 1 })

  expect(result.removed).toEqual(['run-1', 'run-2'])
  expect(result.beforeBytes).toBeGreaterThan(result.afterBytes)
  expect(result.afterBytes).toBe(0)
  expect(await store.list()).toEqual([])
})
