import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { type PlanUse, readRunArchive } from '../../../../index'
import { requiredValue } from '../../../../src/required-value'
import {
  emptyArchive,
  failedResultWithArtifact,
  importRunArchive,
  openTestRunStore,
  passedResult,
  scenarioFinished,
  storageFor,
  tempRoot,
  writeRunArchive,
} from './fixtures'

test('preserves authored validation provenance through persistence and archive import', async () => {
  const sourceRoot = await tempRoot()
  const targetRoot = await tempRoot()
  const planUse: PlanUse = {
    revisionId: 'a'.repeat(64),
    selectionDigest: null,
    key: {
      projectKey: 'source-project',
      scenarioId: 'scnpurchasebbbbbb',
      scenarioRevision: 'b'.repeat(64),
      executionTargetProfileId: 'deterministic',
      targetConfigurationFingerprint: 'target-configuration',
      applicationRevision: 'app-revision',
      adapterKind: 'web',
      adapterCacheSchemaVersion: '1',
    },
    payloadDigest: 'c'.repeat(64),
    author: { kind: 'human', id: 'reviewer' },
    origin: { kind: 'cache-capture', payloadDigest: 'd'.repeat(64) },
    purpose: 'validation',
    validationId: null,
  }
  try {
    const store = openTestRunStore({ root: sourceRoot })
    const run = await store.create()
    const result = passedResult()
    result.schemaVersion = 3
    const attempt = requiredValue(result.attempts[0])
    attempt.planUse = planUse
    delete attempt.cacheOutcome
    await run.append(scenarioFinished(result))
    const manifest = await run.materialize()
    expect(manifest.schemaVersion).toBe(3)
    expect(manifest.results[0]).toMatchObject({
      schemaVersion: 3,
      attempts: [{ planUse }],
    })
    const reopened = await store.open(run.id)
    expect(await reopened.materialize()).toEqual(manifest)
    expect((await reopened.events()).at(-1)).toMatchObject({
      schemaVersion: 3,
      attempt: { planUse },
    })
    const archivePath = join(sourceRoot, 'validation.archive.json')
    await writeRunArchive({
      root: sourceRoot,
      runId: run.id,
      outputPath: archivePath,
    })
    const archive = await readRunArchive(archivePath)
    expect(archive.schemaVersion).toBe(3)
    expect(archive.manifest).toEqual(manifest)
    expect(archive.events[0]?.schemaVersion).toBe(2)
    expect(archive.events.at(-1)?.schemaVersion).toBe(3)
    const imported = await importRunArchive({ root: targetRoot, archivePath })
    expect(imported.manifest).toEqual(manifest)
    expect(
      imported.manifest.results[0]?.attempts[0]?.cacheOutcome,
    ).toBeUndefined()
    expect(imported.manifest.results[0]?.attempts[0]?.planUse).toEqual(planUse)
    expect(
      (
        await (
          await openTestRunStore({ root: targetRoot }).open(run.id)
        ).events()
      ).at(-1),
    ).toMatchObject({
      schemaVersion: 3,
      attempt: { planUse },
    })
  } finally {
    await Promise.all(
      [sourceRoot, targetRoot].map((root) =>
        rm(root, { recursive: true, force: true }),
      ),
    )
  }
})

