import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openTestRunStore } from '../index'
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

function passedResult(name = 'Complete a purchase'): TestResult {
  return {
    schemaVersion: 1,
    specification: {
      name: 'Checkout',
      uri: 'features/checkout.feature',
    },
    scenario: { name },
    executionTargetProfile: { id: 'deterministic' },
    state: 'passed',
    steps: [],
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

  await run.append({
    type: 'scenario-started',
    scenario: { name: 'Complete a purchase' },
  })
  await run.append({
    type: 'scenario-finished',
    result: passedResult(),
  })

  const eventsPath = join(
    root,
    '.pickle',
    'runs',
    'run-stable-id',
    'events.ndjson',
  )
  const firstSnapshot = await Bun.file(eventsPath).text()
  const firstEvents = await run.events()

  expect(firstEvents).toEqual([
    {
      schemaVersion: 1,
      sequence: 1,
      type: 'run-started',
      run: { id: 'run-stable-id', startedAt: '2026-08-15T12:00:00.000Z' },
    },
    {
      schemaVersion: 1,
      sequence: 2,
      type: 'scenario-started',
      scenario: { name: 'Complete a purchase' },
    },
    {
      schemaVersion: 1,
      sequence: 3,
      type: 'scenario-finished',
      result: passedResult(),
    },
  ])

  await run.append({
    type: 'scenario-started',
    scenario: { name: 'Pay for the order' },
  })

  const secondSnapshot = await Bun.file(eventsPath).text()
  expect(secondSnapshot.startsWith(firstSnapshot)).toBe(true)
  expect(firstSnapshot).not.toContain('Pay for the order')
  expect((await run.events()).map((event) => event.sequence)).toEqual([
    1, 2, 3, 4,
  ])
})

test('materializes a manifest from events without replacing the event stream', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-manifest',
    now: () => new Date('2026-08-15T12:00:00.000Z'),
  })
  const run = await store.create()
  await run.append({
    type: 'scenario-started',
    scenario: { name: 'Complete a purchase' },
  })
  await run.append({
    type: 'scenario-finished',
    result: passedResult(),
  })

  const eventsPath = join(
    root,
    '.pickle',
    'runs',
    'run-manifest',
    'events.ndjson',
  )
  const beforeManifest = await Bun.file(eventsPath).text()
  const manifest = await run.materialize()

  expect(manifest).toEqual({
    schemaVersion: 1,
    id: 'run-manifest',
    startedAt: '2026-08-15T12:00:00.000Z',
    finishedAt: '2026-08-15T12:00:00.000Z',
    state: 'passed',
    results: [passedResult()],
  })
  expect(await Bun.file(eventsPath).text()).toBe(beforeManifest)
  expect(
    await Bun.file(
      join(root, '.pickle', 'runs', 'run-manifest', 'manifest.json'),
    ).json(),
  ).toEqual(manifest)

  await run.append({
    type: 'scenario-finished',
    result: {
      ...passedResult('Pay for the order'),
      state: 'failed',
      message: 'Payment was declined',
    },
  })
  const afterAppend = await Bun.file(eventsPath).text()
  const updated = await run.materialize()

  expect(await Bun.file(eventsPath).text()).toBe(afterAppend)
  expect(afterAppend.startsWith(beforeManifest)).toBe(true)
  expect(updated.state).toBe('failed')
  expect(updated.results.map((result) => result.scenario.name)).toEqual([
    'Complete a purchase',
    'Pay for the order',
  ])
})

