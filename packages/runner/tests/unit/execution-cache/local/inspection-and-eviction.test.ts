import { describe, expect, test } from 'vitest'
import { openLocalExecutionCache } from '../../../../index'
import { serialized, tempRoot, writeMetadata } from './fixtures'

describe('local Execution cache', () => {
  test('inspects metadata and records successful reads without exposing payloads', async () => {
    const projectRoot = await tempRoot('pickle-project')
    const cacheRoot = await tempRoot('pickle-cache')
    const times = [
      new Date('2026-08-21T12:00:00.000Z'),
      new Date('2026-08-21T12:05:00.000Z'),
    ]
    const cache = await openLocalExecutionCache({
      projectRoot,
      cacheRoot,
      now: () => times.shift() ?? new Date('2026-08-21T12:10:00.000Z'),
    })
    const entry = serialized(cache.projectKey, 'scenario-v1')

    await cache.write(entry, writeMetadata)
    expect(await cache.read(entry.key)).toBe(entry.source)

    const inspected = await cache.inspect()
    expect(inspected).toEqual([
      {
        key: entry.key,
        sourceRunId: 'run-1',
        evaluationModel: 'anthropic/claude-sonnet-4-6',
        evaluationInferenceCount: 2,
        createdAt: '2026-08-21T12:00:00.000Z',
        lastUsedAt: '2026-08-21T12:05:00.000Z',
        hitCount: 1,
        payloadDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
        sizeBytes: Buffer.byteLength(entry.source, 'utf8'),
      },
    ])
    expect(JSON.stringify(inspected)).not.toContain('#checkout')
    expect(JSON.stringify(inspected)).not.toContain('serialized_envelope')
  })

  test('evicts the least recently used entries without expiring old revisions', async () => {
    const projectRoot = await tempRoot('pickle-project')
    const cacheRoot = await tempRoot('pickle-cache')
    const probe = await openLocalExecutionCache({ projectRoot, cacheRoot })
    const first = serialized(probe.projectKey, 'scenario-v1')
    const entryBytes = Buffer.byteLength(first.source, 'utf8')
    const times = [
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
      '2026-08-02T00:00:00.000Z',
    ].map((value) => new Date(value))
    const cache = await openLocalExecutionCache({
      projectRoot,
      cacheRoot,
      maxBytes: entryBytes * 2,
      now: () => times.shift() ?? new Date('2026-08-03T00:00:00.000Z'),
    })
    const second = serialized(cache.projectKey, 'scenario-v2')
    const third = serialized(cache.projectKey, 'scenario-v3')

    await cache.write(first, writeMetadata)
    await cache.write(second, writeMetadata)
    await cache.read(first.key)
    expect(await cache.write(third, writeMetadata)).toEqual({
      stored: true,
      evictedEntries: 1,
    })

    expect(await cache.read(second.key)).toBeUndefined()
    expect(await cache.read(first.key)).toBe(first.source)
    expect(await cache.read(third.key)).toBe(third.source)
  })

  test('does not retain an entry larger than the configured budget', async () => {
    const projectRoot = await tempRoot('pickle-project')
    const cacheRoot = await tempRoot('pickle-cache')
    const probe = await openLocalExecutionCache({ projectRoot, cacheRoot })
    const entry = serialized(probe.projectKey, 'scenario-v1')
    const cache = await openLocalExecutionCache({
      projectRoot,
      cacheRoot,
      maxBytes: Buffer.byteLength(entry.source, 'utf8') - 1,
    })

    expect(await cache.write(entry, writeMetadata)).toEqual({
      stored: false,
      evictedEntries: 1,
    })
    expect(await cache.inspect()).toEqual([])
  })
})