test('issue 77: exports and imports a schema-v2 archive with contained artifact paths', async () => {
  const sourceRoot = await tempRoot()
  const targetRoot = await tempRoot()
  try {
    const screenshot = join(sourceRoot, 'failure.png')
    await Bun.write(screenshot, 'failure-evidence')
    const store = openTestRunStore({
      root: sourceRoot,
      createId: () => 'run-schema-v2-archive',
      now: () => new Date('2026-08-22T12:00:00.000Z'),
    })
    const run = await store.create()
    await run.append(scenarioFinished(failedResultWithArtifact(screenshot)))
    await run.materialize()
    const archivePath = join(sourceRoot, 'run.archive.json')

    await writeRunArchive({
      root: sourceRoot,
      runId: run.id,
      outputPath: archivePath,
    })
    const archiveSource = await Bun.file(archivePath).text()
    const archive = await readRunArchive(archivePath)

    expect(archive.schemaVersion).toBe(2)
    expect(archive.manifest.schemaVersion).toBe(2)
    expect(archive.events.every((event) => event.schemaVersion === 2)).toBe(
      true,
    )
    expect(archive.artifacts).toHaveLength(1)
    expect(
      requiredValue(archive.artifacts[0]).path.startsWith('artifacts/'),
    ).toBe(true)
    expect(archiveSource).not.toContain(storageFor(sourceRoot).pickleHome)

    const imported = await importRunArchive({
      root: targetRoot,
      archivePath,
    })
    const importedPath = requiredValue(
      requiredValue(
        requiredValue(
          requiredValue(requiredValue(imported.manifest.results[0]).attempts[0])
            .steps[0],
        ).artifacts,
      )[0],
    ).path
    expect(
      requiredValue(
        requiredValue(
          requiredValue(requiredValue(imported.manifest.results[0]).attempts[0])
            .steps[0],
        ).artifacts,
      )[0],
    ).toMatchObject({
      name: 'failure.png',
      capturedAt: '2026-08-15T12:00:00.012Z',
      sizeBytes: 16,
      mediaType: 'image/png',
    })
    const targetArtifacts = join(
      storageFor(targetRoot).runsDirectory,
      run.id,
      'artifacts',
    )
    expect(importedPath.startsWith(`${targetArtifacts}/`)).toBe(true)
    expect(await Bun.file(importedPath).text()).toBe('failure-evidence')
    await expect(
      (await openTestRunStore({ root: targetRoot }).open(run.id)).events(),
    ).resolves.toEqual(imported.events)
  } finally {
    await Promise.all(
      [sourceRoot, targetRoot].map((root) =>
        rm(root, { recursive: true, force: true }),
      ),
    )
  }
})

test('issue 77: rejects a v1 archive without changing it or creating local storage', async () => {
  const root = await tempRoot()
  try {
    const archivePath = join(root, 'run-v1.archive.json')
    const source = `${JSON.stringify({
      schemaVersion: 1,
      kind: 'run-archive',
      manifest: {
        schemaVersion: 1,
        id: 'run-v1-archive',
        startedAt: '2026-08-01T00:00:00.000Z',
        state: 'passed',
        results: [],
      },
      events: [
        {
          schemaVersion: 1,
          sequence: 1,
          type: 'run-started',
          run: {
            id: 'run-v1-archive',
            startedAt: '2026-08-01T00:00:00.000Z',
          },
        },
      ],
      artifacts: [],
    })}\n`
    await Bun.write(archivePath, source)
    const storage = storageFor(root)

    await expect(importRunArchive({ root, archivePath })).rejects.toThrow(
      'schema version 1',
    )
    expect(await Bun.file(archivePath).text()).toBe(source)
    expect(await Bun.file(storage.runsDirectory).exists()).toBe(false)
    expect(await Bun.file(storage.archivesDirectory).exists()).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('issue 77: rejects contradictory manifest and event evidence before writing', async () => {
  const root = await tempRoot()
  try {
    const archivePath = join(root, 'contradictory.archive.json')
    const archive = emptyArchive('run-contradictory')
    const source = `${JSON.stringify({
      ...archive,
      manifest: {
        ...archive.manifest,
        results: [passedResult()],
      },
    })}\n`
    await Bun.write(archivePath, source)
    const storage = storageFor(root)

    await expect(readRunArchive(archivePath)).rejects.toThrow(
      'manifest results must match its Run events',
    )
    await expect(importRunArchive({ root, archivePath })).rejects.toThrow(
      'manifest results must match its Run events',
    )
    expect(await Bun.file(archivePath).text()).toBe(source)
    expect(await Bun.file(storage.runsDirectory).exists()).toBe(false)
    expect(await Bun.file(storage.archivesDirectory).exists()).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
