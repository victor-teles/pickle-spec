import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { requiredValue } from '../../../../src/required-value'
import {
  openTestRunStore,
  passedResult,
  resultWithArtifact,
  scenarioFinished,
  storageFor,
  tempRoot,
  withAttempt,
} from './fixtures'

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
