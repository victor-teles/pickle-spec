import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import {
  type ImportRunArchiveInput,
  importRunArchive as importRunArchiveBase,
  openTestRunStore as openTestRunStoreBase,
  readRunArchive,
  resolveLocalProjectStorage,
  type TestRunStoreOptions,
  type WriteRunArchiveInput,
  writeRunArchive as writeRunArchiveBase,
} from '../../../index'
import type { TestResult } from '../../../src/execution/run-scenario'
import { requiredValue } from '../../../src/required-value'

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pickle-archive-'))
}

function pickleHomeFor(root: string): string {
  return join(root, '.pickle-home')
}

function storageFor(root: string) {
  return resolveLocalProjectStorage(root, pickleHomeFor(root))
}

function openTestRunStore(options: TestRunStoreOptions) {
  return openTestRunStoreBase({
    ...options,
    pickleHome: pickleHomeFor(options.root),
  })
}

function writeRunArchive(input: WriteRunArchiveInput) {
  return writeRunArchiveBase({
    ...input,
    pickleHome: pickleHomeFor(input.root),
  })
}

function importRunArchive(input: ImportRunArchiveInput) {
  return importRunArchiveBase({
    ...input,
    pickleHome: pickleHomeFor(input.root),
  })
}

function unavailableEvidence(): TestResult['attempts'][number]['evidenceAvailability'] {
  return [
    { kind: 'screenshot', state: 'not-supported' },
    { kind: 'trace', state: 'not-supported' },
    { kind: 'recording', state: 'not-supported' },
    { kind: 'device-log', state: 'not-supported' },
    { kind: 'diagnostics', state: 'not-supported' },
  ]
}

function passedResult(): TestResult {
  const startedAt = '2026-08-15T12:00:00.000Z'
  const finishedAt = '2026-08-15T12:00:00.012Z'
  return {
    schemaVersion: 2,
    specification: {
      name: 'Checkout',
      uri: 'features/checkout.feature',
    },
    scenario: { name: 'Complete a purchase', id: 'scnpurchasebbbbbb' },
    executionTargetProfile: { id: 'deterministic' },
    state: 'passed',
    startedAt,
    finishedAt,
    durationMs: 12,
    attempts: [
      {
        attempt: 1,
        startedAt,
        finishedAt,
        durationMs: 12,
        state: 'passed',
        steps: [],
        executionMode: 'replay',
        cacheOutcome: 'hit',
        inferenceCount: 0,
        evidenceAvailability: unavailableEvidence(),
      },
    ],
  }
}

function scenarioFinished(result: TestResult, attemptIndex = -1) {
  const attempt = requiredValue(result.attempts.at(attemptIndex))
  return {
    type: 'scenario-finished' as const,
    specification: result.specification,
    scenario: result.scenario,
    executionTargetProfile: result.executionTargetProfile,
    scope: {
      scenarioId: requiredValue(result.scenario.id),
      examplesRowId: result.scenario.examplesRowId,
      executionTargetProfileId: result.executionTargetProfile.id,
      attempt: attempt.attempt,
    },
    attempt,
  }
}

function failedResultWithArtifact(path: string): TestResult {
  const result = passedResult()
  const attempt = requiredValue(result.attempts[0])
  const step = {
    index: 0,
    startedAt: attempt.startedAt,
    finishedAt: attempt.finishedAt,
    durationMs: attempt.durationMs,
    step: {
      keyword: 'Then',
      text: 'payment is captured',
      type: 'outcome' as const,
    },
    state: 'failed' as const,
    resolvedActions: [{ description: 'Click pay on chrome' }],
    message: 'Payment was declined',
    artifacts: [
      {
        kind: 'screenshot' as const,
        path,
        mediaType: 'image/png',
        name: 'failure.png',
        capturedAt: attempt.finishedAt,
        sizeBytes: 16,
      },
    ],
  }
  return {
    ...result,
    state: 'failed',
    attempts: [
      {
        ...attempt,
        state: 'failed',
        steps: [step],
        evidenceAvailability: unavailableEvidence().map((availability) =>
          availability.kind === 'screenshot'
            ? { ...availability, state: 'available' as const }
            : availability,
        ),
      },
    ],
  }
}

