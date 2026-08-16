import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  importRunArchive,
  openTestRunStore,
  readRunArchive,
  writeRunArchive,
} from '../index'
import type { TestResult } from './run-scenario'

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pickle-archive-'))
}

function passedResult(): TestResult {
  return {
    schemaVersion: 1,
    specification: {
      name: 'Checkout',
      uri: 'features/checkout.feature',
    },
    scenario: { name: 'Complete a purchase', id: 'scnpurchasebbbbbb' },
    executionTargetProfile: { id: 'deterministic' },
    state: 'passed',
    steps: [],
    durationMs: 12,
  }
}

test('writeRunArchive preserves events, manifests, and selected test artifacts', async () => {
  const root = await tempRoot()
  try {
    const store = openTestRunStore({
      root,
      createId: () => 'run-archive',
      now: () => new Date('2026-08-15T12:00:00.000Z'),
    })
    const artifactSource = join(root, 'source.png')
    await Bun.write(artifactSource, 'png-bytes')
    const run = await store.create()
    await run.append({
      type: 'scenario-finished',
      result: {
        ...passedResult(),
        state: 'failed',
        steps: [
          {
            step: {
              keyword: 'Then',
              text: 'the purchase succeeds',
              type: 'outcome',
            },
            state: 'failed',
            resolvedActions: [],
            artifacts: [
              {
                kind: 'screenshot',
                path: artifactSource,
                mediaType: 'image/png',
              },
            ],
          },
        ],
      },
    })
    const manifest = await run.materialize()
    const archivePath = join(root, 'run-archive.json')

    await writeRunArchive({
      root,
      runId: run.id,
      outputPath: archivePath,
    })

    const archive = await readRunArchive(archivePath)
    expect(archive).toMatchObject({
      schemaVersion: 1,
      kind: 'run-archive',
      manifest: { id: 'run-archive', state: 'failed' },
    })
    expect(archive.events[0]).toMatchObject({
      type: 'run-started',
      run: { id: 'run-archive' },
    })
    expect(archive.artifacts).toHaveLength(1)
    expect(archive.artifacts[0]?.mediaType).toBe('image/png')
    expect(
      Buffer.from(archive.artifacts[0]!.content, 'base64').toString(),
    ).toBe('png-bytes')
    expect(manifest.id).toBe('run-archive')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('import preserves the original archive and migrates older schemas in memory', async () => {
  const root = await tempRoot()
  try {
    const archivePath = join(root, 'legacy-archive.json')
    const legacy = {
      kind: 'run-archive',
      manifest: {
        id: 'run-legacy',
        startedAt: '2026-08-01T00:00:00.000Z',
        finishedAt: '2026-08-01T00:00:01.000Z',
        state: 'passed',
        results: [
          {
            specification: {
              name: 'Checkout',
              uri: 'features/checkout.feature',
            },
            scenario: { name: 'Complete a purchase' },
            executionTargetProfile: { id: 'deterministic' },
            state: 'passed',
            steps: [],
          },
        ],
      },
      events: [
        {
          sequence: 1,
          type: 'run-started',
          run: { id: 'run-legacy', startedAt: '2026-08-01T00:00:00.000Z' },
        },
        {
          sequence: 2,
          type: 'scenario-finished',
          result: {
            specification: {
              name: 'Checkout',
              uri: 'features/checkout.feature',
            },
            scenario: { name: 'Complete a purchase' },
            executionTargetProfile: { id: 'deterministic' },
            state: 'passed',
            steps: [],
          },
        },
      ],
      artifacts: [],
    }
    const original = `${JSON.stringify(legacy)}\n`
    await Bun.write(archivePath, original)

    const imported = await importRunArchive({ root, archivePath })
    const preserved = join(root, '.pickle', 'archives', 'run-legacy.json')

    expect(await Bun.file(preserved).text()).toBe(original)
    expect(await Bun.file(archivePath).text()).toBe(original)
    expect(imported.manifest).toMatchObject({
      schemaVersion: 1,
      id: 'run-legacy',
      state: 'passed',
      results: [
        {
          schemaVersion: 1,
          scenario: { name: 'Complete a purchase' },
        },
      ],
    })
    expect(imported.events[0]).toMatchObject({
      schemaVersion: 1,
      sequence: 1,
      type: 'run-started',
    })

    const store = openTestRunStore({ root })
    expect(await store.list()).toEqual([
      {
        id: 'run-legacy',
        startedAt: '2026-08-01T00:00:00.000Z',
        finishedAt: '2026-08-01T00:00:01.000Z',
        state: 'passed',
        resultCount: 1,
      },
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
