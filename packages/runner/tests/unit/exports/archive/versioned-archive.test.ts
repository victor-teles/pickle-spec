import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { readRunArchive } from '../../../../index'
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
