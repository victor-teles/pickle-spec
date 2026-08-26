import type { Database } from 'bun:sqlite'
import { createHash } from 'node:crypto'
import type {
  ExecutionCacheEntrySnapshot,
  ExecutionCacheKey,
  ExecutionCacheWriteMetadata,
  SerializedExecutionCacheEnvelope,
} from './execution-cache'

interface StoredBytesRow {
  bytes: number
}

interface StoredEntrySize {
  keyDigest: string
  sizeBytes: number
}

interface RetainedEntryRow {
  retained: number
}

type SqliteNamedBindingValue = string | number | null

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

export type ExecutionCacheEntryWriteMode =
  | { kind: 'upsert' }
  | { kind: 'compare-and-swap'; expectedRevision?: number }

interface EntryWriteFields {
  [name: string]: SqliteNamedBindingValue
  serializedEnvelope: string
  payloadDigest: string
  sourceRunId: string
  evaluationModel: string | null
  evaluationInferenceCount: number
  createdAt: string
  lastUsedAt: string
  sizeBytes: number
  keyDigest: string
}

interface CompareAndSwapEntryBindings extends EntryWriteFields {
  expectedRevision: number
}

interface InsertEntryBindings extends EntryWriteFields {
  projectKey: string
  scenarioId: string
  scenarioRevision: string
  executionTargetProfileId: string
  targetConfigurationFingerprint: string
  applicationRevision: string
  adapterKind: string
  adapterCacheSchemaVersion: string
}