function emptyArchive(id: string) {
  const startedAt = '2026-08-01T00:00:00.000Z'
  return {
    schemaVersion: 2 as const,
    kind: 'run-archive' as const,
    manifest: {
      schemaVersion: 2 as const,
      id,
      startedAt,
      finishedAt: '2026-08-01T00:00:01.000Z',
      state: 'passed' as const,
      results: [],
    },
    events: [
      {
        schemaVersion: 2 as const,
        sequence: 1,
        occurredAt: startedAt,
        type: 'run-started' as const,
        run: { id, startedAt },
      },
    ],
    artifacts: [],
  }
}

function archiveWithResult(id: string, result: TestResult) {
  const archive = emptyArchive(id)
  return {
    ...archive,
    manifest: {
      ...archive.manifest,
      finishedAt: result.finishedAt,
      state: result.state,
      results: [result],
    },
    events: [
      ...archive.events,
      {
        ...scenarioFinished(result),
        schemaVersion: 2 as const,
        sequence: 2,
        occurredAt: result.finishedAt,
      },
    ],
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
    await run.append(scenarioFinished(failedResultWithArtifact(artifactSource)))
    const manifest = await run.materialize()
    const archivePath = join(root, 'run-archive.json')

    await writeRunArchive({
      root,
      runId: run.id,
      outputPath: archivePath,
    })

    const archive = await readRunArchive(archivePath)
    expect(archive).toMatchObject({
      schemaVersion: 2,
      kind: 'run-archive',
      manifest: {
        id: 'run-archive',
        state: 'failed',
        results: [
          { attempts: [{ executionMode: 'replay', cacheOutcome: 'hit' }] },
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
      Buffer.from(
        requiredValue(archive.artifacts[0]).content,
        'base64',
      ).toString(),
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
    const result = passedResult()
    const attempt = requiredValue(result.attempts[0])
    await run.append(
      scenarioFinished({
        ...result,
        attempts: [
          {
            ...attempt,
            steps: [
              {
                index: 0,
                startedAt: attempt.startedAt,
                finishedAt: attempt.finishedAt,
                durationMs: attempt.durationMs,
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
        ],
      }),
    )
    await run.materialize()
    const archivePath = join(root, 'private-cache-payload.json')

    await writeRunArchive({ root, runId: run.id, outputPath: archivePath })

    const source = await Bun.file(archivePath).text()
    const archive = await readRunArchive(archivePath)
    expect(source).not.toContain('raw-cache-payload-must-not-export')
    expect(archive.manifest.results[0]?.attempts[0]).toMatchObject({
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 0,
    })
    expect(archive.events[1]).toMatchObject({
      type: 'scenario-finished',
      attempt: {
        executionMode: 'replay',
        cacheOutcome: 'hit',
        inferenceCount: 0,
      },
    })
    expect(
      archive.manifest.results[0]?.attempts[0]?.steps[0]?.resolvedActions,
    ).toEqual([{ description: 'Submit the form' }])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('import preserves the original schema-v2 archive bytes', async () => {
  const root = await tempRoot()
  try {
    const archivePath = join(root, 'schema-v2-archive.json')
    const result = passedResult()
    const archive = emptyArchive('run-current')
    const original = `${JSON.stringify({
      ...archive,
      manifest: {
        ...archive.manifest,
        finishedAt: '2026-08-01T00:00:01.000Z',
        results: [result],
      },
      events: [
        ...archive.events,
        {
          ...scenarioFinished(result),
          schemaVersion: 2,
          sequence: 2,
          occurredAt: '2026-08-01T00:00:01.000Z',
        },
      ],
    })}\n`
    await Bun.write(archivePath, original)

    const imported = await importRunArchive({ root, archivePath })
    const preserved = join(
      storageFor(root).archivesDirectory,
      'run-current.json',
    )

    expect(await Bun.file(preserved).text()).toBe(original)
    expect(await Bun.file(archivePath).text()).toBe(original)
    expect(imported.manifest).toMatchObject({
      schemaVersion: 2,
      id: 'run-current',
      state: 'passed',
      results: [
        {
          schemaVersion: 2,
          scenario: { name: 'Complete a purchase' },
        },
      ],
    })
    expect(imported.events[0]).toMatchObject({
      schemaVersion: 2,
      sequence: 1,
      type: 'run-started',
    })
    expect(imported.manifest.results[0]).toMatchObject({
      attempts: [
        { executionMode: 'replay', cacheOutcome: 'hit', inferenceCount: 0 },
      ],
    })

    const store = openTestRunStore({ root })
    expect(await store.list()).toEqual([
      {
        id: 'run-current',
        executionTargetProfileIds: ['deterministic'],
        specificationUris: ['features/checkout.feature'],
        startedAt: '2026-08-01T00:00:00.000Z',
        finishedAt: '2026-08-01T00:00:01.000Z',
        durationMs: 1_000,
        state: 'passed',
        resultCount: 1,
        executionModes: ['replay'],
        cacheOutcomes: ['hit'],
        inferenceCount: 0,
      },
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('archive parsing removes private fields from schema-v2 input', async () => {
  const root = await tempRoot()
  try {
    const archivePath = join(root, 'private-fields.json')
    const result = passedResult()
    const attempt = requiredValue(result.attempts[0])
    const privateResult: TestResult = {
      ...result,
      attempts: [
        {
          ...attempt,
          steps: [
            {
              index: 0,
              startedAt: attempt.startedAt,
              finishedAt: attempt.finishedAt,
              durationMs: attempt.durationMs,
              step: { keyword: 'When', text: 'I submit', type: 'action' },
              state: 'passed',
              resolvedActions: [
                {
                  description: 'Submit the form',
                  replay: { payload: 'private-replay-payload' },
                },
              ],
            },
          ],
        },
      ],
    }
    const archive = emptyArchive('run-private-fields')
    await Bun.write(
      archivePath,
      JSON.stringify({
        ...archive,
        manifest: {
          ...archive.manifest,
          results: [privateResult],
        },
        events: [
          {
            ...archive.events[0],
            sequence: 1,
            prompt: 'private-system-prompt',
            adapterPayload: { secret: 'private-adapter-payload' },
            run: {
              id: 'run-private-fields',
              startedAt: '2026-08-01T00:00:00.000Z',
              privateValue: 'private-bound-value',
            },
          },
          {
            schemaVersion: 2,
            sequence: 2,
            occurredAt: privateResult.finishedAt,
            ...scenarioFinished(privateResult),
            prompt: 'private-scenario-prompt',
          },
        ],
      }),
    )

    const parsed = await readRunArchive(archivePath)

    expect(
      parsed.manifest.results[0]?.attempts[0]?.steps[0]?.resolvedActions,
    ).toEqual([{ description: 'Submit the form' }])
    expect(parsed.events).toHaveLength(2)
    expect(parsed.events[0]).toEqual({
      schemaVersion: 2,
      sequence: 1,
      occurredAt: '2026-08-01T00:00:00.000Z',
      type: 'run-started',
      run: {
        id: 'run-private-fields',
        startedAt: '2026-08-01T00:00:00.000Z',
        sourceRunId: undefined,
        suite: undefined,
        applicationRevision: undefined,
      },
    })
    expect(parsed.events[1]).toMatchObject({
      type: 'scenario-finished',
      attempt: {
        steps: [{ resolvedActions: [{ description: 'Submit the form' }] }],
      },
    })
    expect(JSON.stringify(parsed)).not.toContain('private-system-prompt')
    expect(JSON.stringify(parsed)).not.toContain('private-adapter-payload')
    expect(JSON.stringify(parsed)).not.toContain('private-bound-value')
    expect(JSON.stringify(parsed)).not.toContain('private-replay-payload')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

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
