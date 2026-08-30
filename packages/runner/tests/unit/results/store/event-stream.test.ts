import { join } from 'node:path'
import { expect, test } from 'vitest'
import { requiredValue } from '../../../../src/required-value'
import {
  openTestRunStore,
  passedResult,
  scenarioFinished,
  scenarioStarted,
  storageFor,
  tempRoot,
} from './fixtures'

test('persists a test run with a stable identifier and an append-only versioned event stream', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-stable-id',
    now: () => new Date('2026-08-15T12:00:00.000Z'),
  })
  const run = await store.create()

  expect(run.id).toBe('run-stable-id')

  const purchase = passedResult()
  await run.append(scenarioStarted(purchase))
  await run.append(scenarioFinished(purchase))

  const eventsPath = join(
    storageFor(root).runsDirectory,
    'run-stable-id',
    'events.ndjson',
  )
  const firstSnapshot = await Bun.file(eventsPath).text()
  const firstEvents = await run.events()

  expect(firstEvents).toMatchObject([
    {
      schemaVersion: 2,
      sequence: 1,
      occurredAt: '2026-08-15T12:00:00.000Z',
      type: 'run-started',
      run: { id: 'run-stable-id', startedAt: '2026-08-15T12:00:00.000Z' },
    },
    {
      schemaVersion: 2,
      sequence: 2,
      type: 'scenario-started',
      scenario: { name: 'Complete a purchase' },
    },
    {
      schemaVersion: 2,
      sequence: 3,
      type: 'scenario-finished',
      attempt: purchase.attempts[0],
    },
  ])

  await run.append(scenarioStarted(passedResult('Pay for the order')))

  const secondSnapshot = await Bun.file(eventsPath).text()
  expect(secondSnapshot.startsWith(firstSnapshot)).toBe(true)
  expect(firstSnapshot).not.toContain('Pay for the order')
  expect((await run.events()).map((event) => event.sequence)).toEqual([
    1, 2, 3, 4,
  ])
  expect(await Bun.file(join(root, '.pickle')).exists()).toBe(false)
  expect(eventsPath.startsWith(storageFor(root).pickleHome)).toBe(true)
})

test('materializes a manifest from events without replacing the event stream', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-manifest',
    now: () => new Date('2026-08-15T12:00:00.000Z'),
  })
  const run = await store.create()
  const purchase = passedResult()
  await run.append(scenarioStarted(purchase))
  await run.append(scenarioFinished(purchase))

  const eventsPath = join(
    storageFor(root).runsDirectory,
    'run-manifest',
    'events.ndjson',
  )
  const beforeManifest = await Bun.file(eventsPath).text()
  const manifest = await run.materialize()

  expect(manifest).toEqual({
    schemaVersion: 2,
    id: 'run-manifest',
    startedAt: '2026-08-15T12:00:00.000Z',
    finishedAt: '2026-08-15T12:00:00.000Z',
    state: 'passed',
    results: [passedResult()],
  })
  expect(await Bun.file(eventsPath).text()).toBe(beforeManifest)
  expect(
    await Bun.file(
      join(storageFor(root).runsDirectory, 'run-manifest', 'manifest.json'),
    ).json(),
  ).toEqual(manifest)

  expect(await Bun.file(eventsPath).text()).toBe(beforeManifest)
})

test('materializes explicit uncacheable metadata for legacy adapter results', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-legacy-adapter',
    now: () => new Date('2026-08-15T12:00:00.000Z'),
  })
  const run = await store.create()
  const result = passedResult()
  const {
    executionMode: _executionMode,
    cacheOutcome: _cacheOutcome,
    inferenceCount: _inferenceCount,
    ...attempt
  } = requiredValue(result.attempts[0])
  await run.append(scenarioFinished({ ...result, attempts: [attempt] }))

  expect((await run.materialize()).results[0]?.attempts[0]).toMatchObject({
    executionMode: 'adaptive',
    cacheOutcome: 'uncacheable',
    inferenceCount: 0,
  })
})
