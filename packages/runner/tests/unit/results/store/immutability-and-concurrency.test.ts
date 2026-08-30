import { join } from 'node:path'
import { expect, test } from 'vitest'
import { requiredValue } from '../../../../src/required-value'
import {
  diagnosticEventScope,
  openTestRunStore,
  passedResult,
  scenarioFinished,
  storageFor,
  tempRoot,
} from './fixtures'

test('issue 77: persists and reopens only schema-v2 Test evidence', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-schema-v2',
    now: () => new Date('2026-08-22T12:00:00.000Z'),
  })
  const run = await store.create()
  await run.append(scenarioFinished(passedResult()))

  const finalized = await run.materialize()
  const reopened = await store.open(run.id)
  const reopenedEvents = await reopened.events()
  const reopenedManifest = await Bun.file(
    join(storageFor(root).runsDirectory, run.id, 'manifest.json'),
  ).json()

  expect(finalized.schemaVersion).toBe(2)
  expect(reopenedEvents.every((event) => event.schemaVersion === 2)).toBe(true)
  expect(reopenedManifest).toEqual(finalized)
})

test('issue 77: finalization is idempotent and a finalized Test run is immutable', async () => {
  const root = await tempRoot()
  let clock = new Date('2026-08-22T12:00:00.000Z')
  const store = openTestRunStore({
    root,
    createId: () => 'run-finalized',
    now: () => clock,
  })
  const run = await store.create()
  await run.append(scenarioFinished(passedResult()))
  const first = await run.materialize()
  const runDirectory = join(storageFor(root).runsDirectory, run.id)
  const manifestBefore = await Bun.file(
    join(runDirectory, 'manifest.json'),
  ).text()
  const eventsBefore = await Bun.file(
    join(runDirectory, 'events.ndjson'),
  ).text()

  clock = new Date('2026-08-22T13:00:00.000Z')
  expect(await run.materialize()).toEqual(first)
  await expect(
    run.append(scenarioFinished(passedResult('A late result'))),
  ).rejects.toThrow('finalized')
  expect(await Bun.file(join(runDirectory, 'manifest.json')).text()).toBe(
    manifestBefore,
  )
  expect(await Bun.file(join(runDirectory, 'events.ndjson')).text()).toBe(
    eventsBefore,
  )
})

test('issue 77: concurrent appends receive unique monotonic sequences', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-concurrent-events',
  })
  const run = await store.create()

  await Promise.all(
    Array.from({ length: 32 }, (_, index) =>
      run.append({
        type: 'inference-count-updated',
        inferenceCount: index,
        scope: diagnosticEventScope,
      }),
    ),
  )

  const events = await run.events()
  expect(events.map((event) => event.sequence)).toEqual(
    Array.from({ length: 33 }, (_, index) => index + 1),
  )
})

test('issue 77: coordinates appends and finalization across reopened handles', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-shared-handles',
  })
  const created = await store.create()
  const firstReopened = await store.open(created.id)
  const secondReopened = await store.open(created.id)
  const handles = [created, firstReopened, secondReopened]

  await Promise.all(
    Array.from({ length: 30 }, (_, index) =>
      requiredValue(handles[index % handles.length]).append({
        type: 'inference-count-updated',
        inferenceCount: index,
        scope: diagnosticEventScope,
      }),
    ),
  )

  expect((await created.events()).map((event) => event.sequence)).toEqual(
    Array.from({ length: 31 }, (_, index) => index + 1),
  )

  const finalizing = firstReopened.materialize()
  const lateAppends = handles.map((handle, index) =>
    handle.append({
      type: 'inference-count-updated',
      inferenceCount: 30 + index,
      scope: diagnosticEventScope,
    }),
  )
  const [finalization, ...appendOutcomes] = await Promise.allSettled([
    finalizing,
    ...lateAppends,
  ])

  expect(finalization?.status).toBe('fulfilled')
  for (const outcome of appendOutcomes) {
    expect(outcome.status).toBe('rejected')
    if (outcome.status !== 'rejected') continue
    if (!(outcome.reason instanceof Error)) throw outcome.reason
    expect(outcome.reason.message).toContain('finalized')
  }
  expect(
    (await secondReopened.events()).map((event) => event.sequence),
  ).toEqual(Array.from({ length: 31 }, (_, index) => index + 1))
})

test('issue 77: creating a duplicate run id preserves the existing run', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-exclusive',
    now: () => new Date('2026-08-22T12:00:00.000Z'),
  })
  const first = await store.create()
  await first.append(scenarioFinished(passedResult()))
  const eventsPath = join(
    storageFor(root).runsDirectory,
    first.id,
    'events.ndjson',
  )
  const eventsBefore = await Bun.file(eventsPath).text()

  await expect(store.create()).rejects.toThrow(
    'Test run "run-exclusive" already exists',
  )
  expect(await Bun.file(eventsPath).text()).toBe(eventsBefore)
})
