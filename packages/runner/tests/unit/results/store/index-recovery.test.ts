import { Database } from 'bun:sqlite'
import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import type { TestResult } from '../../../../src/execution/run-scenario'
import { requiredValue } from '../../../../src/required-value'
import {
  openTestRunStore,
  passedResult,
  scenarioFinished,
  storageFor,
  tempRoot,
  withAttempt,
} from './fixtures'

test('rebuilds the query index from persisted test runs after it is deleted', async () => {
  const root = await tempRoot()
  let nextId = 1
  const store = openTestRunStore({
    root,
    createId: () => `run-${nextId++}`,
    now: () => new Date('2026-08-15T12:00:00.000Z'),
  })

  const first = await store.create()
  await first.append(scenarioFinished(passedResult()))
  await first.materialize()

  const second = await store.create()
  await second.append(
    scenarioFinished(
      withAttempt(passedResult('Retry the purchase'), {
        state: 'failed',
        message: 'Payment was declined',
      }),
    ),
  )
  await second.materialize()

  const summaries = await store.list()
  expect(summaries).toEqual([
    {
      id: 'run-1',
      executionTargetProfileIds: ['deterministic'],
      specificationUris: ['features/checkout.feature'],
      startedAt: '2026-08-15T12:00:00.000Z',
      finishedAt: '2026-08-15T12:00:00.000Z',
      durationMs: 0,
      state: 'passed',
      resultCount: 1,
      executionModes: ['adaptive'],
      cacheOutcomes: ['uncacheable'],
      inferenceCount: 0,
    },
    {
      id: 'run-2',
      executionTargetProfileIds: ['deterministic'],
      specificationUris: ['features/checkout.feature'],
      startedAt: '2026-08-15T12:00:00.000Z',
      finishedAt: '2026-08-15T12:00:00.000Z',
      durationMs: 0,
      state: 'failed',
      resultCount: 1,
      executionModes: ['adaptive'],
      cacheOutcomes: ['uncacheable'],
      inferenceCount: 0,
    },
  ])

  await rm(storageFor(root).runIndexPath, { force: true })
  await store.rebuildIndex()
  expect(await store.list()).toEqual(summaries)
})

test('lists immutable history metadata for Studio after rebuilding the index', async () => {
  const root = await tempRoot()
  let clock = new Date('2026-08-15T12:00:00.000Z')
  const store = openTestRunStore({
    root,
    createId: () => 'run-history',
    now: () => clock,
  })
  const run = await store.create({
    suite: 'checkout',
    applicationRevision: 'app-42',
  })
  await run.append(
    scenarioFinished(
      withAttempt(passedResult(), {
        executionMode: 'replay',
        cacheOutcome: 'hit',
        inferenceCount: 0,
      }),
    ),
  )
  const mobile = withAttempt(passedResult('Complete a mobile purchase'), {
    executionMode: 'adaptive',
    cacheOutcome: 'fallback',
    inferenceCount: 3,
  })
  await run.append(
    scenarioFinished({
      ...mobile,
      executionTargetProfile: { id: 'android' },
    }),
  )
  clock = new Date('2026-08-15T12:00:03.500Z')
  const manifest = await run.materialize()

  expect(manifest).toMatchObject({
    suite: 'checkout',
    applicationRevision: 'app-42',
  })
  await rm(storageFor(root).runIndexPath, { force: true })
  await store.rebuildIndex()

  expect(await store.list()).toEqual([
    {
      id: 'run-history',
      suite: 'checkout',
      executionTargetProfileIds: ['android', 'deterministic'],
      specificationUris: ['features/checkout.feature'],
      applicationRevision: 'app-42',
      startedAt: '2026-08-15T12:00:00.000Z',
      finishedAt: '2026-08-15T12:00:03.500Z',
      durationMs: 3_500,
      state: 'passed',
      resultCount: 2,
      executionModes: ['adaptive', 'replay'],
      cacheOutcomes: ['fallback', 'hit'],
      inferenceCount: 3,
    },
  ])
})