export function executionCacheDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export function executionCacheKeyValues(
  key: ExecutionCacheKey,
): ExecutionCacheKeyValues {
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

export function executionCacheKeyDigest(key: ExecutionCacheKey): string {
  return executionCacheDigest(JSON.stringify(executionCacheKeyValues(key)))
}

export function assertExecutionCacheProjectKey(
  expectedProjectKey: string,
  key: ExecutionCacheKey,
): void {
  if (key.projectKey !== expectedProjectKey) {
    throw new Error('Execution cache key belongs to another checkout')
  }
}

export function executionCacheEntrySize(
  serialized: SerializedExecutionCacheEnvelope,
): number {
  return Buffer.byteLength(serialized.source, 'utf8')
}

export function readExecutionCacheEntrySnapshot(
  db: Database,
  digestKey: string,
): ExecutionCacheEntrySnapshot | undefined {
  const row = db
    .query(
      `SELECT serialized_envelope AS source, revision
       FROM entries WHERE key_digest = ?`,
    )
    .get(digestKey) as ExecutionCacheEntrySnapshot | null
  return row ?? undefined
}

function entryWriteFields(
  serialized: SerializedExecutionCacheEnvelope,
  metadata: ExecutionCacheWriteMetadata,
  timestamp: string,
): EntryWriteFields {
  return {
    serializedEnvelope: serialized.source,
    payloadDigest: executionCacheDigest(serialized.source),
    sourceRunId: metadata.sourceRunId,
    evaluationModel: metadata.evaluationModel ?? null,
    evaluationInferenceCount: metadata.evaluationInferenceCount,
    createdAt: timestamp,
    lastUsedAt: timestamp,
    sizeBytes: executionCacheEntrySize(serialized),
    keyDigest: executionCacheKeyDigest(serialized.key),
  }
}

function compareAndSwapEntryBindings(
  serialized: SerializedExecutionCacheEnvelope,
  metadata: ExecutionCacheWriteMetadata,
  timestamp: string,
  expectedRevision: number,
): CompareAndSwapEntryBindings {
  return {
    ...entryWriteFields(serialized, metadata, timestamp),
    expectedRevision,
  }
}

function insertEntryBindings(
  serialized: SerializedExecutionCacheEnvelope,
  metadata: ExecutionCacheWriteMetadata,
  timestamp: string,
): InsertEntryBindings {
  const key = serialized.key
  return {
    ...entryWriteFields(serialized, metadata, timestamp),
    projectKey: key.projectKey,
    scenarioId: key.scenarioId,
    scenarioRevision: key.scenarioRevision,
    executionTargetProfileId: key.executionTargetProfileId,
    targetConfigurationFingerprint: key.targetConfigurationFingerprint,
    applicationRevision: key.applicationRevision,
    adapterKind: key.adapterKind,
    adapterCacheSchemaVersion: key.adapterCacheSchemaVersion,
  }
}

export function writeExecutionCacheEntry(
  db: Database,
  serialized: SerializedExecutionCacheEnvelope,
  metadata: ExecutionCacheWriteMetadata,
  timestamp: string,
  mode: ExecutionCacheEntryWriteMode,
): boolean {
  if (mode.kind === 'compare-and-swap' && mode.expectedRevision !== undefined) {
    const bindings = compareAndSwapEntryBindings(
      serialized,
      metadata,
      timestamp,
      mode.expectedRevision,
    )
    const result = db
      .query<unknown, CompareAndSwapEntryBindings>(
        `UPDATE entries SET
         serialized_envelope = $serializedEnvelope,
         payload_digest = $payloadDigest,
         source_run_id = $sourceRunId,
         evaluation_model = $evaluationModel,
         evaluation_inference_count = $evaluationInferenceCount,
         created_at = $createdAt,
         last_used_at = $lastUsedAt,
         hit_count = 0,
         size_bytes = $sizeBytes,
         revision = revision + 1
       WHERE key_digest = $keyDigest AND revision = $expectedRevision`,
      )
      .run(bindings)
    return result.changes === 1
  }
  const conflictClause =
    mode.kind === 'upsert'
      ? `ON CONFLICT(key_digest) DO UPDATE SET
           serialized_envelope = excluded.serialized_envelope,
           payload_digest = excluded.payload_digest,
           source_run_id = excluded.source_run_id,
           evaluation_model = excluded.evaluation_model,
           evaluation_inference_count = excluded.evaluation_inference_count,
           created_at = excluded.created_at,
           last_used_at = excluded.last_used_at,
           hit_count = 0,
           size_bytes = excluded.size_bytes,
           revision = entries.revision + 1`
      : 'ON CONFLICT(key_digest) DO NOTHING'
  const bindings = insertEntryBindings(serialized, metadata, timestamp)
  const result = db
    .query<unknown, InsertEntryBindings>(
      `INSERT INTO entries (
       serialized_envelope, payload_digest, source_run_id, evaluation_model,
       evaluation_inference_count, created_at, last_used_at, hit_count,
       size_bytes, key_digest, project_key, scenario_id, scenario_revision,
       execution_target_profile_id, target_configuration_fingerprint,
       application_revision, adapter_kind, adapter_cache_schema_version,
       revision
     ) VALUES (
       $serializedEnvelope, $payloadDigest, $sourceRunId, $evaluationModel,
       $evaluationInferenceCount, $createdAt, $lastUsedAt, 0, $sizeBytes,
       $keyDigest, $projectKey, $scenarioId, $scenarioRevision,
       $executionTargetProfileId, $targetConfigurationFingerprint,
       $applicationRevision, $adapterKind, $adapterCacheSchemaVersion, 1
     )
     ${conflictClause}`,
    )
    .run(bindings)
  return result.changes === 1
}

export function evictLeastRecentlyUsed(
  db: Database,
  projectKey: string,
  maxBytes: number,
): number {
  const total = db
    .query(
      `SELECT COALESCE(SUM(size_bytes), 0) AS bytes
       FROM entries WHERE project_key = ?`,
    )
    .get(projectKey) as StoredBytesRow
  let retainedBytes = total.bytes
  let evictedEntries = 0
  while (retainedBytes > maxBytes) {
    const oldest = db
      .query(
        `SELECT key_digest AS keyDigest, size_bytes AS sizeBytes
         FROM entries
         WHERE project_key = ?
         ORDER BY last_used_at, created_at, key_digest
         LIMIT 1`,
      )
      .get(projectKey) as StoredEntrySize | null
    if (!oldest) break
    db.run('DELETE FROM entries WHERE key_digest = ?', [oldest.keyDigest])
    retainedBytes -= oldest.sizeBytes
    evictedEntries++
  }
  return evictedEntries
}

export function executionCacheEntryIsRetained(
  db: Database,
  key: ExecutionCacheKey,
): boolean {
  const retained = db
    .query('SELECT 1 AS retained FROM entries WHERE key_digest = ?')
    .get(executionCacheKeyDigest(key)) as RetainedEntryRow | null
  return retained !== null
}
