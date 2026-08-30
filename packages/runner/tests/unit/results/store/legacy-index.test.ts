import { rm } from 'node:fs/promises'
import { expect, test } from 'vitest'
import {
  openTestRunStore,
  passedResult,
  scenarioFinished,
  storageFor,
  tempRoot,
} from './fixtures'

test('issue 77: rebuilding after manual runs deletion removes stale index entries', async () => {
  const root = await tempRoot()
  const storage = storageFor(root)
  const firstStore = openTestRunStore({
    root,
    createId: () => 'run-before-cutover',
  })
  const first = await firstStore.create()
  await first.append(scenarioFinished(passedResult()))
  await first.materialize()
  expect((await firstStore.list()).map((run) => run.id)).toEqual([
    'run-before-cutover',
  ])

  await rm(storage.runsDirectory, { recursive: true, force: true })
  const currentStore = openTestRunStore({
    root,
    createId: () => 'run-after-cutover',
  })
  const current = await currentStore.create()
  await current.append(scenarioFinished(passedResult()))
  await current.materialize()

  expect((await currentStore.list()).map((run) => run.id)).toEqual([
    'run-after-cutover',
  ])
})