test('an in-progress manifest omits finishedAt until the test run finishes', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-live',
    now: () => new Date('2026-08-15T12:00:00.000Z'),
  })
  const run = await store.create()
  await run.append({
    type: 'scenario-finished',
    result: passedResult(),
  })

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
    type: 'scenario-finished',
    scheduleIndex: 1,
    result: {
      ...passedResult('Second scenario'),
      specification: {
        name: 'Search',
        uri: 'features/search.feature',
      },
    },
  })
  await run.append({
    type: 'scenario-finished',
    scheduleIndex: 0,
    result: passedResult('First scenario'),
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
  await first.append({
    type: 'scenario-finished',
    result: passedResult(),
  })
  await first.materialize()

  const second = await store.create()
  await second.append({
    type: 'scenario-finished',
    result: {
      ...passedResult('Retry the purchase'),
      state: 'failed',
      message: 'Payment was declined',
    },
  })
  await second.materialize()

  const summaries = await store.list()
  expect(summaries).toEqual([
    {
      id: 'run-1',
      startedAt: '2026-08-15T12:00:00.000Z',
      finishedAt: '2026-08-15T12:00:00.000Z',
      state: 'passed',
      resultCount: 1,
    },
    {
      id: 'run-2',
      startedAt: '2026-08-15T12:00:00.000Z',
      finishedAt: '2026-08-15T12:00:00.000Z',
      state: 'failed',
      resultCount: 1,
    },
  ])

  await rm(join(root, '.pickle', 'index.sqlite'), { force: true })
  await store.rebuildIndex()
  expect(await store.list()).toEqual(summaries)
})

