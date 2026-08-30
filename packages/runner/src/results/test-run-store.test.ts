import { Database } from 'bun:sqlite'
import { chmod, mkdir, mkdtemp, rm, truncate } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, test } from 'vitest'
import {
  openTestRunStore as openTestRunStoreBase,
  resolveLocalProjectStorage,
  runScenario,
  type TestRunStoreOptions,
} from '../../index'
import type { ActionEvidence, TestResult } from '../execution/run-scenario'
import { requiredValue } from '../required-value'
import { withSharedEvidenceObservations } from './shared-evidence-observations'

const directories: string[] = []

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function tempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'pickle-test-runs-'))
  directories.push(root)
  return root
}

function storageFor(root: string) {
  return resolveLocalProjectStorage(root, join(root, '.pickle-home'))
}

function openTestRunStore(options: TestRunStoreOptions) {
  return openTestRunStoreBase({
    ...options,
    pickleHome: storageFor(options.root).pickleHome,
  })
}

function passedResult(name = 'Complete a purchase'): TestResult {
  const startedAt = '2026-08-15T12:00:00.000Z'
  const finishedAt = '2026-08-15T12:00:00.012Z'
  return {
    schemaVersion: 2,
    specification: {
      name: 'Checkout',
      uri: 'features/checkout.feature',
    },
    scenario: {
      name,
      id: `scenario-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    },
    executionTargetProfile: { id: 'deterministic' },
    state: 'passed',
    startedAt,
    finishedAt,
    durationMs: 12,
    attempts: [
      {
        attempt: 1,
        startedAt,
        finishedAt,
        durationMs: 12,
        state: 'passed',
        steps: [],
        executionMode: 'adaptive',
        cacheOutcome: 'uncacheable',
        inferenceCount: 0,
        evidenceAvailability: [
          { kind: 'screenshot', state: 'not-supported' },
          { kind: 'trace', state: 'not-supported' },
          { kind: 'recording', state: 'not-supported' },
          { kind: 'device-log', state: 'not-supported' },
          { kind: 'diagnostics', state: 'not-supported' },
        ],
      },
    ],
  }
}

const diagnosticEventScope = {
  scenarioId: 'diagnostic-scenario',
  executionTargetProfileId: 'deterministic',
  attempt: 1,
}

function scenarioFinished(result: TestResult, attemptIndex = -1) {
  const attempt = requiredValue(result.attempts.at(attemptIndex))
  return {
    type: 'scenario-finished' as const,
    specification: result.specification,
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
    scope: {
      scenarioId: requiredValue(result.scenario.id),
      examplesRowId: result.scenario.examplesRowId,
      executionTargetProfileId: result.executionTargetProfile.id,
      attempt: attempt.attempt,
    },
    attempt,
  }
}

function scenarioStarted(result: TestResult) {
  const attempt = requiredValue(result.attempts[0])
  return {
    type: 'scenario-started' as const,
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
    scope: {
      scenarioId: requiredValue(result.scenario.id),
      examplesRowId: result.scenario.examplesRowId,
      executionTargetProfileId: result.executionTargetProfile.id,
      attempt: attempt.attempt,
    },
  }
}

function actionFinished(screenshotPath: string, profileId = 'deterministic') {
  const occurredAt = '2026-08-15T12:00:00.006Z'
  const action: ActionEvidence = {
    version: 1,
    id: 'step-1-action-1',
    ordinal: 1,
    description: 'Click Pay',
    startedAt: '2026-08-15T12:00:00.004Z',
    finishedAt: occurredAt,
    durationMs: 2,
    state: 'passed',
    source: {
      uri: 'features/checkout.feature',
      language: 'en',
      line: 7,
      column: 5,
      excerpt: 'When I pay',
    },
    target: {
      before: { format: 'summary', summary: 'Ready state: complete' },
      after: { format: 'summary', summary: 'Ready state: complete' },
    },
    screenshots: {
      before: {
        state: 'available',
        artifact: { kind: 'screenshot', path: screenshotPath },
      },
      after: { state: 'not-requested' },
    },
    diagnostics: [
      {
        occurredAt,
        level: 'warning',
        origin: 'console',
        message: 'provisional diagnostic',
        executionTargetProfileId: profileId,
      },
    ],
    activity: [],
  }
  return {
    type: 'action-finished' as const,
    action,
    scenario: { id: 'scenario-checkout', name: 'Checkout' },
    executionTargetProfile: { id: profileId },
    scope: {
      scenarioId: 'scenario-checkout',
      executionTargetProfileId: profileId,
      attempt: 1,
      stepIndex: 0,
    },
  }
}

function withAttempt(
  result: TestResult,
  patch: Partial<TestResult['attempts'][number]>,
): TestResult {
  const attempt = { ...requiredValue(result.attempts[0]), ...patch }
  return {
    ...result,
    state: attempt.state,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    durationMs: attempt.durationMs,
    attempts: [attempt],
  }
}

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

test('persists public evidence without private replay data', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-public-evidence',
    now: () => new Date('2026-08-15T12:00:00.000Z'),
  })
  const run = await store.create()
  const result = passedResult()
  const attempt = requiredValue(result.attempts[0])
  await run.append(
    scenarioFinished({
      ...result,
      attempts: [
        {
          ...attempt,
          executionMode: 'replay',
          cacheOutcome: 'hit',
          inferenceCount: 0,
          steps: [
            {
              index: 0,
              startedAt: attempt.startedAt,
              finishedAt: attempt.finishedAt,
              durationMs: attempt.durationMs,
              step: { keyword: 'When', text: 'I submit', type: 'action' },
              state: 'passed',
              resolvedActions: [
                {
                  description: 'Submit the form',
                  replay: { raw: 'private-replay-payload' },
                },
              ],
            },
          ],
        },
      ],
    }),
  )

  const manifest = await run.materialize()
  expect(manifest.results[0]?.attempts[0]).toMatchObject({
    executionMode: 'replay',
    cacheOutcome: 'hit',
    inferenceCount: 0,
    steps: [{ resolvedActions: [{ description: 'Submit the form' }] }],
  })
  expect(
    await Bun.file(
      join(storageFor(root).runsDirectory, run.id, 'events.ndjson'),
    ).text(),
  ).not.toContain('private-replay-payload')
  expect(
    await Bun.file(
      join(storageFor(root).runsDirectory, run.id, 'manifest.json'),
    ).text(),
  ).not.toContain('private-replay-payload')
})

test('persists runner-emitted observations without replay payloads', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-shared-observations',
    now: () => new Date('2026-08-15T12:00:00.000Z'),
  })
  const persisted = await store.create()
  const run = await runScenario({
    specification: {
      name: 'Checkout',
      source: { uri: 'features/checkout.feature', language: 'en' },
      tags: [],
      scenarios: [],
    },
    scenario: {
      id: 'scenario-receipt',
      name: 'Capture the receipt',
      tags: [],
      steps: [
        {
          keyword: 'Then',
          text: 'the receipt appears',
          type: 'outcome',
        },
      ],
    },
    executionTargetProfile: {
      id: 'web',
      adapter: 'web',
      capabilities: ['screenshots'],
    },
    adapter: {
      async openSession() {
        return {
          async executeStep() {
            return {
              state: 'passed' as const,
              resolvedActions: [
                {
                  description: 'Assert receipt on chrome',
                  replay: { raw: 'private-replay-payload' },
                },
              ],
              artifacts: [
                {
                  kind: 'screenshot' as const,
                  path: '/tmp/receipt.png',
                  mediaType: 'image/png',
                },
              ],
            }
          },
          async complete() {
            return { inferenceCount: 1 }
          },
          async close() {},
        }
      },
    },
    now: (() => {
      const timestamps = [
        '2026-08-15T12:00:01.000Z',
        '2026-08-15T12:00:02.000Z',
        '2026-08-15T12:00:03.000Z',
        '2026-08-15T12:00:04.000Z',
      ]
      let index = 0
      return () => new Date(requiredValue(timestamps[index++]))
    })(),
  })

  for (const event of run.events) {
    await persisted.append(event)
  }

  const storedEvents = await persisted.events()
  const stepFinished = storedEvents.find(
    (event) => event.type === 'step-finished',
  )
  expect(stepFinished).toMatchObject({
    type: 'step-finished',
    observations: [
      {
        kind: 'outcome',
      },
      {
        kind: 'activity',
        activity: {
          kind: 'resolved-action',
          description: 'Assert receipt on chrome',
        },
      },
      {
        kind: 'artifact',
        artifact: {
          kind: 'screenshot',
          path: expect.any(String),
        },
      },
    ],
  })
  const eventsSource = await Bun.file(
    join(storageFor(root).runsDirectory, persisted.id, 'events.ndjson'),
  ).text()
  expect(eventsSource).not.toContain('private-replay-payload')
  expect(eventsSource).toContain('"observations"')
})

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

test('persists every final state and records flaky without adding a new state', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-states',
  })
  const run = await store.create()
  const states = [
    passedResult('Passed purchase'),
    withAttempt(passedResult('Failed purchase'), {
      state: 'failed',
      message: 'Payment was declined',
    }),
    withAttempt(passedResult('Skipped purchase'), {
      state: 'skipped',
      message: 'Scenario is tagged @ignore',
    }),
    withAttempt(passedResult('Cancelled purchase'), {
      state: 'cancelled',
      message: 'Scenario cancelled',
    }),
    withAttempt(passedResult('Unavailable purchase'), {
      state: 'infrastructure-error',
      message: 'Browser process exited',
    }),
  ]
  for (const result of states) {
    await run.append(scenarioFinished(result))
  }
  const flaky = passedResult('Flaky purchase')
  await run.append(
    scenarioFinished(
      withAttempt(flaky, { attempt: 1, state: 'infrastructure-error' }),
    ),
  )
  await run.append(
    scenarioFinished(withAttempt(flaky, { attempt: 2, state: 'passed' })),
  )

  const manifest = await run.materialize()
  expect(
    Object.fromEntries(
      manifest.results.map((result) => [
        result.scenario.name,
        { state: result.state, flaky: result.flaky },
      ]),
    ),
  ).toEqual({
    'Passed purchase': { state: 'passed', flaky: undefined },
    'Failed purchase': { state: 'failed', flaky: undefined },
    'Skipped purchase': { state: 'skipped', flaky: undefined },
    'Cancelled purchase': { state: 'cancelled', flaky: undefined },
    'Unavailable purchase': {
      state: 'infrastructure-error',
      flaky: undefined,
    },
    'Flaky purchase': { state: 'passed', flaky: true },
  })
  expect(manifest.state).toBe('infrastructure-error')
  expect(new Set(manifest.results.map((result) => result.state))).toEqual(
    new Set([
      'passed',
      'failed',
      'skipped',
      'cancelled',
      'infrastructure-error',
    ]),
  )
})

test('captures only failure artifacts under the default evidence policy', async () => {
  const root = await tempRoot()
  const screenshot = join(root, 'source-screenshot.png')
  await Bun.write(screenshot, new Uint8Array([137, 80, 78, 71]))
  const store = openTestRunStore({
    root,
    createId: () => 'run-artifacts',
  })
  const run = await store.create()

  await run.append(
    scenarioFinished(
      resultWithArtifact('Passed purchase', 'passed', screenshot),
    ),
  )
  const failedResult = resultWithArtifact(
    'Failed purchase',
    'failed',
    screenshot,
  )
  const failedAttempt = requiredValue(failedResult.attempts[0])
  await run.append(
    scenarioFinished({
      ...failedResult,
      attempts: [
        {
          ...failedAttempt,
          steps: [
            {
              ...requiredValue(failedAttempt.steps[0]),
              index: 0,
              step: {
                keyword: 'Given',
                text: 'a product is in the basket',
                type: 'context',
              },
              state: 'passed',
            },
            { ...requiredValue(failedAttempt.steps[0]), index: 1 },
          ],
        },
      ],
    }),
  )

  const manifest = await run.materialize()
  const passed = manifest.results.find(
    (result) => result.scenario.name === 'Passed purchase',
  )
  const failed = manifest.results.find(
    (result) => result.scenario.name === 'Failed purchase',
  )
  const artifactsDirectory = join(
    storageFor(root).runsDirectory,
    'run-artifacts',
    'artifacts',
  )

  expect(passed?.attempts[0]?.steps[0]?.artifacts).toBeUndefined()
  expect(
    failed?.attempts[0]?.steps[0]?.artifacts?.[0]?.path.startsWith(
      artifactsDirectory,
    ),
  ).toBe(true)
  expect(
    failed?.attempts[0]?.steps[1]?.artifacts?.[0]?.path.startsWith(
      artifactsDirectory,
    ),
  ).toBe(true)
  expect(
    await Bun.file(
      requiredValue(
        requiredValue(
          requiredValue(
            requiredValue(requiredValue(failed).attempts[0]).steps[1],
          ).artifacts,
        )[0],
      ).path,
    ).bytes(),
  ).toEqual(new Uint8Array([137, 80, 78, 71]))
  expect(await Bun.file(screenshot).exists()).toBe(true)
})

test('persists Diagnostic entries for failed runs by default and drops them for passed runs', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-diagnostics',
  })
  const run = await store.create()
  const diagnostic = {
    occurredAt: '2026-08-23T12:00:00.004Z',
    level: 'error' as const,
    origin: 'console' as const,
    message: 'Payment was declined',
    scenarioName: 'Complete a purchase',
    stepIndex: 0,
    stepText: 'Then the purchase succeeds',
    executionTargetProfileId: 'deterministic',
  }
  const trace = {
    occurredAt: '2026-08-23T12:00:00.004Z',
    kind: 'resolved-action' as const,
    description: 'Click pay on chrome',
  }
  const passed = resultWithArtifact(
    'Passed purchase',
    'passed',
    join(root, 'unused.png'),
  )
  const failed = resultWithArtifact(
    'Failed purchase',
    'failed',
    join(root, 'unused.png'),
  )
  const passedAttempt = requiredValue(passed.attempts[0])
  const failedAttempt = requiredValue(failed.attempts[0])
  const liveStep = {
    ...requiredValue(passedAttempt.steps[0]),
    artifacts: undefined,
    diagnostics: [diagnostic],
    trace: [trace],
  }
  const liveEvent = await run.append(
    withSharedEvidenceObservations({
      schemaVersion: 2,
      sequence: 2,
      occurredAt: liveStep.finishedAt,
      type: 'step-finished',
      result: liveStep,
      scenario: passed.scenario,
      executionTargetProfile: passed.executionTargetProfile,
      scope: {
        scenarioId: requiredValue(passed.scenario.id),
        executionTargetProfileId: passed.executionTargetProfile.id,
        attempt: passedAttempt.attempt,
        stepIndex: liveStep.index,
      },
    }),
  )

  expect(liveEvent).toMatchObject({
    type: 'step-finished',
    result: { diagnostics: [diagnostic], trace: [trace] },
    observations: expect.any(Array),
  })
  const persistedLiveStep = (await run.events()).at(-1)
  expect(persistedLiveStep?.type).toBe('step-finished')
  if (persistedLiveStep?.type !== 'step-finished') {
    throw new Error('Expected a persisted step-finished event')
  }
  expect(persistedLiveStep.result.diagnostics).toBeUndefined()
  expect(persistedLiveStep.result.trace).toBeUndefined()
  expect(persistedLiveStep.observations).toEqual([
    {
      version: 1,
      kind: 'outcome',
      summary: 'Then the purchase succeeds passed',
      timing: {
        occurredAt: passedAttempt.finishedAt,
        precision: 'step-finish',
        startedAt: passedAttempt.startedAt,
        finishedAt: passedAttempt.finishedAt,
        durationMs: passedAttempt.durationMs,
      },
      outcome: { state: 'passed' },
    },
    {
      version: 1,
      kind: 'activity',
      summary: 'Click pay on chrome',
      timing: {
        occurredAt: trace.occurredAt,
        precision: 'exact',
        startedAt: passedAttempt.startedAt,
        finishedAt: passedAttempt.finishedAt,
        durationMs: passedAttempt.durationMs,
      },
      activity: {
        kind: 'resolved-action',
        description: 'Click pay on chrome',
      },
    },
    {
      version: 1,
      kind: 'diagnostic',
      summary: diagnostic.message,
      timing: {
        occurredAt: diagnostic.occurredAt,
        precision: 'exact',
      },
      outcome: {
        level: diagnostic.level,
        message: diagnostic.message,
      },
    },
  ])

  await run.append(
    scenarioFinished({
      ...passed,
      attempts: [
        {
          ...passedAttempt,
          diagnostics: [diagnostic],
          evidenceAvailability: passedAttempt.evidenceAvailability.map(
            (item) => {
              if (item.kind === 'screenshot') {
                return { kind: item.kind, state: 'not-requested' as const }
              }
              return item.kind === 'diagnostics' || item.kind === 'trace'
                ? { kind: item.kind, state: 'available' as const }
                : item
            },
          ),
          steps: passedAttempt.steps.map((step) => ({
            ...step,
            artifacts: undefined,
            diagnostics: [diagnostic],
            trace: [trace],
          })),
        },
      ],
    }),
  )
  await run.append(
    scenarioFinished({
      ...failed,
      attempts: [
        {
          ...failedAttempt,
          diagnostics: [diagnostic],
          evidenceAvailability: failedAttempt.evidenceAvailability.map(
            (item) => {
              if (item.kind === 'screenshot') {
                return { kind: item.kind, state: 'not-requested' as const }
              }
              return item.kind === 'diagnostics' || item.kind === 'trace'
                ? { kind: item.kind, state: 'available' as const }
                : item
            },
          ),
          steps: failedAttempt.steps.map((step) => ({
            ...step,
            artifacts: undefined,
            diagnostics: [diagnostic],
            trace: [trace],
          })),
        },
      ],
    }),
  )

  const manifest = await run.materialize()
  const passedPersisted = manifest.results.find(
    (result) => result.scenario.name === 'Passed purchase',
  )
  const failedPersisted = manifest.results.find(
    (result) => result.scenario.name === 'Failed purchase',
  )

  expect(passedPersisted?.attempts[0]?.steps[0]?.diagnostics).toBeUndefined()
  expect(passedPersisted?.attempts[0]?.diagnostics).toBeUndefined()
  expect(passedPersisted?.attempts[0]?.steps[0]?.trace).toBeUndefined()
  expect(
    passedPersisted?.attempts[0]?.evidenceAvailability.find(
      (item) => item.kind === 'diagnostics',
    )?.state,
  ).toBe('not-retained')
  expect(
    passedPersisted?.attempts[0]?.evidenceAvailability.find(
      (item) => item.kind === 'trace',
    )?.state,
  ).toBe('not-retained')
  expect(failedPersisted?.attempts[0]?.steps[0]?.diagnostics).toEqual([
    diagnostic,
  ])
  expect(failedPersisted?.attempts[0]?.diagnostics).toEqual([diagnostic])
  expect(failedPersisted?.attempts[0]?.steps[0]?.trace).toEqual([trace])
})

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

function resultWithArtifact(
  name: string,
  state: TestResult['state'],
  path: string,
): TestResult {
  const result = passedResult(name)
  const attempt = requiredValue(result.attempts[0])
  return {
    ...result,
    state,
    attempts: [
      {
        ...attempt,
        state,
        evidenceAvailability: [
          { kind: 'screenshot', state: 'available' },
          { kind: 'trace', state: 'not-supported' },
          { kind: 'recording', state: 'not-supported' },
          { kind: 'device-log', state: 'not-supported' },
          { kind: 'diagnostics', state: 'not-supported' },
        ],
        steps: [
          {
            index: 0,
            startedAt: attempt.startedAt,
            finishedAt: attempt.finishedAt,
            durationMs: attempt.durationMs,
            step: {
              keyword: 'Then',
              text: 'the purchase succeeds',
              type: 'outcome',
            },
            state,
            resolvedActions: [],
            artifacts: [{ kind: 'screenshot', path, mediaType: 'image/png' }],
          },
        ],
      },
    ],
  }
}

test('links persisted artifacts to canonical non-adjacent event ranges', async () => {
  const root = await tempRoot()
  const screenshot = join(root, 'terminal.png')
  const recording = join(root, 'scenario.mp4')
  await Bun.write(screenshot, 'image')
  await Bun.write(recording, 'video')
  const run = await openTestRunStore({
    root,
    createId: () => 'run-artifact-links',
  }).create()
  const result = resultWithArtifact('Linked evidence', 'failed', screenshot)
  const attempt = requiredValue(result.attempts[0])
  const terminal = {
    ...requiredValue(attempt.steps[0]),
    index: 1,
    artifacts: [
      { kind: 'screenshot' as const, path: screenshot },
      { kind: 'recording' as const, path: recording },
    ],
  }
  const scope = {
    scenarioId: requiredValue(result.scenario.id),
    executionTargetProfileId: result.executionTargetProfile.id,
    attempt: attempt.attempt,
  }
  const stepStarted = (stepIndex: number) => ({
    type: 'step-started' as const,
    step: terminal.step,
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
    scope: { ...scope, stepIndex },
  })

  await run.append(stepStarted(0))
  await run.append({
    type: 'step-finished',
    result: { ...terminal, index: 0, artifacts: undefined },
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
    scope: { ...scope, stepIndex: 0 },
  })
  await run.append(stepStarted(1))
  await run.append({
    type: 'cache-uncacheable',
    reason: 'non-deterministic-action',
    scope: { ...scope, stepIndex: 1 },
  })
  const finished = await run.append({
    type: 'step-finished',
    result: terminal,
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
    scope: { ...scope, stepIndex: 1 },
  })

  expect(finished).toMatchObject({
    sequence: 6,
    result: {
      artifacts: [
        {
          kind: 'screenshot',
          evidenceLink: {
            stepIndex: 1,
            eventRange: { startSequence: 4, endSequence: 6 },
          },
        },
        {
          kind: 'recording',
          evidenceLink: {
            stepIndex: 1,
            eventRange: { startSequence: 2, endSequence: 6 },
          },
        },
      ],
    },
  })
  await run.append(
    scenarioFinished({
      ...result,
      attempts: [
        {
          ...attempt,
          steps: [{ ...terminal, index: 0, artifacts: undefined }, terminal],
          evidenceAvailability: attempt.evidenceAvailability.map(
            (availability) =>
              availability.kind === 'recording'
                ? { ...availability, state: 'available' as const }
                : availability,
          ),
        },
      ],
    }),
  )
  const scenarioFinish = (await run.events()).at(-1)
  expect(scenarioFinish).toMatchObject({
    type: 'scenario-finished',
    sequence: 7,
    attempt: {
      steps: [
        {},
        {
          artifacts: [
            {
              evidenceLink: {
                eventRange: { startSequence: 4, endSequence: 6 },
              },
            },
            {
              evidenceLink: {
                eventRange: { startSequence: 2, endSequence: 6 },
              },
            },
          ],
        },
      ],
    },
  })
})

function withDiagnosticEvidence(result: TestResult): TestResult {
  const attempt = requiredValue(result.attempts[0])
  const diagnostic = {
    occurredAt: attempt.finishedAt,
    level: 'error' as const,
    origin: 'adapter' as const,
    message: `Diagnostic for ${result.scenario.name}`,
  }
  return {
    ...result,
    attempts: [
      {
        ...attempt,
        diagnostics: [diagnostic],
        evidenceAvailability: attempt.evidenceAvailability.map((item) =>
          item.kind === 'diagnostics'
            ? { kind: item.kind, state: 'available' as const }
            : item,
        ),
        steps: attempt.steps.map((step) => ({
          ...step,
          diagnostics: [diagnostic],
        })),
      },
    ],
  }
}

test.each(['off', 'on-failure'] as const)(
  'persists stripped provisional action evidence under %s while returning the full live record',
  async (evidencePersistence) => {
    const root = await tempRoot()
    const screenshotPath = join(root, `${evidencePersistence}-action.png`)
    await Bun.write(screenshotPath, new Uint8Array([137, 80, 78, 71]))
    const run = await openTestRunStore({
      root,
      createId: () => `run-action-${evidencePersistence}`,
      evidencePersistence,
    }).create()

    const live = await run.append(actionFinished(screenshotPath))

    expect(live).toMatchObject({
      type: 'action-finished',
      action: {
        screenshots: { before: { state: 'available' } },
        diagnostics: [{ message: 'provisional diagnostic' }],
      },
    })
    const persisted = requiredValue(
      (await run.events()).find((event) => event.type === 'action-finished'),
    )
    expect(persisted).toMatchObject({
      type: 'action-finished',
      action: {
        screenshots: { before: { state: 'not-retained' } },
        diagnostics: [],
      },
    })
    expect(JSON.stringify(persisted)).not.toContain(screenshotPath)
    expect(JSON.stringify(persisted)).not.toContain('provisional diagnostic')
  },
)

test('reuses always-retained action screenshots through scenario completion', async () => {
  const root = await tempRoot()
  const screenshotPath = join(root, 'always-action.png')
  await Bun.write(screenshotPath, new Uint8Array([137, 80, 78, 71]))
  const run = await openTestRunStore({
    root,
    createId: () => 'run-action-always',
    evidencePersistence: 'always',
  }).create()

  const published = await run.append(actionFinished(screenshotPath))

  expect(published.type).toBe('action-finished')
  if (published.type !== 'action-finished') {
    throw new Error('Expected published Action evidence')
  }
  const before = published.action.screenshots.before
  expect(before.state).toBe('available')
  if (before.state !== 'available') {
    throw new Error('Expected persisted before screenshot')
  }
  expect(before.artifact.path).not.toBe(screenshotPath)
  expect(before.artifact.path).toContain('/artifacts/')
  expect(await Bun.file(before.artifact.path).exists()).toBe(true)
  const originalAction = actionFinished(screenshotPath).action
  const stepResult = {
    index: 0,
    startedAt: published.action.startedAt,
    finishedAt: published.action.finishedAt,
    durationMs: published.action.durationMs,
    step: { keyword: 'When', text: 'I pay', type: 'action' as const },
    state: 'passed' as const,
    resolvedActions: [
      { description: published.action.description, evidence: originalAction },
    ],
  }
  const step = await run.append({
    type: 'step-finished',
    result: stepResult,
    scenario: published.scenario,
    executionTargetProfile: published.executionTargetProfile,
    scope: published.scope,
  })
  expect(step).toMatchObject({
    type: 'step-finished',
    result: {
      resolvedActions: [
        {
          evidence: {
            screenshots: {
              before: { artifact: { path: before.artifact.path } },
            },
          },
        },
      ],
    },
  })
  const finished = await run.append({
    type: 'scenario-finished',
    specification: { name: 'Checkout', uri: 'features/checkout.feature' },
    scenario: published.scenario,
    executionTargetProfile: published.executionTargetProfile,
    scope: {
      scenarioId: published.scope.scenarioId,
      executionTargetProfileId: published.scope.executionTargetProfileId,
      attempt: published.scope.attempt,
    },
    attempt: {
      attempt: 1,
      startedAt: published.action.startedAt,
      finishedAt: published.action.finishedAt,
      durationMs: published.action.durationMs,
      state: 'passed',
      steps: [stepResult],
      evidenceAvailability: [
        { kind: 'screenshot', state: 'not-requested' },
        { kind: 'trace', state: 'not-requested' },
        { kind: 'recording', state: 'not-requested' },
        { kind: 'device-log', state: 'not-requested' },
        { kind: 'diagnostics', state: 'not-requested' },
      ],
    },
  })
  expect(finished).toMatchObject({
    type: 'scenario-finished',
    attempt: {
      steps: [
        {
          resolvedActions: [
            {
              evidence: {
                screenshots: {
                  before: { artifact: { path: before.artifact.path } },
                },
              },
            },
          ],
        },
      ],
    },
  })
  expect(
    (await run.events()).find((event) => event.type === 'action-finished'),
  ).toEqual(published)
})

test('issue 83: resolves Evidence persistence per profile with a run-wide default', async () => {
  const root = await tempRoot()
  const persistSource = join(root, 'persist.png')
  const dropSource = join(root, 'drop.png')
  const defaultSource = join(root, 'default.png')
  await Promise.all(
    [persistSource, dropSource, defaultSource].map((path) =>
      Bun.write(path, new Uint8Array([137, 80, 78, 71])),
    ),
  )
  const store = openTestRunStore({
    root,
    createId: () => 'run-mixed-evidence-policy',
    evidencePersistence: 'on-failure',
    evidencePersistenceByProfile: {
      persist: 'always',
      drop: 'off',
    },
  })
  const run = await store.create()
  const forProfile = (result: TestResult, id: string): TestResult => ({
    ...withDiagnosticEvidence(result),
    executionTargetProfile: { id },
  })

  await run.append(
    scenarioFinished(
      forProfile(
        resultWithArtifact('Persist passed evidence', 'passed', persistSource),
        'persist',
      ),
    ),
  )
  const liveDropped = await run.append(
    scenarioFinished(
      forProfile(
        resultWithArtifact('Drop failed evidence', 'failed', dropSource),
        'drop',
      ),
    ),
  )
  await run.append(
    scenarioFinished(
      forProfile(
        resultWithArtifact('Default failed evidence', 'failed', defaultSource),
        'default',
      ),
    ),
  )

  expect(liveDropped).toMatchObject({
    type: 'scenario-finished',
    attempt: {
      diagnostics: [{ message: 'Diagnostic for Drop failed evidence' }],
      steps: [{ artifacts: [{ path: dropSource }] }],
    },
  })
  const persisted = (await run.events()).filter(
    (event) => event.type === 'scenario-finished',
  )
  expect(persisted).toHaveLength(3)
  expect(persisted[0]).toMatchObject({
    attempt: {
      diagnostics: [{ message: 'Diagnostic for Persist passed evidence' }],
      steps: [
        { artifacts: [{ path: expect.stringContaining('/artifacts/') }] },
      ],
    },
  })
  expect(persisted[1]).toMatchObject({
    attempt: {
      evidenceAvailability: [
        { kind: 'screenshot', state: 'not-retained' },
        { kind: 'trace', state: 'not-supported' },
        { kind: 'recording', state: 'not-supported' },
        { kind: 'device-log', state: 'not-supported' },
        { kind: 'diagnostics', state: 'not-retained' },
      ],
      steps: [{}],
    },
  })
  expect(persisted[1]?.type).toBe('scenario-finished')
  if (persisted[1]?.type !== 'scenario-finished') {
    throw new Error('Expected persisted Scenario evidence')
  }
  expect(persisted[1].attempt.diagnostics).toBeUndefined()
  expect(persisted[1].attempt.steps[0]?.artifacts).toBeUndefined()
  expect(persisted[2]).toMatchObject({
    attempt: {
      diagnostics: [{ message: 'Diagnostic for Default failed evidence' }],
      steps: [
        { artifacts: [{ path: expect.stringContaining('/artifacts/') }] },
      ],
    },
  })
  expect((await run.materialize()).results).toHaveLength(3)
})

test('issue 83: an individual Test run overrides the profile Evidence persistence policy', async () => {
  const root = await tempRoot()
  const source = join(root, 'run-override.png')
  await Bun.write(source, new Uint8Array([137, 80, 78, 71]))
  const store = openTestRunStore({
    root,
    createId: () => 'run-evidence-override',
    evidencePersistenceByProfile: { chrome: 'off' },
  })
  const run = await store.create({ evidencePersistence: 'always' })
  const result = resultWithArtifact('Run override', 'passed', source)

  await run.append(
    scenarioFinished({
      ...result,
      executionTargetProfile: { id: 'chrome' },
    }),
  )

  const persisted = (await run.events()).at(-1)
  expect(persisted?.type).toBe('scenario-finished')
  if (persisted?.type !== 'scenario-finished') {
    throw new Error('Expected persisted Scenario evidence')
  }
  expect(persisted.attempt.steps[0]?.artifacts?.[0]?.path).toContain(
    '/artifacts/',
  )
})

test('issue 83: reopens an unfinished Test run with its Evidence persistence override', async () => {
  const root = await tempRoot()
  const source = join(root, 'reopened-run-override.png')
  await Bun.write(source, new Uint8Array([137, 80, 78, 71]))
  const store = openTestRunStore({
    root,
    createId: () => 'run-reopened-evidence-override',
    evidencePersistence: 'off',
  })
  const created = await store.create({ evidencePersistence: 'always' })
  const reopened = await openTestRunStoreBase({
    root,
    pickleHome: storageFor(root).pickleHome,
    evidencePersistence: 'off',
  }).open(created.id)

  await reopened.append(
    scenarioFinished(resultWithArtifact('Reopened override', 'passed', source)),
  )

  const persisted = (await reopened.events()).at(-1)
  expect(persisted?.type).toBe('scenario-finished')
  if (persisted?.type !== 'scenario-finished') {
    throw new Error('Expected persisted Scenario result')
  }
  expect(persisted.attempt.steps[0]?.artifacts?.[0]?.path).toContain(
    '/artifacts/',
  )
})

test('issue 83: a missing temporary artifact records capture failure and preserves committed evidence', async () => {
  const root = await tempRoot()
  const source = join(root, 'committed.png')
  const missing = join(root, 'missing.png')
  await Bun.write(source, new Uint8Array([137, 80, 78, 71]))
  const store = openTestRunStore({
    root,
    createId: () => 'run-capture-failure',
    evidencePersistence: 'always',
  })
  const run = await store.create()
  await run.append(
    scenarioFinished(
      resultWithArtifact('Committed evidence', 'passed', source),
    ),
  )
  const firstEvent = (await run.events()).at(-1)
  if (firstEvent?.type !== 'scenario-finished') {
    throw new Error('Expected committed Scenario evidence')
  }
  const committedPath = firstEvent.attempt.steps[0]?.artifacts?.[0]?.path
  if (!committedPath) throw new Error('Expected a committed Test artifact')
  const committedBytes = await Bun.file(committedPath).bytes()

  await run.append(
    scenarioFinished(resultWithArtifact('Missing evidence', 'failed', missing)),
  )

  const persisted = (await run.events()).at(-1)
  expect(persisted?.type).toBe('scenario-finished')
  if (persisted?.type !== 'scenario-finished') {
    throw new Error('Expected persisted Scenario result')
  }
  expect(persisted.attempt.steps[0]?.artifacts).toBeUndefined()
  expect(
    persisted.attempt.evidenceAvailability.find(
      (item) => item.kind === 'screenshot',
    ),
  ).toMatchObject({
    state: 'capture-failed',
    message: expect.stringContaining('missing.png'),
  })
  expect(await Bun.file(committedPath).bytes()).toEqual(committedBytes)
  expect(
    await Bun.file(
      join(storageFor(root).runsDirectory, run.id, '.evidence-staging'),
    ).exists(),
  ).toBe(false)
})

test('issue 83: failed event publication rolls back staged binary evidence', async () => {
  const root = await tempRoot()
  const source = join(root, 'rollback.png')
  await Bun.write(source, new Uint8Array([137, 80, 78, 71]))
  const store = openTestRunStore({
    root,
    createId: () => 'run-publication-rollback',
    evidencePersistence: 'always',
  })
  const run = await store.create()
  const runDirectory = join(storageFor(root).runsDirectory, run.id)
  const eventsPath = join(runDirectory, 'events.ndjson')
  await chmod(eventsPath, 0o444)
  try {
    await expect(
      run.append(
        scenarioFinished(
          resultWithArtifact('Rollback evidence', 'passed', source),
        ),
      ),
    ).rejects.toThrow()
  } finally {
    await chmod(eventsPath, 0o644)
  }

  expect([
    ...new Bun.Glob('**/*').scanSync({
      cwd: join(runDirectory, 'artifacts'),
      onlyFiles: true,
    }),
  ]).toEqual([])
  expect(await Bun.file(join(runDirectory, '.evidence-staging')).exists()).toBe(
    false,
  )
})

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

test('issue 77: artifact paths are contained and unique for repeated attempts', async () => {
  const root = await tempRoot()
  const firstScreenshot = join(root, 'first.png')
  const secondScreenshot = join(root, 'second.png')
  await Bun.write(firstScreenshot, 'first-attempt')
  await Bun.write(secondScreenshot, 'second-attempt')
  const store = openTestRunStore({
    root,
    createId: () => 'run-attempt-artifacts',
  })
  const run = await store.create()

  const firstResult = resultWithArtifact(
    'Pay for the order',
    'failed',
    firstScreenshot,
  )
  const secondBase = resultWithArtifact(
    'Pay for the order',
    'failed',
    secondScreenshot,
  )
  const secondAttempt = {
    ...requiredValue(secondBase.attempts[0]),
    attempt: 2,
  }
  const secondResult = {
    ...secondBase,
    attempts: [secondAttempt],
  }
  await run.append(scenarioFinished(firstResult))
  await run.append(scenarioFinished(secondResult))
  const manifest = await run.materialize()
  const artifactPaths = requiredValue(manifest.results[0]).attempts.map(
    (attempt) =>
      requiredValue(requiredValue(requiredValue(attempt.steps[0]).artifacts)[0])
        .path,
  )
  const artifactsDirectory = join(
    storageFor(root).runsDirectory,
    run.id,
    'artifacts',
  )

  expect(new Set(artifactPaths).size).toBe(2)
  expect(
    artifactPaths.every((path) => path.startsWith(`${artifactsDirectory}/`)),
  ).toBe(true)
  expect(await Bun.file(requiredValue(artifactPaths[0])).text()).toBe(
    'first-attempt',
  )
  expect(await Bun.file(requiredValue(artifactPaths[1])).text()).toBe(
    'second-attempt',
  )
})

test('issue 77: isolates artifact paths for concurrent Scenario Outline rows', async () => {
  const root = await tempRoot()
  const firstScreenshot = join(root, 'first-row.png')
  const secondScreenshot = join(root, 'second-row.png')
  await Bun.write(firstScreenshot, 'first-row')
  await Bun.write(secondScreenshot, 'second-row')
  const store = openTestRunStore({
    root,
    createId: () => 'run-outline-artifacts',
  })
  const run = await store.create()
  const first = resultWithArtifact(
    'Pay for the order',
    'failed',
    firstScreenshot,
  )
  const second = resultWithArtifact(
    'Pay for the order',
    'failed',
    secondScreenshot,
  )
  first.scenario.examplesRowId = 'row-card'
  second.scenario.examplesRowId = 'row-pix'

  await Promise.all([
    run.append(scenarioFinished(first)),
    run.append(scenarioFinished(second)),
  ])
  const manifest = await run.materialize()
  const paths: Record<string, string> = Object.fromEntries(
    manifest.results.map((result) => [
      result.scenario.examplesRowId,
      requiredValue(
        requiredValue(
          requiredValue(requiredValue(result.attempts[0]).steps[0]).artifacts,
        )[0],
      ).path,
    ]),
  )
  const artifactsDirectory = join(
    storageFor(root).runsDirectory,
    run.id,
    'artifacts',
  )

  expect(paths['row-card']).not.toBe(paths['row-pix'])
  expect(
    Object.values(paths).every((path) =>
      path.startsWith(`${artifactsDirectory}/`),
    ),
  ).toBe(true)
  expect(await Bun.file(requiredValue(paths['row-card'])).text()).toBe(
    'first-row',
  )
  expect(await Bun.file(requiredValue(paths['row-pix'])).text()).toBe(
    'second-row',
  )
})

test('issue 77: rejects duplicate attempt numbers for one Scenario identity', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-duplicate-attempt',
  })
  const run = await store.create()
  const result = passedResult('Pay for the order')

  await run.append(scenarioFinished(result))
  await run.append(
    scenarioFinished(
      withAttempt(result, {
        state: 'failed',
        message: 'Duplicate completion',
      }),
    ),
  )

  await expect(run.materialize()).rejects.toThrow(
    'Duplicate Scenario attempt 1',
  )
})

test('issue 77: a Scenario finish reuses its persisted step artifact', async () => {
  const root = await tempRoot()
  const screenshot = join(root, 'failure.png')
  await Bun.write(screenshot, 'one-copy')
  const store = openTestRunStore({
    root,
    createId: () => 'run-artifact-reuse',
  })
  const run = await store.create()
  const result = resultWithArtifact('Pay for the order', 'failed', screenshot)
  const attempt = requiredValue(result.attempts[0])
  const step = requiredValue(attempt.steps[0])
  const finishedStep = await run.append({
    type: 'step-finished',
    result: step,
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
    scope: {
      scenarioId: requiredValue(result.scenario.id),
      executionTargetProfileId: result.executionTargetProfile.id,
      attempt: attempt.attempt,
      stepIndex: step.index,
    },
  })
  await run.append(scenarioFinished(result))

  const manifest = await run.materialize()
  const manifestPath = requiredValue(
    requiredValue(
      requiredValue(
        requiredValue(requiredValue(manifest.results[0]).attempts[0]).steps[0],
      ).artifacts,
    )[0],
  ).path
  expect(finishedStep).toMatchObject({
    type: 'step-finished',
    result: { artifacts: [{ path: manifestPath }] },
  })
  expect([
    ...new Bun.Glob('**/*').scanSync({
      cwd: join(storageFor(root).runsDirectory, run.id, 'artifacts'),
      onlyFiles: true,
    }),
  ]).toHaveLength(1)
})

test('issue 77: rejects v1 runs with the resolved manual-removal path without changing bytes', async () => {
  const root = await tempRoot()
  const storage = storageFor(root)
  const legacyDirectory = join(storage.runsDirectory, 'run-v1')
  await mkdir(legacyDirectory, { recursive: true })
  const legacyEvents = `${JSON.stringify({
    schemaVersion: 1,
    sequence: 1,
    type: 'run-started',
    run: {
      id: 'run-v1',
      startedAt: '2026-08-01T00:00:00.000Z',
    },
  })}\n`
  const legacyManifest = `${JSON.stringify({
    schemaVersion: 1,
    id: 'run-v1',
    startedAt: '2026-08-01T00:00:00.000Z',
    state: 'passed',
    results: [],
  })}\n`
  const eventsPath = join(legacyDirectory, 'events.ndjson')
  const manifestPath = join(legacyDirectory, 'manifest.json')
  await Bun.write(eventsPath, legacyEvents)
  await Bun.write(manifestPath, legacyManifest)
  const store = openTestRunStore({ root })

  await expect(store.list()).rejects.toThrow(
    `Pickle did not modify it. Remove the runs directory manually and retry: ${storage.runsDirectory}`,
  )
  expect(await Bun.file(eventsPath).text()).toBe(legacyEvents)
  expect(await Bun.file(manifestPath).text()).toBe(legacyManifest)
})

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
