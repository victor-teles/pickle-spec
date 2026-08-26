import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  openTestRunStore,
  resolveLocalProjectStorage,
} from '@pickle-spec/runner'
import { createStudioHistoryGateway } from './studio-history'

const directories: string[] = []
const originalPickleHome = process.env.PICKLE_HOME

afterEach(async () => {
  if (originalPickleHome === undefined) delete process.env.PICKLE_HOME
  else process.env.PICKLE_HOME = originalPickleHome
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function fixture(finished = true) {
  const root = await mkdtemp(join(tmpdir(), 'pickle-studio-history-root-'))
  const pickleHome = await mkdtemp(
    join(tmpdir(), 'pickle-studio-history-home-'),
  )
  directories.push(root, pickleHome)
  process.env.PICKLE_HOME = pickleHome
  const store = openTestRunStore({ root, createId: () => 'run-1' })
  const run = await store.create()
  await run.materialize({ finished })
  return { root }
}

test('lists storage and explicit retention without deleting by default', async () => {
  const { root } = await fixture()
  const gateway = createStudioHistoryGateway(root, async () => ({}))

  const history = await gateway.list()
  const result = await gateway.deleteEligible()

  expect(history.runs.map((run) => run.id)).toEqual(['run-1'])
  expect(history.retention).toEqual({})
  expect(history.storage.totalBytes).toBeGreaterThan(0)
  expect(result.removed).toEqual([])
})

test('pins and unpins a test run without mutating the immutable manifest', async () => {
  const { root } = await fixture()
  const gateway = createStudioHistoryGateway(root, async () => ({
    maxAgeMs: 1,
  }))
  const manifestPath = join(
    resolveLocalProjectStorage(root).runsDirectory,
    'run-1',
    'manifest.json',
  )
  const before = await Bun.file(manifestPath).bytes()

  await gateway.pin('run-1')
  expect((await gateway.list()).storage.pinnedRunIds).toEqual(['run-1'])
  expect((await gateway.deleteEligible()).removed).toEqual([])
  await gateway.unpin('run-1')
  expect((await gateway.list()).storage.pinnedRunIds).toEqual([])
  expect(await Bun.file(manifestPath).bytes()).toEqual(before)
})

test('exports Studio Allure results as a valid empty ZIP archive', async () => {
  const { root } = await fixture()
  const gateway = createStudioHistoryGateway(root, async () => ({}))

  const bytes = await gateway.exportAllure('run-1')

  expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4b, 0x05, 0x06])
})

test('rejects Studio Allure export until the Test run is finalized', async () => {
  const { root } = await fixture(false)
  const gateway = createStudioHistoryGateway(root, async () => ({}))

  await expect(gateway.exportAllure('run-1')).rejects.toThrow(
    'must be finalized before export',
  )
})
