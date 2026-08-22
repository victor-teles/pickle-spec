import { Database, SQLiteError } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, rename } from 'node:fs/promises'
import { join } from 'node:path'

export interface LocalExecutionCacheDatabase {
  use<Value>(operation: (db: Database) => Value): Promise<Value>
}

interface DatabaseOpenOptions {
  verifyIntegrity?: boolean
}

type CacheSchemaVersion = Record<'user_version', number>
type CacheIntegrityCheck = Record<'quick_check', string>
type FileSystemError = Error & { code?: string }

const cacheSchemaVersion = 2

class InvalidExecutionCacheDatabaseError extends Error {}

function migrate(db: Database): void {
  const version = db.query('PRAGMA user_version').get() as CacheSchemaVersion
  if (version.user_version > cacheSchemaVersion) {
    throw new InvalidExecutionCacheDatabaseError(
      `Unsupported Execution cache schema version: ${version.user_version}`,
    )
  }
  if (version.user_version === cacheSchemaVersion) return
  db.transaction(() => {
    db.run(`
      CREATE TABLE IF NOT EXISTS entries (
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
    db.run(`
      CREATE INDEX IF NOT EXISTS entries_lru
      ON entries(last_used_at, created_at, key_digest)
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS leases (
        key_digest TEXT PRIMARY KEY,
        owner_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        baseline_payload_digest TEXT
      )
    `)
    db.run(`PRAGMA user_version = ${cacheSchemaVersion}`)
  }).immediate()
}

function openDatabase(
  path: string,
  options: DatabaseOpenOptions = {},
): Database {
  const db = new Database(path, { create: true })
  try {
    db.run('PRAGMA busy_timeout = 5000')
    if (options.verifyIntegrity) {
      const check = db
        .query('PRAGMA quick_check(1)')
        .get() as CacheIntegrityCheck
      if (check.quick_check !== 'ok') {
        throw new InvalidExecutionCacheDatabaseError(
          `Execution cache integrity check failed: ${check.quick_check}`,
        )
      }
    }
    db.run('PRAGMA journal_mode = WAL')
    migrate(db)
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

function withDatabase<Value>(
  path: string,
  operation: (db: Database) => Value,
  options: DatabaseOpenOptions = {},
): Value {
  const db = openDatabase(path, options)
  try {
    return operation(db)
  } finally {
    db.close()
  }
}

function isRecoverableDatabaseError(error: unknown): boolean {
  return (
    error instanceof InvalidExecutionCacheDatabaseError ||
    (error instanceof SQLiteError &&
      (error.code === 'SQLITE_CORRUPT' || error.code === 'SQLITE_NOTADB'))
  )
}

async function moveIfPresent(
  source: string,
  destination: string,
): Promise<void> {
  try {
    await rename(source, destination)
  } catch (error) {
    if ((error as FileSystemError).code !== 'ENOENT') throw error
  }
}

async function chmodIfPresent(path: string, mode: number): Promise<void> {
  try {
    await chmod(path, mode)
  } catch (error) {
    if ((error as FileSystemError).code !== 'ENOENT') throw error
  }
}

async function restrictDatabaseFiles(path: string): Promise<void> {
  if (process.platform === 'win32') return
  await chmodIfPresent(path, 0o600)
  await chmodIfPresent(`${path}-wal`, 0o600)
  await chmodIfPresent(`${path}-shm`, 0o600)
}

async function moveInvalidDatabaseAside(path: string): Promise<void> {
  const suffix = `${Date.now()}-${randomUUID()}`
  const diagnosticPath = `${path}.corrupt-${suffix}`
  await moveIfPresent(path, diagnosticPath)
  await moveIfPresent(`${path}-wal`, `${diagnosticPath}-wal`)
  await moveIfPresent(`${path}-shm`, `${diagnosticPath}-shm`)
}

async function withRecovery<Value>(
  path: string,
  operation: (db: Database) => Value,
  options: DatabaseOpenOptions = {},
): Promise<Value> {
  try {
    const value = withDatabase(path, operation, options)
    await restrictDatabaseFiles(path)
    return value
  } catch (error) {
    if (!isRecoverableDatabaseError(error)) throw error
    await moveInvalidDatabaseAside(path)
    const value = withDatabase(path, operation)
    await restrictDatabaseFiles(path)
    return value
  }
}

export async function openLocalExecutionCacheDatabase(
  cacheDirectory: string,
): Promise<LocalExecutionCacheDatabase> {
  const databasePath = join(cacheDirectory, 'execution-cache.sqlite')
  await mkdir(cacheDirectory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') await chmod(cacheDirectory, 0o700)
  await withRecovery(databasePath, () => undefined, {
    verifyIntegrity: true,
  })
  return {
    use: (operation) => withRecovery(databasePath, operation),
  }
}
