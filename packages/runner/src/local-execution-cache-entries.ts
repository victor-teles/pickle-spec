import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import type {
  ExecutionCacheEntryMetadata,
  ExecutionCacheKey,
  ExecutionCacheStore,
  ExecutionCacheWriteMetadata,
  SerializedExecutionCacheEnvelope,
} from './execution-cache'
import type { LocalExecutionCacheDatabase } from './local-execution-cache-database'

export interface LocalExecutionCacheEntriesOptions {
  database: LocalExecutionCacheDatabase
  projectKey: string
  maxBytes: number
  now: () => Date
}

interface IndexedExecutionCacheEntry {
  projectKey: string
  scenarioId: string
  scenarioRevision: string
  executionTargetProfileId: string
  targetConfigurationFingerprint: string
  applicationRevision: string
  adapterKind: string
  adapterCacheSchemaVersion: string
  sourceRunId: string
  evaluationModel: string | null
  evaluationInferenceCount: number
  createdAt: string
  lastUsedAt: string
  hitCount: number
  payloadDigest: string
  sizeBytes: number
}

interface StoredEntrySize {
  keyDigest: string
  sizeBytes: number
}

interface StoredEnvelopeRow {
  source: string
}

interface RetainedEntryRow {
  retained: number
}

interface StoredBytesRow {
  bytes: number
}

type ExecutionCacheKeyValues = readonly [
  projectKey: string,
  scenarioId: string,
  scenarioRevision: string,
  executionTargetProfileId: string,
  targetConfigurationFingerprint: string,
  applicationRevision: string,
  adapterKind: string,
  adapterCacheSchemaVersion: string,
]

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function keyValues(key: ExecutionCacheKey): ExecutionCacheKeyValues {
  return [
    key.projectKey,
    key.scenarioId,
    key.scenarioRevision,
    key.executionTargetProfileId,
    key.targetConfigurationFingerprint,
    key.applicationRevision,
    key.adapterKind,
    key.adapterCacheSchemaVersion,
  ]
}

function keyDigest(key: ExecutionCacheKey): string {
  return digest(JSON.stringify(keyValues(key)))
}

function keyFromRow(entry: IndexedExecutionCacheEntry): ExecutionCacheKey {
  return {
    projectKey: entry.projectKey,
    scenarioId: entry.scenarioId,
    scenarioRevision: entry.scenarioRevision,
    executionTargetProfileId: entry.executionTargetProfileId,
    targetConfigurationFingerprint: entry.targetConfigurationFingerprint,
    applicationRevision: entry.applicationRevision,
    adapterKind: entry.adapterKind,
    adapterCacheSchemaVersion: entry.adapterCacheSchemaVersion,
  }
}

function assertProjectKey(
  expectedProjectKey: string,
  key: ExecutionCacheKey,
): void {
  if (key.projectKey !== expectedProjectKey) {
    throw new Error('Execution cache key belongs to another checkout')
  }
}

function writeEntry(
  db: Database,
  serialized: SerializedExecutionCacheEnvelope,
  metadata: ExecutionCacheWriteMetadata,
  timestamp: string,
): void {
  const key = serialized.key
  db.run(
    `INSERT INTO entries (
       key_digest, project_key, scenario_id, scenario_revision,
       execution_target_profile_id, target_configuration_fingerprint,
       application_revision, adapter_kind, adapter_cache_schema_version,
       serialized_envelope, payload_digest, source_run_id, evaluation_model,
       evaluation_inference_count, created_at, last_used_at, hit_count,
       size_bytes
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
     ON CONFLICT(key_digest) DO UPDATE SET
       serialized_envelope = excluded.serialized_envelope,
       payload_digest = excluded.payload_digest,
       source_run_id = excluded.source_run_id,
       evaluation_model = excluded.evaluation_model,
       evaluation_inference_count = excluded.evaluation_inference_count,
       created_at = excluded.created_at,
       last_used_at = excluded.last_used_at,
       hit_count = 0,
       size_bytes = excluded.size_bytes`,
    [
      keyDigest(key),
      ...keyValues(key),
      serialized.source,
      digest(serialized.source),
      metadata.sourceRunId,
      metadata.evaluationModel ?? null,
      metadata.evaluationInferenceCount,
      timestamp,
      timestamp,
      Buffer.byteLength(serialized.source, 'utf8'),
    ],
  )
}

