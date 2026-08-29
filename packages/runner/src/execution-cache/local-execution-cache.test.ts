import { Database } from 'bun:sqlite'
import { afterEach, describe, expect, test } from 'bun:test'
import {
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm,
  stat,
  symlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ExecutionCacheEnvelope,
  type ExecutionCacheKey,
  type ExecutionCachePayloadValidator,
  openLocalExecutionCache,
  resolveLocalProjectStorage,
  serializeExecutionCacheEnvelope,
} from '../../index'
import { serializeExecutionCacheTerminalOutcome } from './execution-cache'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  )
})

async function tempRoot(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `${name}-`))
  roots.push(root)
  return root
}

type TestPayload = {
  operation: 'click'
  target: string
}

const payloadValidator: ExecutionCachePayloadValidator<TestPayload> = {
  adapterKind: 'test',
  adapterCacheSchemaVersion: 'test.1',
  parse(payload) {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('operation' in payload) ||
      payload.operation !== 'click' ||
      !('target' in payload) ||
      typeof payload.target !== 'string'
    ) {
      return
    }
    return { operation: payload.operation, target: payload.target }
  },
  prefixStepCount() {
    return 1
  },
}

function key(projectKey: string, scenarioRevision: string): ExecutionCacheKey {
  return {
    projectKey,
    scenarioId: 'scenario-checkout',
    scenarioRevision,
    executionTargetProfileId: 'chromium',
    targetConfigurationFingerprint: 'target-config-v1',
    applicationRevision: 'application-v1',
    adapterKind: 'test',
    adapterCacheSchemaVersion: 'test.1',
  }
}

function serialized(
  projectKey: string,
  scenarioRevision: string,
  target = '#checkout',
) {
  const cacheKey = key(projectKey, scenarioRevision)
  const envelope: ExecutionCacheEnvelope<TestPayload> = {
    schemaVersion: 1,
    key: cacheKey,
    requiredVariables: [],
    adapterPayload: { operation: 'click', target },
  }
  return serializeExecutionCacheEnvelope(envelope, payloadValidator)
}

