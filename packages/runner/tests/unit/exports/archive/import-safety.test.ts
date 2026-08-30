import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  emptyArchive,
  importRunArchive,
  storageFor,
  tempRoot,
} from './fixtures'

test('import refuses to overwrite an existing immutable run or retained archive', async () => {
  const root = await tempRoot()
  try {
    const archivePath = join(root, 'run-archive.json')
    const archive = emptyArchive('run-existing')
    const original = `${JSON.stringify(archive)}\n`
    await Bun.write(archivePath, original)
    const imported = await importRunArchive({ root, archivePath })
    const eventsPath = join(
      storageFor(root).runsDirectory,
      'run-existing',
      'events.ndjson',
    )
    const eventsBefore = await Bun.file(eventsPath).text()
    const archiveBefore = await Bun.file(imported.preservedArchivePath).text()
    await Bun.write(archivePath, original)

    await expect(importRunArchive({ root, archivePath })).rejects.toThrow(
      'Test run "run-existing" already exists',
    )
    expect(await Bun.file(eventsPath).text()).toBe(eventsBefore)
    expect(await Bun.file(imported.preservedArchivePath).text()).toBe(
      archiveBefore,
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('concurrent imports reserve an immutable run before writing it', async () => {
  const root = await tempRoot()
  try {
    const archivePath = join(root, 'run-archive.json')
    const archive = emptyArchive('run-concurrent')
    const original = `${JSON.stringify(archive)}\n`
    await Bun.write(archivePath, original)

    const imports = await Promise.allSettled([
      importRunArchive({ root, archivePath }),
      importRunArchive({ root, archivePath }),
    ])

    expect(
      imports.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1)
    const rejected = imports.find((result) => result.status === 'rejected')
    expect(rejected).toMatchObject({
      reason: new Error('Test run "run-concurrent" already exists'),
    })
    expect(
      await Bun.file(
        join(storageFor(root).archivesDirectory, 'run-concurrent.json'),
      ).text(),
    ).toBe(original)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('import rejects run identifiers and artifact paths that escape the run directory', async () => {
  const root = await tempRoot()
  try {
    const existingDirectory = join(
      storageFor(root).runsDirectory,
      'run-existing',
    )
    const existingEventsPath = join(existingDirectory, 'events.ndjson')
    await mkdir(existingDirectory, { recursive: true })
    await Bun.write(existingEventsPath, 'immutable\n')
    const archivePath = join(root, 'unsafe-archive.json')
    const unsafeArtifact = {
      ...emptyArchive('run-imported'),
      artifacts: [
        {
          path: '../run-existing/events.ndjson',
          content: Buffer.from('rewritten\n').toString('base64'),
        },
      ],
    }
    await Bun.write(archivePath, JSON.stringify(unsafeArtifact))

    await expect(importRunArchive({ root, archivePath })).rejects.toThrow(
      'Artifact path must stay inside the imported test run',
    )
    expect(await Bun.file(existingEventsPath).text()).toBe('immutable\n')

    await Bun.write(
      archivePath,
      JSON.stringify({
        ...unsafeArtifact,
        manifest: { ...unsafeArtifact.manifest, id: '../run-escaped' },
        artifacts: [],
      }),
    )
    await expect(importRunArchive({ root, archivePath })).rejects.toThrow(
      'Invalid test run identifier',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
