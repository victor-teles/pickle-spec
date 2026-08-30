import { Database } from 'bun:sqlite'
import { readdir, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { openLocalExecutionCache } from '../../../../index'
import { serialized, tempRoot, writeMetadata } from './fixtures'

describe('local Execution cache', () => {
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
})
