import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  openTestRunStore,
  resolveLocalProjectStorage,
} from '@pickle-spec/runner'
import { afterEach, expect, test } from 'vitest'
import { createStudioHistoryGateway } from '../../../src/studio/studio-history'

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

test('exports every Studio report format from a finalized Test run', async () => {
  const { root } = await fixture()
  const gateway = createStudioHistoryGateway(root, async () => ({}))

  const json = await gateway.exportReport({ runId: 'run-1', format: 'json' })
  const ndjson = await gateway.exportReport({
    runId: 'run-1',
    format: 'ndjson',
  })
  const junit = await gateway.exportReport({
    runId: 'run-1',
    format: 'junit',
  })
  const html = await gateway.exportReport({
    runId: 'run-1',
    format: 'html',
    htmlArtifacts: 'all',
  })
  const archive = await gateway.exportReport({
    runId: 'run-1',
    format: 'archive',
  })
  const allure = await gateway.exportReport({
    runId: 'run-1',
    format: 'allure',
  })

  expect(JSON.parse(String(json)).id).toBe('run-1')
  expect(String(ndjson)).toContain('"type":')
  expect(String(junit)).toContain('<testsuites')
  expect(String(html)).toContain('<!DOCTYPE html>')
  expect(JSON.parse(String(archive)).manifest.id).toBe('run-1')
  if (!(allure instanceof Uint8Array)) throw new Error('Expected ZIP bytes')
  expect([...allure.slice(0, 4)]).toEqual([0x50, 0x4b, 0x05, 0x06])
})

test('rejects Studio report export until the Test run is finalized', async () => {
  const { root } = await fixture(false)
  const gateway = createStudioHistoryGateway(root, async () => ({}))

  await expect(
    gateway.exportReport({ runId: 'run-1', format: 'json' }),
  ).rejects.toThrow('must be finalized before export')
})
