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

test('issue 77: rejects escaping artifact references before writing', async () => {
  const root = await tempRoot()
  try {
    const archivePath = join(root, 'reference-traversal.archive.json')
    const result = failedResultWithArtifact('../../victim.txt')
    const attempt = requiredValue(result.attempts[0])
    await Bun.write(
      archivePath,
      JSON.stringify({
        schemaVersion: 2,
        kind: 'run-archive',
        manifest: {
          schemaVersion: 2,
          id: 'run-reference-traversal',
          startedAt: '2026-08-22T12:00:00.000Z',
          finishedAt: '2026-08-22T12:00:00.012Z',
          state: 'failed',
          results: [result],
        },
        events: [
          {
            schemaVersion: 2,
            sequence: 1,
            occurredAt: '2026-08-22T12:00:00.000Z',
            type: 'run-started',
            run: {
              id: 'run-reference-traversal',
              startedAt: '2026-08-22T12:00:00.000Z',
            },
          },
          {
            schemaVersion: 2,
            sequence: 2,
            occurredAt: '2026-08-22T12:00:00.012Z',
            type: 'scenario-finished',
            specification: result.specification,
            scenario: result.scenario,
            executionTargetProfile: result.executionTargetProfile,
            scope: {
              scenarioId: result.scenario.id,
              executionTargetProfileId: result.executionTargetProfile.id,
              attempt: attempt.attempt,
            },
            attempt,
          },
        ],
        artifacts: [
          {
            path: '../../victim.txt',
            content: Buffer.from('victim').toString('base64'),
          },
        ],
      }),
    )

    await expect(importRunArchive({ root, archivePath })).rejects.toThrow(
      'Artifact path must stay inside the imported test run',
    )
    expect(
      await Bun.file(
        join(storageFor(root).runsDirectory, 'run-reference-traversal'),
      ).exists(),
    ).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('issue 77: rejects unfinished archives before mutating any destination', async () => {
  const sourceRoot = await tempRoot()
  const targetRoot = await tempRoot()
  try {
    const store = openTestRunStore({
      root: sourceRoot,
      createId: () => 'run-unfinished',
    })
    const run = await store.create()
    await run.append(scenarioFinished(passedResult()))
    const eventsPath = join(
      storageFor(sourceRoot).runsDirectory,
      run.id,
      'events.ndjson',
    )
    const eventsBefore = await Bun.file(eventsPath).text()
    const outputPath = join(sourceRoot, 'unfinished-export.json')

    await expect(
      writeRunArchive({ root: sourceRoot, runId: run.id, outputPath }),
    ).rejects.toThrow('must be finalized')
    expect(await Bun.file(outputPath).exists()).toBe(false)
    expect(await Bun.file(eventsPath).text()).toBe(eventsBefore)

    const archivePath = join(sourceRoot, 'unfinished-input.json')
    const archive = emptyArchive('run-unfinished-input')
    const { finishedAt: _finishedAt, ...unfinishedManifest } = archive.manifest
    const source = `${JSON.stringify({
      ...archive,
      manifest: unfinishedManifest,
    })}\n`
    await Bun.write(archivePath, source)

    await expect(readRunArchive(archivePath)).rejects.toThrow(
      'must be finalized',
    )
    await expect(
      importRunArchive({ root: targetRoot, archivePath }),
    ).rejects.toThrow('must be finalized')
    expect(await Bun.file(archivePath).text()).toBe(source)
    expect(await Bun.file(storageFor(targetRoot).runsDirectory).exists()).toBe(
      false,
    )
    expect(
      await Bun.file(storageFor(targetRoot).archivesDirectory).exists(),
    ).toBe(false)
  } finally {
    await Promise.all(
      [sourceRoot, targetRoot].map((root) =>
        rm(root, { recursive: true, force: true }),
      ),
    )
  }
})

test('issue 77: export rejects a missing artifact source without writing output', async () => {
  const root = await tempRoot()
  try {
    const screenshot = join(root, 'source.png')
    await Bun.write(screenshot, 'source-bytes')
    const store = openTestRunStore({
      root,
      createId: () => 'run-missing-artifact-source',
    })
    const run = await store.create()
    await run.append(scenarioFinished(failedResultWithArtifact(screenshot)))
    const manifest = await run.materialize()
    const persistedPath = requiredValue(
      requiredValue(
        requiredValue(
          requiredValue(requiredValue(manifest.results[0]).attempts[0])
            .steps[0],
        ).artifacts,
      )[0],
    ).path
    await rm(persistedPath)
    const outputPath = join(root, 'missing-source', 'archive.json')

    await expect(
      writeRunArchive({ root, runId: run.id, outputPath }),
    ).rejects.toThrow('Artifact source file is missing')
    expect(await Bun.file(outputPath).exists()).toBe(false)
    expect(await Bun.file(join(root, 'missing-source')).exists()).toBe(false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