test('rebuilds the query index from an events-only test run', async () => {
  const root = await tempRoot()
  const store = openTestRunStore({
    root,
    createId: () => 'run-recovered',
    now: () => new Date('2026-08-15T12:00:00.000Z'),
  })
  const run = await store.create()
  await run.append({
    type: 'scenario-finished',
    result: passedResult(),
  })
  await rm(join(root, '.pickle', 'runs', 'run-recovered', 'manifest.json'), {
    force: true,
  })
  await rm(join(root, '.pickle', 'index.sqlite'), { force: true })

  await store.rebuildIndex()
  expect(await store.list()).toEqual([
    {
      id: 'run-recovered',
      startedAt: '2026-08-15T12:00:00.000Z',
      state: 'passed',
      resultCount: 1,
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
    {
      ...passedResult('Adapted purchase'),
      state: 'passed-with-adaptation' as const,
    },
    {
      ...passedResult('Failed purchase'),
      state: 'failed' as const,
      message: 'Payment was declined',
    },
    {
      ...passedResult('Skipped purchase'),
      state: 'skipped' as const,
      message: 'Scenario is tagged @ignore',
    },
    {
      ...passedResult('Cancelled purchase'),
      state: 'cancelled' as const,
      message: 'Scenario cancelled',
    },
    {
      ...passedResult('Unavailable purchase'),
      state: 'infrastructure-error' as const,
      message: 'Browser process exited',
    },
    {
      ...passedResult('Flaky purchase'),
      attempts: 2,
      flaky: true,
    },
  ]
  for (const result of states) {
    await run.append({ type: 'scenario-finished', result })
  }

  const manifest = await run.materialize()
  expect(
    manifest.results.map((result) => [result.state, result.flaky]),
  ).toEqual([
    ['passed', undefined],
    ['passed-with-adaptation', undefined],
    ['failed', undefined],
    ['skipped', undefined],
    ['cancelled', undefined],
    ['infrastructure-error', undefined],
    ['passed', true],
  ])
  expect(manifest.state).toBe('infrastructure-error')
  expect(new Set(manifest.results.map((result) => result.state))).toEqual(
    new Set([
      'passed',
      'passed-with-adaptation',
      'failed',
      'skipped',
      'cancelled',
      'infrastructure-error',
    ]),
  )
})

test('captures failure and adaptation artifacts according to the configured policy', async () => {
  const root = await tempRoot()
  const screenshot = join(root, 'source-screenshot.png')
  await Bun.write(screenshot, new Uint8Array([137, 80, 78, 71]))
  const store = openTestRunStore({
    root,
    createId: () => 'run-artifacts',
    artifactCapture: 'on-failure-or-adaptation',
  })
  const run = await store.create()

  await run.append({
    type: 'scenario-finished',
    result: resultWithArtifact('Passed purchase', 'passed', screenshot),
  })
  await run.append({
    type: 'scenario-finished',
    result: resultWithArtifact(
      'Adapted purchase',
      'passed-with-adaptation',
      screenshot,
    ),
  })
  await run.append({
    type: 'scenario-finished',
    result: {
      ...resultWithArtifact('Failed purchase', 'failed', screenshot),
      steps: [
        {
          step: {
            keyword: 'Given',
            text: 'a product is in the basket',
            type: 'context',
          },
          state: 'passed',
          resolvedActions: [],
          artifacts: [
            { kind: 'screenshot', path: screenshot, mediaType: 'image/png' },
          ],
        },
        resultWithArtifact('Failed purchase', 'failed', screenshot).steps[0]!,
      ],
    },
  })

  const manifest = await run.materialize()
  const [passed, adapted, failed] = manifest.results
  const artifactsDirectory = join(
    root,
    '.pickle',
    'runs',
    'run-artifacts',
    'artifacts',
  )

  expect(passed?.steps[0]?.artifacts).toBeUndefined()
  expect(adapted?.steps[0]?.artifacts?.[0]).toMatchObject({
    kind: 'screenshot',
    mediaType: 'image/png',
  })
  expect(
    adapted?.steps[0]?.artifacts?.[0]?.path.startsWith(artifactsDirectory),
  ).toBe(true)
  expect(
    failed?.steps[0]?.artifacts?.[0]?.path.startsWith(artifactsDirectory),
  ).toBe(true)
  expect(
    failed?.steps[1]?.artifacts?.[0]?.path.startsWith(artifactsDirectory),
  ).toBe(true)
  expect(
    await Bun.file(adapted!.steps[0]!.artifacts![0]!.path).bytes(),
  ).toEqual(new Uint8Array([137, 80, 78, 71]))
  expect(await Bun.file(screenshot).exists()).toBe(true)
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
  await expired.append({
    type: 'scenario-finished',
    result: passedResult('Expired purchase'),
  })
  await expired.materialize()

  clock = new Date('2026-08-15T00:00:00.000Z')
  const retained = await store.create()
  await retained.append({
    type: 'scenario-finished',
    result: passedResult('Retained purchase'),
  })
  await retained.materialize()

  const retainedDirectory = join(root, '.pickle', 'runs', 'run-2')
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
      join(root, '.pickle', 'runs', 'run-1', 'events.ndjson'),
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
      startedAt: '2026-08-15T00:00:00.000Z',
      finishedAt: '2026-08-15T00:00:00.000Z',
      state: 'passed',
      resultCount: 1,
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
  await source.append({
    type: 'scenario-finished',
    result: passedResult(),
  })
  const sourceManifest = await source.materialize()
  const sourceEvents = await Bun.file(
    join(root, '.pickle', 'runs', source.id, 'events.ndjson'),
  ).text()

  const rerun = await store.create({ sourceRunId: source.id })
  await rerun.append({
    type: 'scenario-finished',
    result: passedResult(),
  })
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
      join(root, '.pickle', 'runs', source.id, 'events.ndjson'),
    ).text(),
  ).toBe(sourceEvents)
  expect(
    await Bun.file(
      join(root, '.pickle', 'runs', source.id, 'manifest.json'),
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
  await first.append({
    type: 'scenario-finished',
    result: passedResult('First purchase'),
  })
  await first.materialize()
  const second = await store.create()
  await second.append({
    type: 'scenario-finished',
    result: passedResult('Second purchase'),
  })
  await second.materialize()
  const retainedEvents = await Bun.file(
    join(root, '.pickle', 'runs', 'run-2', 'events.ndjson'),
  ).text()

  const result = await store.applyRetention({ maxBytes: 1 })

  expect(result.removed).toEqual(['run-1'])
  expect(
    await Bun.file(
      join(root, '.pickle', 'runs', 'run-2', 'events.ndjson'),
    ).text(),
  ).toBe(retainedEvents)
  expect(await store.list()).toEqual([
    {
      id: 'run-2',
      startedAt: '2026-08-15T00:00:00.000Z',
      finishedAt: '2026-08-15T00:00:00.000Z',
      state: 'passed',
      resultCount: 1,
    },
  ])
})

function resultWithArtifact(
  name: string,
  state: TestResult['state'],
  path: string,
): TestResult {
  return {
    ...passedResult(name),
    state,
    steps: [
      {
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
  }
}