test('indexes only the final cumulative inference count after Replay fallback', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-fallback-inference',
    now: () => new Date('2026-08-15T12:00:04.000Z'),
  })
  const run = await store.create()
  const base = passedResult()
  const evidenceAvailability: TestResult['attempts'][number]['evidenceAvailability'] =
    [
      { kind: 'screenshot', state: 'not-supported' },
      { kind: 'trace', state: 'not-supported' },
      { kind: 'recording', state: 'not-supported' },
      { kind: 'device-log', state: 'not-supported' },
      { kind: 'diagnostics', state: 'not-supported' },
    ]
  const replayAttempt = {
    ...requiredValue(base.attempts[0]),
    attempt: 1,
    state: 'failed' as const,
    executionMode: 'replay' as const,
    inferenceCount: 1,
    evidenceAvailability,
  }
  const adaptiveAttempt = {
    ...requiredValue(base.attempts[0]),
    attempt: 2,
    startedAt: '2026-08-15T12:00:01.000Z',
    finishedAt: '2026-08-15T12:00:03.000Z',
    durationMs: 2_000,
    executionMode: 'adaptive' as const,
    cacheOutcome: 'fallback' as const,
    inferenceCount: 3,
    evidenceAvailability,
  }
  const result = {
    ...base,
    startedAt: replayAttempt.startedAt,
    finishedAt: adaptiveAttempt.finishedAt,
    durationMs: 3_000,
    attempts: [replayAttempt, adaptiveAttempt],
    flaky: true,
  }
  await run.append(scenarioFinished(result, 0))
  await run.append(scenarioFinished(result, 1))

  const manifest = await run.materialize()

  expect(
    manifest.results[0]?.attempts.map((attempt) => attempt.inferenceCount),
  ).toEqual([1, 3])
  expect((await store.list())[0]?.inferenceCount).toBe(3)
})

test('backfills history metadata when opening an older query index', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-existing',
    now: () => new Date('2026-08-15T12:00:00.000Z'),
  })
  const run = await store.create({ applicationRevision: 'app-42' })
  await run.append(scenarioFinished(passedResult()))
  await run.materialize()

  const indexPath = storageFor(root).runIndexPath
  await rm(indexPath, { force: true })
  const legacy = new Database(indexPath, { create: true })
  legacy.run(`
    CREATE TABLE runs (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      state TEXT NOT NULL,
      result_count INTEGER NOT NULL
    )
  `)
  legacy.close()

  expect(await store.list()).toEqual([
    {
      id: 'run-existing',
      executionTargetProfileIds: ['deterministic'],
      specificationUris: ['features/checkout.feature'],
      applicationRevision: 'app-42',
      startedAt: '2026-08-15T12:00:00.000Z',
      finishedAt: '2026-08-15T12:00:00.000Z',
      durationMs: 0,
      state: 'passed',
      resultCount: 1,
      executionModes: ['adaptive'],
      cacheOutcomes: ['uncacheable'],
      inferenceCount: 0,
    },
  ])
})

test('rebuilds the query index from an events-only test run', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-recovered',
    now: () => new Date('2026-08-15T12:00:00.000Z'),
  })
  const run = await store.create()
  await run.append(scenarioFinished(passedResult()))
  await rm(
    join(storageFor(root).runsDirectory, 'run-recovered', 'manifest.json'),
    {
      force: true,
    },
  )
  await rm(storageFor(root).runIndexPath, { force: true })

  await store.rebuildIndex()
  expect(await store.list()).toEqual([
    {
      id: 'run-recovered',
      executionTargetProfileIds: ['deterministic'],
      specificationUris: ['features/checkout.feature'],
      startedAt: '2026-08-15T12:00:00.000Z',
      state: 'passed',
      resultCount: 1,
      executionModes: ['adaptive'],
      cacheOutcomes: ['uncacheable'],
      inferenceCount: 0,
    },
  ])
})
