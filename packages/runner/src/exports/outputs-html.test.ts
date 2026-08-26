import { expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { formatHtml } from '../../index'
import type { ScenarioAttempt, TestResult } from '../execution/run-scenario'
import type { TestRunManifest } from '../results/test-run-store'

const startedAt = '2026-08-15T12:00:01.000Z'
const finishedAt = '2026-08-15T12:00:02.000Z'

async function withArtifact(
  use: (path: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'pickle-html-'))
  try {
    await mkdir(join(root, 'artifacts'), { recursive: true })
    const path = join(root, 'artifacts', 'failure.png')
    await Bun.write(path, 'png-bytes')
    await use(path)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

function result(
  name: string,
  state: TestResult['state'],
  attemptExtras: Partial<ScenarioAttempt> = {},
): TestResult {
  const attempt: ScenarioAttempt = {
    attempt: 1,
    startedAt,
    finishedAt,
    durationMs: 1_000,
    state,
    steps: [],
    evidenceAvailability: [
      { kind: 'screenshot', state: 'not-supported' },
      { kind: 'trace', state: 'not-supported' },
      { kind: 'recording', state: 'not-supported' },
      { kind: 'device-log', state: 'not-supported' },
      { kind: 'diagnostics', state: 'not-supported' },
    ],
    ...attemptExtras,
  }
  return {
    schemaVersion: 2,
    specification: {
      name: 'Checkout',
      uri: 'features/checkout.feature',
    },
    scenario: { name, id: `scn-${name}` },
    executionTargetProfile: { id: 'web' },
    state,
    startedAt,
    finishedAt,
    durationMs: 1_000,
    attempts: [attempt],
  }
}

test('formatHtml includes failure artifacts and Cache execution metadata by default', async () => {
  await withArtifact(async (failurePath) => {
    const passedPath = join(dirname(failurePath), 'passed.png')
    await Bun.write(passedPath, 'passed-bytes')
    const manifest: TestRunManifest = {
      schemaVersion: 2,
      id: 'run-html',
      startedAt: '2026-08-15T12:00:00.000Z',
      finishedAt: '2026-08-15T12:01:00.000Z',
      state: 'failed',
      results: [
        result('Complete a purchase', 'passed', {
          steps: [
            {
              index: 0,
              startedAt,
              finishedAt,
              durationMs: 1_000,
              step: {
                keyword: 'Then',
                text: 'ok',
                type: 'outcome',
              },
              state: 'passed',
              resolvedActions: [],
              artifacts: [
                {
                  kind: 'screenshot',
                  path: passedPath,
                  mediaType: 'image/png',
                },
              ],
            },
          ],
        }),
        result('Pay for the order', 'failed', {
          steps: [
            {
              index: 0,
              startedAt,
              finishedAt,
              durationMs: 1_000,
              step: {
                keyword: 'Then',
                text: 'pay',
                type: 'outcome',
              },
              state: 'failed',
              resolvedActions: [],
              artifacts: [
                {
                  kind: 'screenshot',
                  path: failurePath,
                  mediaType: 'image/png',
                },
              ],
            },
          ],
        }),
        result('Replay the purchase', 'passed', {
          executionMode: 'replay',
          cacheOutcome: 'hit',
          inferenceCount: 0,
        }),
        result('Fallback the purchase', 'passed', {
          executionMode: 'adaptive',
          cacheOutcome: 'fallback',
          inferenceCount: 2,
        }),
      ],
    }
    const html = await formatHtml(manifest)

    expect(html).toContain('<!DOCTYPE html>')
    expect(html).toContain('Pay for the order')
    expect(html).toContain('Replay the purchase')
    expect(html).toContain('Fallback the purchase')
    expect(html).toContain('Execution mode: replay')
    expect(html).toContain('Cache outcome: hit')
    expect(html).toContain('Inference count: 0')
    expect(html).toContain('Execution mode: adaptive')
    expect(html).toContain('Cache outcome: fallback')
    expect(html).toContain('Inference count: 2')
    expect(html.indexOf('Pay for the order')).toBeLessThan(
      html.indexOf('Complete a purchase'),
    )
    expect(html).toContain('data:image/png;base64,')
    expect(html).toContain(Buffer.from('png-bytes').toString('base64'))
    expect(html).not.toContain(Buffer.from('passed-bytes').toString('base64'))
  })
})

test('formatHtml can include every available test artifact', async () => {
  await withArtifact(async (failurePath) => {
    const passedPath = join(dirname(failurePath), 'passed.png')
    await Bun.write(passedPath, 'passed-bytes')
    const manifest: TestRunManifest = {
      schemaVersion: 2,
      id: 'run-html-all',
      startedAt: '2026-08-15T12:00:00.000Z',
      state: 'failed',
      results: [
        result('Complete a purchase', 'passed', {
          steps: [
            {
              index: 0,
              startedAt,
              finishedAt,
              durationMs: 1_000,
              step: {
                keyword: 'Then',
                text: 'ok',
                type: 'outcome',
              },
              state: 'passed',
              resolvedActions: [],
              artifacts: [
                {
                  kind: 'screenshot',
                  path: passedPath,
                  mediaType: 'image/png',
                },
              ],
            },
          ],
        }),
        result('Pay for the order', 'failed', {
          steps: [
            {
              index: 0,
              startedAt,
              finishedAt,
              durationMs: 1_000,
              step: {
                keyword: 'Then',
                text: 'pay',
                type: 'outcome',
              },
              state: 'failed',
              resolvedActions: [],
              artifacts: [
                {
                  kind: 'screenshot',
                  path: failurePath,
                  mediaType: 'image/png',
                },
              ],
            },
          ],
        }),
      ],
    }

    const html = await formatHtml(manifest, { artifacts: 'all' })
    expect(html).toContain(Buffer.from('png-bytes').toString('base64'))
    expect(html).toContain(Buffer.from('passed-bytes').toString('base64'))
  })
})
