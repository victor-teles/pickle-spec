import { describe, expect, test } from 'vitest'
import { openLocalExecutionCache } from '../../../../index'
import { serializeExecutionCacheTerminalOutcome } from '../../../../src/execution-cache/execution-cache'
import { key, serialized, tempRoot, writeMetadata } from './fixtures'

describe('local Execution cache', () => {
  test('atomically transfers an expired lease to a new owner', async () => {
    const projectRoot = await tempRoot('pickle-project')
    const cacheRoot = await tempRoot('pickle-cache')
    let timestamp = new Date('2026-08-21T12:00:00.000Z')
    const cache = await openLocalExecutionCache({
      projectRoot,
      cacheRoot,
      now: () => timestamp,
      leaseTiming: {
        ttlMs: 30,
        heartbeatMs: 10,
        waitTimeoutMs: 30,
        minPollMs: 1,
        maxPollMs: 2,
      },
    })
    const cacheKey = key(cache.projectKey, 'scenario-v1')

    const first = await cache.coordination.acquire(cacheKey)
    expect(first.acquired).toBe(true)
    expect((await cache.coordination.acquire(cacheKey)).acquired).toBe(false)

    timestamp = new Date(timestamp.getTime() + 31)
    const takeover = await cache.coordination.acquire(cacheKey)

    expect(takeover.acquired).toBe(true)
    if (!first.acquired || !takeover.acquired) throw new Error('lease missing')
    expect(takeover.lease.ownerToken).not.toBe(first.lease.ownerToken)
    expect(await cache.coordination.renew(first.lease)).toBe(false)
    expect(await cache.coordination.renew(takeover.lease)).toBe(true)
  })

  test('heartbeat renewal keeps a lease from being taken over', async () => {
    const projectRoot = await tempRoot('pickle-project')
    const cacheRoot = await tempRoot('pickle-cache')
    let timestamp = new Date('2026-08-21T12:00:00.000Z')
    const cache = await openLocalExecutionCache({
      projectRoot,
      cacheRoot,
      now: () => timestamp,
      leaseTiming: { ttlMs: 30, heartbeatMs: 10 },
    })
    const cacheKey = key(cache.projectKey, 'scenario-v1')
    const acquired = await cache.coordination.acquire(cacheKey)
    if (!acquired.acquired) throw new Error('lease missing')

    timestamp = new Date(timestamp.getTime() + 20)
    expect(await cache.coordination.renew(acquired.lease)).toBe(true)
    timestamp = new Date(timestamp.getTime() + 20)

    expect((await cache.coordination.acquire(cacheKey)).acquired).toBe(false)
  })

  test('wakes a waiter when the observed lease expires', async () => {
    const projectRoot = await tempRoot('pickle-project')
    const cacheRoot = await tempRoot('pickle-cache')
    let timestamp = new Date('2026-08-21T12:00:00.000Z')
    const cache = await openLocalExecutionCache({
      projectRoot,
      cacheRoot,
      now: () => timestamp,
      leaseTiming: {
        ttlMs: 30,
        heartbeatMs: 2,
        waitTimeoutMs: 30,
        minPollMs: 1,
        maxPollMs: 2,
      },
    })
    const cacheKey = key(cache.projectKey, 'scenario-v1')
    const owner = await cache.coordination.acquire(cacheKey)
    const waiter = await cache.coordination.acquire(cacheKey)
    if (!owner.acquired || waiter.acquired) {
      throw new Error('unexpected lease acquisition state')
    }
    timestamp = new Date(timestamp.getTime() + 31)

    expect(
      await cache.coordination.wait(
        cacheKey,
        waiter.ownerToken,
        waiter.baselineRevision,
      ),
    ).toEqual({ status: 'released', published: false })
    expect((await cache.coordination.acquire(cacheKey)).acquired).toBe(true)
  })

  test('durably shares a terminal lease outcome without blocking a later owner', async () => {
    const projectRoot = await tempRoot('pickle-project')
    const cacheRoot = await tempRoot('pickle-cache')
    const cache = await openLocalExecutionCache({ projectRoot, cacheRoot })
    const cacheKey = key(cache.projectKey, 'scenario-v1')
    const owner = await cache.coordination.acquire(cacheKey)
    const waiter = await cache.coordination.acquire(cacheKey)
    if (!owner.acquired || waiter.acquired) {
      throw new Error('unexpected lease acquisition state')
    }
    const terminalOutcome = serializeExecutionCacheTerminalOutcome({
      state: 'passed',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'non-deterministic-action',
    })

    expect(
      await cache.coordination.complete(owner.lease, terminalOutcome),
    ).toBe(true)
    const reopened = await openLocalExecutionCache({ projectRoot, cacheRoot })

    expect(
      await reopened.coordination.wait(
        cacheKey,
        waiter.ownerToken,
        waiter.baselineRevision,
      ),
    ).toEqual({
      status: 'released',
      published: false,
      terminalOutcome,
    })
    expect((await reopened.coordination.acquire(cacheKey)).acquired).toBe(true)
  })

  test('rejects publication by a previous owner after expired takeover', async () => {
    const projectRoot = await tempRoot('pickle-project')
    const cacheRoot = await tempRoot('pickle-cache')
    let timestamp = new Date('2026-08-21T12:00:00.000Z')
    const cache = await openLocalExecutionCache({
      projectRoot,
      cacheRoot,
      now: () => timestamp,
      leaseTiming: { ttlMs: 30, heartbeatMs: 10 },
    })
    const original = serialized(cache.projectKey, 'scenario-v1', '#original')
    const stale = serialized(cache.projectKey, 'scenario-v1', '#stale')
    const replacement = serialized(
      cache.projectKey,
      'scenario-v1',
      '#replacement',
    )
    await cache.write(original, writeMetadata)
    const first = await cache.coordination.acquire(original.key)
    if (!first.acquired) throw new Error('first lease missing')

    timestamp = new Date(timestamp.getTime() + 31)
    const takeover = await cache.coordination.acquire(original.key)
    if (!takeover.acquired) throw new Error('takeover lease missing')

    expect(
      await cache.coordination.publish(first.lease, stale, writeMetadata),
    ).toEqual({ published: false, stored: false, evictedEntries: 0 })
    expect(await cache.read(original.key)).toBe(original.source)
    expect(
      await cache.coordination.publish(
        takeover.lease,
        replacement,
        writeMetadata,
      ),
    ).toEqual({ published: true, stored: true, evictedEntries: 0 })
    expect(await cache.read(original.key)).toBe(replacement.source)
  })

  test('preserves a previous entry when a refresh publication is too large', async () => {
    const projectRoot = await tempRoot('pickle-project')
    const cacheRoot = await tempRoot('pickle-cache')
    const probe = await openLocalExecutionCache({ projectRoot, cacheRoot })
    const original = serialized(probe.projectKey, 'scenario-v1', '#short')
    const oversized = serialized(
      probe.projectKey,
      'scenario-v1',
      `#${'oversized'.repeat(20)}`,
    )
    const cache = await openLocalExecutionCache({
      projectRoot,
      cacheRoot,
      maxBytes: Buffer.byteLength(original.source, 'utf8') + 1,
    })
    await cache.write(original, writeMetadata)
    const acquired = await cache.coordination.acquire(original.key)
    if (!acquired.acquired) throw new Error('lease missing')

    expect(
      await cache.coordination.publish(
        acquired.lease,
        oversized,
        writeMetadata,
      ),
    ).toEqual({ published: true, stored: false, evictedEntries: 0 })
    expect(await cache.read(original.key)).toBe(original.source)
  })

  test('bounds and cancels lease waiting without acquiring another lease', async () => {
    const projectRoot = await tempRoot('pickle-project')
    const cacheRoot = await tempRoot('pickle-cache')
    const cache = await openLocalExecutionCache({
      projectRoot,
      cacheRoot,
      leaseTiming: {
        ttlMs: 100,
        heartbeatMs: 20,
        waitTimeoutMs: 8,
        minPollMs: 1,
        maxPollMs: 2,
      },
    })
    const cacheKey = key(cache.projectKey, 'scenario-v1')
    const owner = await cache.coordination.acquire(cacheKey)
    const waiter = await cache.coordination.acquire(cacheKey)
    if (!owner.acquired || waiter.acquired) {
      throw new Error('unexpected lease acquisition state')
    }

    expect(
      await cache.coordination.wait(
        cacheKey,
        waiter.ownerToken,
        waiter.baselineRevision,
      ),
    ).toEqual({ status: 'timed-out' })

    const controller = new AbortController()
    const waiting = cache.coordination.wait(
      cacheKey,
      waiter.ownerToken,
      waiter.baselineRevision,
      controller.signal,
    )
    controller.abort()
    expect(await waiting).toEqual({ status: 'cancelled' })
  })
})