function evictLeastRecentlyUsed(db: Database, maxBytes: number): number {
  const total = db
    .query('SELECT COALESCE(SUM(size_bytes), 0) AS bytes FROM entries')
    .get() as StoredBytesRow
  let retainedBytes = total.bytes
  let evictedEntries = 0
  while (retainedBytes > maxBytes) {
    const oldest = db
      .query(
        `SELECT key_digest AS keyDigest, size_bytes AS sizeBytes
         FROM entries
         ORDER BY last_used_at, created_at, key_digest
         LIMIT 1`,
      )
      .get() as StoredEntrySize | null
    if (!oldest) break
    db.run('DELETE FROM entries WHERE key_digest = ?', [oldest.keyDigest])
    retainedBytes -= oldest.sizeBytes
    evictedEntries++
  }
  return evictedEntries
}

function metadataFromRow(
  entry: IndexedExecutionCacheEntry,
): ExecutionCacheEntryMetadata {
  return {
    key: keyFromRow(entry),
    sourceRunId: entry.sourceRunId,
    ...(entry.evaluationModel
      ? { evaluationModel: entry.evaluationModel }
      : {}),
    evaluationInferenceCount: entry.evaluationInferenceCount,
    createdAt: entry.createdAt,
    lastUsedAt: entry.lastUsedAt,
    hitCount: entry.hitCount,
    payloadDigest: entry.payloadDigest,
    sizeBytes: entry.sizeBytes,
  }
}

export function createLocalExecutionCacheEntries(
  options: LocalExecutionCacheEntriesOptions,
): ExecutionCacheStore {
  const { database, maxBytes, now, projectKey } = options
  return {
    async read(key) {
      assertProjectKey(projectKey, key)
      return database.use((db) => {
        const row = db
          .query(
            `UPDATE entries
             SET last_used_at = ?, hit_count = hit_count + 1
             WHERE key_digest = ?
             RETURNING serialized_envelope AS source`,
          )
          .get(now().toISOString(), keyDigest(key)) as StoredEnvelopeRow | null
        return row?.source
      })
    },
    async write(serialized, metadata) {
      assertProjectKey(projectKey, serialized.key)
      return database.use((db) =>
        db
          .transaction(() => {
            writeEntry(db, serialized, metadata, now().toISOString())
            const evictedEntries = evictLeastRecentlyUsed(db, maxBytes)
            const retained = db
              .query('SELECT 1 AS retained FROM entries WHERE key_digest = ?')
              .get(keyDigest(serialized.key)) as RetainedEntryRow | null
            return { stored: retained !== null, evictedEntries }
          })
          .immediate(),
      )
    },
    async delete(key) {
      assertProjectKey(projectKey, key)
      await database.use((db) => {
        db.run('DELETE FROM entries WHERE key_digest = ?', [keyDigest(key)])
      })
    },
    async inspect(): Promise<ExecutionCacheEntryMetadata[]> {
      return database.use((db) =>
        db
          .query(
            `SELECT
               project_key AS projectKey,
               scenario_id AS scenarioId,
               scenario_revision AS scenarioRevision,
               execution_target_profile_id AS executionTargetProfileId,
               target_configuration_fingerprint AS targetConfigurationFingerprint,
               application_revision AS applicationRevision,
               adapter_kind AS adapterKind,
               adapter_cache_schema_version AS adapterCacheSchemaVersion,
               source_run_id AS sourceRunId,
               evaluation_model AS evaluationModel,
               evaluation_inference_count AS evaluationInferenceCount,
               created_at AS createdAt,
               last_used_at AS lastUsedAt,
               hit_count AS hitCount,
               payload_digest AS payloadDigest,
               size_bytes AS sizeBytes
             FROM entries
             ORDER BY last_used_at DESC, created_at DESC, key_digest`,
          )
          .all()
          .map((row) => metadataFromRow(row as IndexedExecutionCacheEntry)),
      )
    },
    async clear() {
      await database.use((db) =>
        db
          .transaction(() => {
            db.run('DELETE FROM entries')
            db.run('DELETE FROM leases')
          })
          .immediate(),
      )
    },
  }
}