const writeMetadata = {
  sourceRunId: 'run-1',
  evaluationModel: 'anthropic/claude-sonnet-4-6',
  evaluationInferenceCount: 2,
}

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

  test('persists multiple revisions outside the canonical checkout', async () => {
    const projectRoot = await tempRoot('pickle-project')
    const cacheRoot = await tempRoot('pickle-cache')
    const linkedRoot = join(await tempRoot('pickle-link'), 'project')
    await symlink(projectRoot, linkedRoot)

    const original = await openLocalExecutionCache({ projectRoot, cacheRoot })
    const linked = await openLocalExecutionCache({
      projectRoot: linkedRoot,
      cacheRoot,
    })

    expect(original.projectKey).toMatch(/^[a-f0-9]{64}$/)
    expect(linked.projectKey).toBe(original.projectKey)
    expect(await realpath(linkedRoot)).toBe(await realpath(projectRoot))

    const revisionOne = serialized(original.projectKey, 'scenario-v1')
    const revisionTwo = serialized(original.projectKey, 'scenario-v2')
    expect(await original.write(revisionOne, writeMetadata)).toEqual({
      stored: true,
      evictedEntries: 0,
    })
    expect(await original.write(revisionTwo, writeMetadata)).toEqual({
      stored: true,
      evictedEntries: 0,
    })

    const reopened = await openLocalExecutionCache({ projectRoot, cacheRoot })
    expect(await reopened.read(revisionOne.key)).toBe(revisionOne.source)
    expect(await reopened.read(revisionTwo.key)).toBe(revisionTwo.source)
    expect(await Bun.file(join(projectRoot, '.pickle')).exists()).toBe(false)
  })

  test('isolates entries between checkouts', async () => {
    const firstProject = await tempRoot('pickle-project-one')
    const secondProject = await tempRoot('pickle-project-two')
    const cacheRoot = await tempRoot('pickle-cache')
    await mkdir(join(firstProject, 'features'))
    await mkdir(join(secondProject, 'features'))

    const first = await openLocalExecutionCache({
      projectRoot: firstProject,
      cacheRoot,
    })
    const second = await openLocalExecutionCache({
      projectRoot: secondProject,
      cacheRoot,
    })
    const entry = serialized(first.projectKey, 'scenario-v1')
    await first.write(entry, writeMetadata)

    expect(second.projectKey).not.toBe(first.projectKey)
    expect(await second.read(key(second.projectKey, 'scenario-v1'))).toBe(
      undefined,
    )
    expect(await first.read(entry.key)).toBe(entry.source)
    expect(
      (await readdir(cacheRoot, { withFileTypes: true })).filter((item) =>
        item.isDirectory(),
      ),
    ).toEqual([])
    expect(
      await Bun.file(join(cacheRoot, 'execution-cache.sqlite')).exists(),
    ).toBe(true)
  })

  test('shares one project identity and storage directory across Git worktrees', async () => {
    const repository = await tempRoot('pickle-repository')
    const worktree = await tempRoot('pickle-worktree')
    const commonGitDirectory = join(repository, '.git')
    const worktreeGitDirectory = join(
      commonGitDirectory,
      'worktrees',
      'feature',
    )
    await mkdir(worktreeGitDirectory, { recursive: true })
    await Bun.write(join(worktreeGitDirectory, 'commondir'), '../..\n')
    await Bun.write(join(worktree, '.git'), `gitdir: ${worktreeGitDirectory}\n`)

    const repositoryStorage = resolveLocalProjectStorage(repository)
    const worktreeStorage = resolveLocalProjectStorage(worktree)

    expect(worktreeStorage.projectKey).toBe(repositoryStorage.projectKey)
    expect(worktreeStorage.projectDirectory).toBe(
      repositoryStorage.projectDirectory,
    )
  })

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

  test('moves a corrupt database aside and recreates an empty usable cache', async () => {
    const projectRoot = await tempRoot('pickle-project')
    const cacheRoot = await tempRoot('pickle-cache')
    const initial = await openLocalExecutionCache({ projectRoot, cacheRoot })
    const databasePath = join(cacheRoot, 'execution-cache.sqlite')
    const entry = serialized(initial.projectKey, 'scenario-v1')
    await initial.write(entry, writeMetadata)
    await rm(`${databasePath}-wal`, { force: true })
    await rm(`${databasePath}-shm`, { force: true })
    await Bun.write(databasePath, 'this is not a SQLite database')

    const recovered = await openLocalExecutionCache({ projectRoot, cacheRoot })

    expect(await recovered.read(entry.key)).toBeUndefined()
    expect(
      (await readdir(cacheRoot)).some((name) =>
        name.startsWith('execution-cache.sqlite.corrupt-'),
      ),
    ).toBe(true)
    expect(await recovered.write(entry, writeMetadata)).toEqual({
      stored: true,
      evictedEntries: 0,
    })
    expect(await recovered.read(entry.key)).toBe(entry.source)
    if (process.platform !== 'win32') {
      expect((await stat(databasePath)).mode & 0o777).toBe(0o600)
    }
  })

  test('migrates an empty version-zero database through the public store', async () => {
    const projectRoot = await tempRoot('pickle-project')
    const cacheRoot = await tempRoot('pickle-cache')
    await openLocalExecutionCache({ projectRoot, cacheRoot })
    const databasePath = join(cacheRoot, 'execution-cache.sqlite')
    await rm(databasePath, { force: true })
    await rm(`${databasePath}-wal`, { force: true })
    await rm(`${databasePath}-shm`, { force: true })
    const legacy = new Database(databasePath, { create: true })
    legacy.run('PRAGMA user_version = 0')
    legacy.close()

    const migrated = await openLocalExecutionCache({ projectRoot, cacheRoot })
    const entry = serialized(migrated.projectKey, 'scenario-v1')
    await migrated.write(entry, writeMetadata)

    expect(await migrated.read(entry.key)).toBe(entry.source)
  })

  test('migrates a version-two cache to revision-based publication', async () => {
    const projectRoot = await tempRoot('pickle-project')
    const cacheRoot = await tempRoot('pickle-cache')
    await openLocalExecutionCache({ projectRoot, cacheRoot })
    const databasePath = join(cacheRoot, 'execution-cache.sqlite')
    await rm(databasePath, { force: true })
    await rm(`${databasePath}-wal`, { force: true })
    await rm(`${databasePath}-shm`, { force: true })
    const legacy = new Database(databasePath, { create: true })
    legacy.run(`
      CREATE TABLE entries (
        key_digest TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        scenario_id TEXT NOT NULL,
        scenario_revision TEXT NOT NULL,
        execution_target_profile_id TEXT NOT NULL,
        target_configuration_fingerprint TEXT NOT NULL,
        application_revision TEXT NOT NULL,
        adapter_kind TEXT NOT NULL,
        adapter_cache_schema_version TEXT NOT NULL,
        serialized_envelope TEXT NOT NULL,
        payload_digest TEXT NOT NULL,
        source_run_id TEXT NOT NULL,
        evaluation_model TEXT,
        evaluation_inference_count INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        last_used_at TEXT NOT NULL,
        hit_count INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL
      )
    `)
    legacy.run(`
      CREATE TABLE leases (
        key_digest TEXT PRIMARY KEY,
        owner_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        baseline_payload_digest TEXT
      )
    `)
    legacy.run('PRAGMA user_version = 2')
    legacy.close()

    const migrated = await openLocalExecutionCache({ projectRoot, cacheRoot })
    const entry = serialized(migrated.projectKey, 'scenario-v1')
    await migrated.write(entry, writeMetadata)
    const first = await migrated.coordination.acquire(entry.key)
    if (!first.acquired) throw new Error('lease missing')

    expect(
      await migrated.coordination.publish(first.lease, entry, writeMetadata),
    ).toEqual({ published: true, stored: true, evictedEntries: 0 })
    expect((await migrated.coordination.readCurrent(entry.key))?.revision).toBe(
      2,
    )
  })

  test('restricts local cache permissions and clears only the current checkout', async () => {
    const firstProject = await tempRoot('pickle-project-one')
    const secondProject = await tempRoot('pickle-project-two')
    const cacheRoot = await tempRoot('pickle-cache')
    const first = await openLocalExecutionCache({
      projectRoot: firstProject,
      cacheRoot,
    })
    const second = await openLocalExecutionCache({
      projectRoot: secondProject,
      cacheRoot,
    })
    const firstEntry = serialized(first.projectKey, 'scenario-v1')
    const secondEntry = serialized(second.projectKey, 'scenario-v1')
    await first.write(firstEntry, writeMetadata)
    await second.write(secondEntry, writeMetadata)
    expect((await first.coordination.acquire(firstEntry.key)).acquired).toBe(
      true,
    )

    await first.clear()

    expect(await first.inspect()).toEqual([])
    expect((await first.coordination.acquire(firstEntry.key)).acquired).toBe(
      true,
    )
    expect(await second.read(secondEntry.key)).toBe(secondEntry.source)
    if (process.platform !== 'win32') {
      expect((await stat(cacheRoot)).mode & 0o777).toBe(0o700)
      expect(
        (await stat(join(cacheRoot, 'execution-cache.sqlite'))).mode & 0o777,
      ).toBe(0o600)
    }
  })
})
