import { Database } from 'bun:sqlite'
import { afterEach, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  openTestRunStore as openTestRunStoreBase,
  resolveLocalProjectStorage,
  type TestRunStoreOptions,
} from '../index'
import type { TestResult } from './run-scenario'

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
  const attempt = result.attempts.at(attemptIndex)!
  return {
    type: 'scenario-finished' as const,
    specification: result.specification,
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
    scope: {
      scenarioId: result.scenario.id!,
      examplesRowId: result.scenario.examplesRowId,
      executionTargetProfileId: result.executionTargetProfile.id,
      attempt: attempt.attempt,
    },
    attempt,
  }
}

function scenarioStarted(result: TestResult) {
  const attempt = result.attempts[0]!
  return {
    type: 'scenario-started' as const,
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
    scope: {
      scenarioId: result.scenario.id!,
      examplesRowId: result.scenario.examplesRowId,
      executionTargetProfileId: result.executionTargetProfile.id,
      attempt: attempt.attempt,
    },
  }
}

function withAttempt(
  result: TestResult,
  patch: Partial<TestResult['attempts'][number]>,
): TestResult {
  const attempt = { ...result.attempts[0]!, ...patch }
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
  } = result.attempts[0]!
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
  const attempt = result.attempts[0]!
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
    ...base.attempts[0]!,
    attempt: 1,
    state: 'failed' as const,
    executionMode: 'replay' as const,
    inferenceCount: 1,
    evidenceAvailability,
  }
  const adaptiveAttempt = {
    ...base.attempts[0]!,
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
  const failedAttempt = failedResult.attempts[0]!
  await run.append(
    scenarioFinished({
      ...failedResult,
      attempts: [
        {
          ...failedAttempt,
          steps: [
            {
              ...failedAttempt.steps[0]!,
              index: 0,
              step: {
                keyword: 'Given',
                text: 'a product is in the basket',
                type: 'context',
              },
              state: 'passed',
            },
            { ...failedAttempt.steps[0]!, index: 1 },
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
    await Bun.file(failed!.attempts[0]!.steps[1]!.artifacts![0]!.path).bytes(),
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
  const passedAttempt = passed.attempts[0]!
  const failedAttempt = failed.attempts[0]!

  await run.append(
    scenarioFinished({
      ...passed,
      attempts: [
        {
          ...passedAttempt,
          evidenceAvailability: passedAttempt.evidenceAvailability.map(
            (item) =>
              item.kind === 'diagnostics' || item.kind === 'trace'
                ? { kind: item.kind, state: 'available' as const }
                : item,
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
          evidenceAvailability: failedAttempt.evidenceAvailability.map(
            (item) =>
              item.kind === 'diagnostics' || item.kind === 'trace'
                ? { kind: item.kind, state: 'available' as const }
                : item,
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
  const retainedEvents = await Bun.file(
    join(storageFor(root).runsDirectory, 'run-2', 'events.ndjson'),
  ).text()

  const result = await store.applyRetention({ maxBytes: 1 })

  expect(result.removed).toEqual(['run-1'])
  expect(
    await Bun.file(
      join(storageFor(root).runsDirectory, 'run-2', 'events.ndjson'),
    ).text(),
  ).toBe(retainedEvents)
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

function resultWithArtifact(
  name: string,
  state: TestResult['state'],
  path: string,
): TestResult {
  const result = passedResult(name)
  const attempt = result.attempts[0]!
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
      handles[index % handles.length]!.append({
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
    ...secondBase.attempts[0]!,
    attempt: 2,
  }
  const secondResult = {
    ...secondBase,
    attempts: [secondAttempt],
  }
  await run.append(scenarioFinished(firstResult))
  await run.append(scenarioFinished(secondResult))
  const manifest = await run.materialize()
  const artifactPaths = manifest.results[0]!.attempts.map(
    (attempt) => attempt.steps[0]!.artifacts![0]!.path,
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
  expect(await Bun.file(artifactPaths[0]!).text()).toBe('first-attempt')
  expect(await Bun.file(artifactPaths[1]!).text()).toBe('second-attempt')
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
      result.attempts[0]!.steps[0]!.artifacts![0]!.path,
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
  expect(await Bun.file(paths['row-card']!).text()).toBe('first-row')
  expect(await Bun.file(paths['row-pix']!).text()).toBe('second-row')
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
  const attempt = result.attempts[0]!
  const step = attempt.steps[0]!
  const finishedStep = await run.append({
    type: 'step-finished',
    result: step,
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
    scope: {
      scenarioId: result.scenario.id!,
      executionTargetProfileId: result.executionTargetProfile.id,
      attempt: attempt.attempt,
      stepIndex: step.index,
    },
  })
  await run.append(scenarioFinished(result))

  const manifest = await run.materialize()
  const manifestPath =
    manifest.results[0]!.attempts[0]!.steps[0]!.artifacts![0]!.path
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
