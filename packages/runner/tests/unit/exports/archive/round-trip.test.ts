import { rm } from 'node:fs/promises'
import { join } from 'node:path'
import { expect, test } from 'vitest'
import { readRunArchive } from '../../../../index'
import type { TestResult } from '../../../../src/execution/run-scenario'
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
