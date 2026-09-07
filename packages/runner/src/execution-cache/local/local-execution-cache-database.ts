import { requiredValue } from '../../required-value'
import { Database, SQLiteError } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import { chmod, mkdir, rename } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface LocalExecutionCacheDatabase {
  use<Value>(operation: (db: Database) => Value): Promise<Value>
}

interface DatabaseOpenOptions {
  verifyIntegrity?: boolean
}

type CacheSchemaVersion = Record<'user_version', number>
type CacheIntegrityCheck = Record<'quick_check', string>
type TableColumn = Record<'name', string>

const cacheSchemaVersion = 5

class InvalidExecutionCacheDatabaseError extends Error {}

function hasColumn(db: Database, table: string, column: string): boolean {
  return db
    .query<TableColumn, []>(`PRAGMA table_info(${table})`)
    .all()
    .some((item) => item.name === column)
}

function addMissingColumn(
  db: Database,
  table: string,
  column: string,
  definition: string,
): void {
  if (!hasColumn(db, table, column)) {
    db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
  }
}

function migrateLegacyEntries(db: Database, version: number): void {
  if (version > 0 && version < 3) {
    db.run('ALTER TABLE entries ADD COLUMN revision INTEGER NOT NULL DEFAULT 1')
  }
  addMissingColumn(db, 'leases', 'baseline_revision', 'INTEGER')
  addMissingColumn(db, 'leases', 'project_key', 'TEXT')
  addMissingColumn(db, 'lease_outcomes', 'project_key', 'TEXT')
  if (version === 0 || version >= 5) return
  db.run(`
    UPDATE leases SET project_key = (
      SELECT project_key FROM entries
      WHERE entries.key_digest = leases.key_digest
    )
  `)
  db.run(`
    UPDATE lease_outcomes SET project_key = (
      SELECT project_key FROM entries
      WHERE entries.key_digest = lease_outcomes.key_digest
    )
  `)
  db.run('DELETE FROM leases WHERE project_key IS NULL')
  db.run('DELETE FROM lease_outcomes WHERE project_key IS NULL')
}

function migrate(db: Database): void {
  const version = requiredValue(
    db.query<CacheSchemaVersion, []>('PRAGMA user_version').get(),
  )
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
        size_bytes INTEGER NOT NULL,
        revision INTEGER NOT NULL DEFAULT 1
      )
    `)
    db.run(`
      CREATE INDEX IF NOT EXISTS entries_lru
      ON entries(last_used_at, created_at, key_digest)
    `)
    db.run(`
      CREATE INDEX IF NOT EXISTS entries_project_lru
      ON entries(project_key, last_used_at, created_at, key_digest)
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS leases (
        key_digest TEXT PRIMARY KEY,
        project_key TEXT NOT NULL,
        owner_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        baseline_revision INTEGER
      )
    `)
    db.run(`
      CREATE TABLE IF NOT EXISTS lease_outcomes (
        key_digest TEXT NOT NULL,
        project_key TEXT NOT NULL,
        owner_token TEXT NOT NULL,
        terminal_outcome TEXT NOT NULL,
        completed_at INTEGER NOT NULL,
        PRIMARY KEY (key_digest, owner_token)
      )
    `)
    db.run(`
      CREATE INDEX IF NOT EXISTS lease_outcomes_completed
      ON lease_outcomes(completed_at)
    `)
    migrateLegacyEntries(db, version.user_version)
    db.run(`PRAGMA user_version = ${cacheSchemaVersion}`)
  }).immediate()
}

function openDatabase(
  path: string,
  options: DatabaseOpenOptions = {},
): Database {
  const db = new Database(path, { create: true, strict: true })
  try {
    db.run('PRAGMA busy_timeout = 5000')
    if (options.verifyIntegrity) {
      const check = requiredValue(
        db.query<CacheIntegrityCheck, []>('PRAGMA quick_check(1)').get(),
      )
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

function isRecoverableDatabaseError(cause: unknown): boolean {
  return (
    cause instanceof InvalidExecutionCacheDatabaseError ||
    (cause instanceof SQLiteError &&
      (cause.code === 'SQLITE_CORRUPT' || cause.code === 'SQLITE_NOTADB'))
  )
}

async function moveIfPresent(
  source: string,
  destination: string,
): Promise<void> {
  try {
    await rename(source, destination)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error
  }
}

async function chmodIfPresent(path: string, mode: number): Promise<void> {
  try {
    await chmod(path, mode)
  } catch (error) {
    if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT'))
      throw error
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
  databasePath: string,
): Promise<LocalExecutionCacheDatabase> {
  const cacheDirectory = dirname(databasePath)
  await mkdir(cacheDirectory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') await chmod(cacheDirectory, 0o700)
  await withRecovery(databasePath, () => {}, {
    verifyIntegrity: true,
  })
  return {
    use: (operation) => withRecovery(databasePath, operation),
  }
}
