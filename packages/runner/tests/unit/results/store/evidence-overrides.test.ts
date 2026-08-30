import { chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { openTestRunStore as openTestRunStoreBase } from '../../../../index'
import type { TestResult } from '../../../../src/execution/run-scenario'
import {
  openTestRunStore,
  resultWithArtifact,
  scenarioFinished,
  storageFor,
  tempRoot,
  withDiagnosticEvidence,
} from './fixtures'

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
