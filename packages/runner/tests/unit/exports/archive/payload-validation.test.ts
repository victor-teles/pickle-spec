import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { readRunArchive } from '../../../../index'
import {
  archiveWithResult,
  emptyArchive,
  failedResultWithArtifact,
  importRunArchive,
  storageFor,
  tempRoot,
} from './fixtures'

test('issue 77: rejects an artifact reference without an embedded payload', async () => {
  const sourceRoot = await tempRoot()
  const targetRoot = await tempRoot()
  try {
    const archivePath = join(sourceRoot, 'missing-payload.json')
    const result = failedResultWithArtifact('artifacts/missing.png')
    const source = `${JSON.stringify(archiveWithResult('run-missing-payload', result))}\n`
    await Bun.write(archivePath, source)

    await expect(readRunArchive(archivePath)).rejects.toThrow(
      'requires exactly one embedded payload',
    )
    await expect(
      importRunArchive({ root: targetRoot, archivePath }),
    ).rejects.toThrow('requires exactly one embedded payload')
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

test('issue 77: rejects an orphan embedded artifact payload', async () => {
  const sourceRoot = await tempRoot()
  const targetRoot = await tempRoot()
  try {
    const archivePath = join(sourceRoot, 'orphan-payload.json')
    const source = `${JSON.stringify({
      ...emptyArchive('run-orphan-payload'),
      artifacts: [
        {
          path: 'artifacts/orphan.png',
          content: Buffer.from('orphan').toString('base64'),
        },
      ],
    })}\n`
    await Bun.write(archivePath, source)

    await expect(readRunArchive(archivePath)).rejects.toThrow(
      'has no manifest or event reference',
    )
    await expect(
      importRunArchive({ root: targetRoot, archivePath }),
    ).rejects.toThrow('has no manifest or event reference')
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

test('issue 77: rejects invalid base64 artifact payloads', async () => {
  const sourceRoot = await tempRoot()
  const targetRoot = await tempRoot()
  try {
    const archivePath = join(sourceRoot, 'invalid-base64.json')
    const result = failedResultWithArtifact('artifacts/invalid.png')
    const source = `${JSON.stringify({
      ...archiveWithResult('run-invalid-base64', result),
      artifacts: [
        { path: 'artifacts/invalid.png', content: 'not+canonical===' },
      ],
    })}\n`
    await Bun.write(archivePath, source)

    await expect(readRunArchive(archivePath)).rejects.toThrow(
      'must be valid base64',
    )
    await expect(
      importRunArchive({ root: targetRoot, archivePath }),
    ).rejects.toThrow('must be valid base64')
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
