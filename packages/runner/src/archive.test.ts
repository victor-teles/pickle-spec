import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
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
    executionMode: 'replay',
    cacheOutcome: 'hit',
    inferenceCount: 0,
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
      manifest: {
        id: 'run-archive',
        state: 'failed',
        results: [
          {
            executionMode: 'replay',
            cacheOutcome: 'hit',
            inferenceCount: 0,
          },
        ],
      },
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

test('archive round-trip omits private replay payloads from resolved actions', async () => {
  const root = await tempRoot()
  try {
    const store = openTestRunStore({
      root,
      createId: () => 'run-private-cache-payload',
      now: () => new Date('2026-08-15T12:00:00.000Z'),
    })
    const run = await store.create()
    await run.append({
      type: 'scenario-finished',
      result: {
        ...passedResult(),
        steps: [
          {
            step: { keyword: 'When', text: 'I submit', type: 'action' },
            state: 'passed',
            resolvedActions: [
              {
                description: 'Submit the form',
                replay: { payload: 'raw-cache-payload-must-not-export' },
              },
            ],
          },
        ],
      },
    })
    await run.materialize()
    const archivePath = join(root, 'private-cache-payload.json')

    await writeRunArchive({ root, runId: run.id, outputPath: archivePath })

    const source = await Bun.file(archivePath).text()
    const archive = await readRunArchive(archivePath)
    expect(source).not.toContain('raw-cache-payload-must-not-export')
    expect(archive.manifest.results[0]).toMatchObject({
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 0,
    })
    expect(archive.events[1]).toMatchObject({
      type: 'scenario-finished',
      result: {
        executionMode: 'replay',
        cacheOutcome: 'hit',
        inferenceCount: 0,
      },
    })
    expect(archive.manifest.results[0]?.steps[0]?.resolvedActions).toEqual([
      { description: 'Submit the form' },
    ])
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
    expect(imported.manifest.results[0]).toMatchObject({
      executionMode: 'adaptive',
      cacheOutcome: 'uncacheable',
      inferenceCount: 0,
    })

    const store = openTestRunStore({ root })
    expect(await store.list()).toEqual([
      {
        id: 'run-legacy',
        executionTargetProfileIds: ['deterministic'],
        specificationUris: ['features/checkout.feature'],
        startedAt: '2026-08-01T00:00:00.000Z',
        finishedAt: '2026-08-01T00:00:01.000Z',
        durationMs: 1_000,
        state: 'passed',
        resultCount: 1,
        executionModes: ['adaptive'],
        cacheOutcomes: ['uncacheable'],
        inferenceCount: 0,
      },
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('migration normalizes invalid Execution cache metadata from untrusted archives', async () => {
  const root = await tempRoot()
  try {
    const archivePath = join(root, 'invalid-cache-metadata.json')
    await Bun.write(
      archivePath,
      JSON.stringify({
        manifest: {
          id: 'run-invalid-cache-metadata',
          startedAt: '2026-08-01T00:00:00.000Z',
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
              executionMode: 'automatic',
              cacheOutcome: 'stale',
              inferenceCount: -1,
              cacheUncacheableReason: 'unknown',
              failureKind: 'model-error',
            },
          ],
        },
        events: [
          {
            sequence: 1,
            type: 'run-started',
            prompt: 'private-system-prompt',
            adapterPayload: { secret: 'private-adapter-payload' },
            run: {
              id: 'run-invalid-cache-metadata',
              startedAt: '2026-08-01T00:00:00.000Z',
              privateValue: 'private-bound-value',
            },
          },
        ],
      }),
    )

    const archive = await readRunArchive(archivePath)

    expect(archive.manifest.results[0]).toMatchObject({
      executionMode: 'adaptive',
      cacheOutcome: 'uncacheable',
      inferenceCount: 0,
      cacheUncacheableReason: undefined,
      failureKind: undefined,
    })
    expect(archive.events).toEqual([
      {
        schemaVersion: 1,
        sequence: 1,
        type: 'run-started',
        run: {
          id: 'run-invalid-cache-metadata',
          startedAt: '2026-08-01T00:00:00.000Z',
          sourceRunId: undefined,
          suite: undefined,
          applicationRevision: undefined,
        },
      },
    ])
    expect(JSON.stringify(archive)).not.toContain('private-system-prompt')
    expect(JSON.stringify(archive)).not.toContain('private-adapter-payload')
    expect(JSON.stringify(archive)).not.toContain('private-bound-value')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('archive migration rejects result states outside the public contract', async () => {
  const root = await tempRoot()
  try {
    const archivePath = join(root, 'invalid-result-state.json')
    await Bun.write(
      archivePath,
      JSON.stringify({
        manifest: {
          id: 'run-invalid-state',
          startedAt: '2026-08-01T00:00:00.000Z',
          state: 'unknown-state',
          results: [],
        },
        events: [],
        artifacts: [],
      }),
    )

    await expect(readRunArchive(archivePath)).rejects.toThrow(
      'archive state must be a current result state',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('import refuses to overwrite an existing immutable run or retained archive', async () => {
  const root = await tempRoot()
  try {
    const archivePath = join(root, 'run-archive.json')
    const archive = {
      kind: 'run-archive',
      manifest: {
        id: 'run-existing',
        startedAt: '2026-08-01T00:00:00.000Z',
        state: 'passed',
        results: [],
      },
      events: [
        {
          sequence: 1,
          type: 'run-started',
          run: {
            id: 'run-existing',
            startedAt: '2026-08-01T00:00:00.000Z',
          },
        },
      ],
      artifacts: [],
    }
    const original = `${JSON.stringify(archive)}\n`
    await Bun.write(archivePath, original)
    const imported = await importRunArchive({ root, archivePath })
    const eventsPath = join(
      root,
      '.pickle',
      'runs',
      'run-existing',
      'events.ndjson',
    )
    const eventsBefore = await Bun.file(eventsPath).text()
    const archiveBefore = await Bun.file(imported.preservedArchivePath).text()
    await Bun.write(
      archivePath,
      `${JSON.stringify({ ...archive, events: [] })}\n`,
    )

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
    const archive = {
      kind: 'run-archive',
      manifest: {
        id: 'run-concurrent',
        startedAt: '2026-08-01T00:00:00.000Z',
        state: 'passed',
        results: [],
      },
      events: [
        {
          sequence: 1,
          type: 'run-started',
          run: {
            id: 'run-concurrent',
            startedAt: '2026-08-01T00:00:00.000Z',
          },
        },
      ],
      artifacts: [],
    }
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
        join(root, '.pickle', 'archives', 'run-concurrent.json'),
      ).text(),
    ).toBe(original)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('import rejects run identifiers and artifact paths that escape the run directory', async () => {
  const root = await tempRoot()
  try {
    const existingDirectory = join(root, '.pickle', 'runs', 'run-existing')
    const existingEventsPath = join(existingDirectory, 'events.ndjson')
    await mkdir(existingDirectory, { recursive: true })
    await Bun.write(existingEventsPath, 'immutable\n')
    const archivePath = join(root, 'unsafe-archive.json')
    const unsafeArtifact = {
      kind: 'run-archive',
      manifest: {
        id: 'run-imported',
        startedAt: '2026-08-01T00:00:00.000Z',
        state: 'passed',
        results: [],
      },
      events: [],
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
