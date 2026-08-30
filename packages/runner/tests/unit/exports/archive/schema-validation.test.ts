import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { readRunArchive } from '../../../../index'
import { emptyArchive, passedResult, tempRoot } from './fixtures'

test('archive parsing rejects result states outside the public contract', async () => {
  const root = await tempRoot()
  try {
    const archivePath = join(root, 'invalid-result-state.json')
    await Bun.write(
      archivePath,
      JSON.stringify({
        ...emptyArchive('run-invalid-state'),
        manifest: {
          schemaVersion: 2,
          id: 'run-invalid-state',
          startedAt: '2026-08-01T00:00:00.000Z',
          state: 'unknown-state',
          results: [],
        },
      }),
    )

    await expect(readRunArchive(archivePath)).rejects.toThrow(
      'must be a current result state',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('archive parsing rejects invalid or inconsistent evidence timing', async () => {
  const root = await tempRoot()
  try {
    const archivePath = join(root, 'invalid-evidence-timing.json')
    const archive = emptyArchive('run-invalid-timing')
    await Bun.write(
      archivePath,
      JSON.stringify({
        ...archive,
        manifest: { ...archive.manifest, startedAt: 'not-a-timestamp' },
      }),
    )
    await expect(readRunArchive(archivePath)).rejects.toThrow(
      'Invalid ISO datetime',
    )

    const result = passedResult()
    await Bun.write(
      archivePath,
      JSON.stringify({
        ...archive,
        manifest: {
          ...archive.manifest,
          results: [{ ...result, durationMs: result.durationMs + 1 }],
        },
      }),
    )
    await expect(readRunArchive(archivePath)).rejects.toThrow(
      'durationMs must match startedAt and finishedAt',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
