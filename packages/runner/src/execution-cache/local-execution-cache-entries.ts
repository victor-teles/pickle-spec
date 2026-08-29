import type {
  ExecutionCacheEntryMetadata,
  ExecutionCacheKey,
  ExecutionCacheStore,
} from './execution-cache'
import type { LocalExecutionCacheDatabase } from './local-execution-cache-database'
import {
  assertExecutionCacheProjectKey,
  evictLeastRecentlyUsed,
  executionCacheEntryIsRetained,
  executionCacheKeyDigest,
  writeExecutionCacheEntry,
} from './local-execution-cache-records'

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

interface StoredEnvelopeRow {
  source: string
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

function inspectLocalEntries(
  database: LocalExecutionCacheDatabase,
  projectKey: string,
): Promise<ExecutionCacheEntryMetadata[]> {
  return database.use((db) =>
    db
      .query(
        `SELECT
           project_key AS projectKey, scenario_id AS scenarioId,
           scenario_revision AS scenarioRevision,
           execution_target_profile_id AS executionTargetProfileId,
           target_configuration_fingerprint AS targetConfigurationFingerprint,
           application_revision AS applicationRevision,
           adapter_kind AS adapterKind,
           adapter_cache_schema_version AS adapterCacheSchemaVersion,
           source_run_id AS sourceRunId, evaluation_model AS evaluationModel,
           evaluation_inference_count AS evaluationInferenceCount,
           created_at AS createdAt, last_used_at AS lastUsedAt,
           hit_count AS hitCount, payload_digest AS payloadDigest,
           size_bytes AS sizeBytes
         FROM entries WHERE project_key = ?
         ORDER BY last_used_at DESC, created_at DESC, key_digest`,
      )
      .all(projectKey)
      .map((row) => metadataFromRow(row as IndexedExecutionCacheEntry)),
  )
}

async function clearLocalEntries(
  database: LocalExecutionCacheDatabase,
  projectKey: string,
): Promise<void> {
  await database.use((db) =>
    db
      .transaction(() => {
        db.run('DELETE FROM entries WHERE project_key = ?', [projectKey])
        db.run('DELETE FROM leases WHERE project_key = ?', [projectKey])
        db.run('DELETE FROM lease_outcomes WHERE project_key = ?', [projectKey])
      })
      .immediate(),
  )
}

export function createLocalExecutionCacheEntries(
  options: LocalExecutionCacheEntriesOptions,
): ExecutionCacheStore {
  const { database, maxBytes, now, projectKey } = options
  return {
    async read(key) {
      assertExecutionCacheProjectKey(projectKey, key)
      return database.use((db) => {
        const row = db
          .query(
            `UPDATE entries
             SET last_used_at = ?, hit_count = hit_count + 1
             WHERE key_digest = ?
             RETURNING serialized_envelope AS source`,
          )
          .get(
            now().toISOString(),
            executionCacheKeyDigest(key),
          ) as StoredEnvelopeRow | null
        return row?.source
      })
    },
    async write(serialized, metadata) {
      assertExecutionCacheProjectKey(projectKey, serialized.key)
      return database.use((db) =>
        db
          .transaction(() => {
            writeExecutionCacheEntry(
              db,
              serialized,
              metadata,
              now().toISOString(),
              { kind: 'upsert' },
            )
            const evictedEntries = evictLeastRecentlyUsed(
              db,
              projectKey,
              maxBytes,
            )
            return {
              stored: executionCacheEntryIsRetained(db, serialized.key),
              evictedEntries,
            }
          })
          .immediate(),
      )
    },
    async delete(key) {
      assertExecutionCacheProjectKey(projectKey, key)
      await database.use((db) => {
        db.run('DELETE FROM entries WHERE key_digest = ?', [
          executionCacheKeyDigest(key),
        ])
      })
    },
    async inspect(): Promise<ExecutionCacheEntryMetadata[]> {
      return inspectLocalEntries(database, projectKey)
    },
    async clear() {
      await clearLocalEntries(database, projectKey)
    },
  }
}
