import { expect, test } from 'vitest'
import {
  openTestRunStore,
  passedResult,
  scenarioFinished,
  tempRoot,
} from './fixtures'

test('an in-progress manifest omits finishedAt until the test run finishes', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-live',
    now: () => new Date('2026-08-15T12:00:00.000Z'),
  })
  const run = await store.create()
  await run.append(scenarioFinished(passedResult()))

  const live = await run.materialize({ finished: false })
  expect(live.finishedAt).toBeUndefined()
  expect(live.state).toBe('passed')

  const finished = await run.materialize()
  expect(finished.finishedAt).toBe('2026-08-15T12:00:00.000Z')
})

test('orders manifest results by schedule index instead of finish order', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-order',
    now: () => new Date('2026-08-15T12:00:00.000Z'),
  })
  const run = await store.create()
  await run.append({
    ...scenarioFinished({
      ...passedResult('Second scenario'),
      specification: {
        name: 'Search',
        uri: 'features/search.feature',
      },
    }),
    scheduleIndex: 1,
  })
  await run.append({
    ...scenarioFinished(passedResult('First scenario')),
    scheduleIndex: 0,
  })

  const manifest = await run.materialize()
  expect(manifest.results.map((result) => result.scenario.name)).toEqual([
    'First scenario',
    'Second scenario',
  ])
})
