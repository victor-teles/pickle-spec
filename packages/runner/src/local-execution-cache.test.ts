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
  serializeExecutionCacheEnvelope,
} from '../index'

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
      return undefined
    }
    return { operation: payload.operation, target: payload.target }
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

function serialized(projectKey: string, scenarioRevision: string) {
  const cacheKey = key(projectKey, scenarioRevision)
  const envelope: ExecutionCacheEnvelope<TestPayload> = {
    schemaVersion: 1,
    key: cacheKey,
    requiredVariables: [],
    adapterPayload: { operation: 'click', target: '#checkout' },
  }
  return serializeExecutionCacheEnvelope(envelope, payloadValidator)
}

const writeMetadata = {
  sourceRunId: 'run-1',
  evaluationModel: 'anthropic/claude-sonnet-4-6',
  evaluationInferenceCount: 2,
}

describe('local Execution cache', () => {
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
    const cacheDirectory = join(cacheRoot, initial.projectKey)
    const databasePath = join(cacheDirectory, 'execution-cache.sqlite')
    const entry = serialized(initial.projectKey, 'scenario-v1')
    await initial.write(entry, writeMetadata)
    await rm(`${databasePath}-wal`, { force: true })
    await rm(`${databasePath}-shm`, { force: true })
    await Bun.write(databasePath, 'this is not a SQLite database')

    const recovered = await openLocalExecutionCache({ projectRoot, cacheRoot })

    expect(await recovered.read(entry.key)).toBeUndefined()
    expect(
      (await readdir(cacheDirectory)).some((name) =>
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
    const initial = await openLocalExecutionCache({ projectRoot, cacheRoot })
    const databasePath = join(
      cacheRoot,
      initial.projectKey,
      'execution-cache.sqlite',
    )
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

    await first.clear()

    expect(await first.inspect()).toEqual([])
    expect(await second.read(secondEntry.key)).toBe(secondEntry.source)
    if (process.platform !== 'win32') {
      const directory = join(cacheRoot, first.projectKey)
      expect((await stat(directory)).mode & 0o777).toBe(0o700)
      expect(
        (await stat(join(directory, 'execution-cache.sqlite'))).mode & 0o777,
      ).toBe(0o600)
    }
  })
})
