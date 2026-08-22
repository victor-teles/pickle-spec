import type { Database } from 'bun:sqlite'
import { createHash, randomUUID } from 'node:crypto'
import type {
  ExecutionCacheCoordination,
  ExecutionCacheKey,
  ExecutionCacheLease,
  ExecutionCacheWriteMetadata,
  SerializedExecutionCacheEnvelope,
} from './execution-cache'
import type { LocalExecutionCacheDatabase } from './local-execution-cache-database'

export interface ExecutionCacheLeaseTiming {
  ttlMs: number
  heartbeatMs: number
  waitTimeoutMs: number
  minPollMs: number
  maxPollMs: number
}

interface LocalExecutionCacheCoordinationOptions {
  database: LocalExecutionCacheDatabase
  projectKey: string
  maxBytes: number
  now: () => Date
  timing?: Partial<ExecutionCacheLeaseTiming>
}

interface LeaseRow {
  ownerToken: string
  expiresAt: number
  baselinePayloadDigest: string | null
}

interface PayloadDigestRow {
  payloadDigest: string
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

interface StoredEntrySize {
  keyDigest: string
  sizeBytes: number
}

const defaultTiming: ExecutionCacheLeaseTiming = {
  ttlMs: 30_000,
  heartbeatMs: 10_000,
  waitTimeoutMs: 30_000,
  minPollMs: 100,
  maxPollMs: 500,
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function keyDigest(key: ExecutionCacheKey): string {
  return digest(
    JSON.stringify([
      key.projectKey,
      key.scenarioId,
      key.scenarioRevision,
      key.executionTargetProfileId,
      key.targetConfigurationFingerprint,
      key.applicationRevision,
      key.adapterKind,
      key.adapterCacheSchemaVersion,
    ]),
  )
}

function assertProjectKey(projectKey: string, key: ExecutionCacheKey): void {
  if (key.projectKey !== projectKey) {
    throw new Error('Execution cache key belongs to another checkout')
  }
}

function currentPayloadDigest(
  db: Database,
  digestKey: string,
): string | undefined {
  const row = db
    .query(
      'SELECT payload_digest AS payloadDigest FROM entries WHERE key_digest = ?',
    )
    .get(digestKey) as PayloadDigestRow | null
  return row?.payloadDigest
}

function leaseFromRow(
  key: ExecutionCacheKey,
  row: LeaseRow,
  heartbeatMs: number,
): ExecutionCacheLease {
  return {
    key,
    ownerToken: row.ownerToken,
    ...(row.baselinePayloadDigest
      ? { baselinePayloadDigest: row.baselinePayloadDigest }
      : {}),
    heartbeatMs,
  }
}

function waitForDelay(delayMs: number, signal?: AbortSignal): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    const onAbort = () => {
      clearTimeout(timer)
      resolve(false)
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function pollDelay(timing: ExecutionCacheLeaseTiming): number {
  const range = timing.maxPollMs - timing.minPollMs
  return timing.minPollMs + Math.floor(Math.random() * (range + 1))
}

function writeEntry(
  db: Database,
  serialized: SerializedExecutionCacheEnvelope,
  metadata: ExecutionCacheWriteMetadata,
  timestamp: string,
  baselinePayloadDigest: string | undefined,
): boolean {
  const key = serialized.key
  const values = [
    serialized.source,
    digest(serialized.source),
    metadata.sourceRunId,
    metadata.evaluationModel ?? null,
    metadata.evaluationInferenceCount,
    timestamp,
    timestamp,
    Buffer.byteLength(serialized.source, 'utf8'),
    keyDigest(key),
  ]
  if (baselinePayloadDigest) {
    const result = db.run(
      `UPDATE entries SET
         serialized_envelope = ?, payload_digest = ?, source_run_id = ?,
         evaluation_model = ?, evaluation_inference_count = ?, created_at = ?,
         last_used_at = ?, hit_count = 0, size_bytes = ?
       WHERE key_digest = ? AND payload_digest = ?`,
      [...values, baselinePayloadDigest],
    )
    return result.changes === 1
  }
  const result = db.run(
    `INSERT OR IGNORE INTO entries (
       serialized_envelope, payload_digest, source_run_id, evaluation_model,
       evaluation_inference_count, created_at, last_used_at, hit_count,
       size_bytes, key_digest, project_key, scenario_id, scenario_revision,
       execution_target_profile_id, target_configuration_fingerprint,
       application_revision, adapter_kind, adapter_cache_schema_version
     ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      ...values,
      key.projectKey,
      key.scenarioId,
      key.scenarioRevision,
      key.executionTargetProfileId,
      key.targetConfigurationFingerprint,
      key.applicationRevision,
      key.adapterKind,
      key.adapterCacheSchemaVersion,
    ],
  )
  return result.changes === 1
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
         FROM entries ORDER BY last_used_at, created_at, key_digest LIMIT 1`,
      )
      .get() as StoredEntrySize | null
    if (!oldest) break
    db.run('DELETE FROM entries WHERE key_digest = ?', [oldest.keyDigest])
    retainedBytes -= oldest.sizeBytes
    evictedEntries++
  }
  return evictedEntries
}

function validateTiming(
  timing: Partial<ExecutionCacheLeaseTiming> | undefined,
): ExecutionCacheLeaseTiming {
  const resolved = { ...defaultTiming, ...timing }
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error(
        `Execution cache ${name} must be an integer greater than 0`,
      )
    }
  }
  if (resolved.minPollMs > resolved.maxPollMs) {
    throw new Error('Execution cache minPollMs must not exceed maxPollMs')
  }
  if (resolved.heartbeatMs >= resolved.ttlMs) {
    throw new Error('Execution cache heartbeatMs must be less than ttlMs')
  }
  return resolved
}

export function createLocalExecutionCacheCoordination(
  options: LocalExecutionCacheCoordinationOptions,
): ExecutionCacheCoordination {
  const { database, maxBytes, now, projectKey } = options
  const timing = validateTiming(options.timing)
  return {
    async readCurrent(key) {
      assertProjectKey(projectKey, key)
      return database.use((db) => {
        const row = db
          .query(
            'SELECT serialized_envelope AS source FROM entries WHERE key_digest = ?',
          )
          .get(keyDigest(key)) as StoredEnvelopeRow | null
        return row?.source
      })
    },
    async acquire(key) {
      assertProjectKey(projectKey, key)
      return database.use((db) =>
        db
          .transaction(() => {
            const digestKey = keyDigest(key)
            const timestamp = now().getTime()
            const existing = db
              .query(
                `SELECT owner_token AS ownerToken, expires_at AS expiresAt,
                      baseline_payload_digest AS baselinePayloadDigest
               FROM leases WHERE key_digest = ?`,
              )
              .get(digestKey) as LeaseRow | null
            if (existing && existing.expiresAt > timestamp) {
              return {
                acquired: false as const,
                ownerToken: existing.ownerToken,
                ...(existing.baselinePayloadDigest
                  ? { baselinePayloadDigest: existing.baselinePayloadDigest }
                  : {}),
              }
            }
            const ownerToken = randomUUID()
            const baselinePayloadDigest = currentPayloadDigest(db, digestKey)
            db.run(
              `INSERT INTO leases (
               key_digest, owner_token, expires_at, baseline_payload_digest
             ) VALUES (?, ?, ?, ?)
             ON CONFLICT(key_digest) DO UPDATE SET
               owner_token = excluded.owner_token,
               expires_at = excluded.expires_at,
               baseline_payload_digest = excluded.baseline_payload_digest
             WHERE leases.expires_at <= ?`,
              [
                digestKey,
                ownerToken,
                timestamp + timing.ttlMs,
                baselinePayloadDigest ?? null,
                timestamp,
              ],
            )
            const acquired = db
              .query(
                `SELECT owner_token AS ownerToken, expires_at AS expiresAt,
                      baseline_payload_digest AS baselinePayloadDigest
               FROM leases WHERE key_digest = ?`,
              )
              .get(digestKey) as LeaseRow
            if (acquired.ownerToken !== ownerToken) {
              return {
                acquired: false as const,
                ownerToken: acquired.ownerToken,
                ...(acquired.baselinePayloadDigest
                  ? { baselinePayloadDigest: acquired.baselinePayloadDigest }
                  : {}),
              }
            }
            return {
              acquired: true as const,
              lease: leaseFromRow(key, acquired, timing.heartbeatMs),
            }
          })
          .immediate(),
      )
    },
    async renew(lease) {
      assertProjectKey(projectKey, lease.key)
      return database.use((db) => {
        const timestamp = now().getTime()
        const result = db.run(
          `UPDATE leases SET expires_at = ?
           WHERE key_digest = ? AND owner_token = ? AND expires_at > ?`,
          [
            timestamp + timing.ttlMs,
            keyDigest(lease.key),
            lease.ownerToken,
            timestamp,
          ],
        )
        return result.changes === 1
      })
    },
    async wait(key, ownerToken, baselinePayloadDigest, signal) {
      assertProjectKey(projectKey, key)
      const deadline = now().getTime() + timing.waitTimeoutMs
      while (!signal?.aborted) {
        const timestamp = now().getTime()
        const active = await database.use((db) =>
          db
            .query(
              `SELECT 1 FROM leases
                 WHERE key_digest = ? AND owner_token = ? AND expires_at > ?`,
            )
            .get(keyDigest(key), ownerToken, timestamp),
        )
        if (signal?.aborted) break
        if (!active) {
          const current = await database.use((db) =>
            currentPayloadDigest(db, keyDigest(key)),
          )
          return {
            status: 'released' as const,
            entryChanged: current !== baselinePayloadDigest,
          }
        }
        if (timestamp >= deadline) break
        const delayMs = Math.min(pollDelay(timing), deadline - timestamp)
        if (!(await waitForDelay(delayMs, signal))) break
      }
      return {
        status: signal?.aborted
          ? ('cancelled' as const)
          : ('timed-out' as const),
      }
    },
    async publish(lease, serialized, metadata) {
      assertProjectKey(projectKey, lease.key)
      assertProjectKey(projectKey, serialized.key)
      if (keyDigest(lease.key) !== keyDigest(serialized.key)) {
        throw new Error('Execution cache lease cannot publish another key')
      }
      return database.use((db) =>
        db
          .transaction(() => {
            const timestamp = now()
            const active = db
              .query(
                `SELECT owner_token AS ownerToken, expires_at AS expiresAt,
                      baseline_payload_digest AS baselinePayloadDigest
               FROM leases WHERE key_digest = ?`,
              )
              .get(keyDigest(lease.key)) as LeaseRow | null
            if (
              !active ||
              active.ownerToken !== lease.ownerToken ||
              active.expiresAt <= timestamp.getTime()
            ) {
              return { published: false, stored: false, evictedEntries: 0 }
            }
            const published = writeEntry(
              db,
              serialized,
              metadata,
              timestamp.toISOString(),
              active.baselinePayloadDigest ?? undefined,
            )
            db.run(
              'DELETE FROM leases WHERE key_digest = ? AND owner_token = ?',
              [keyDigest(lease.key), lease.ownerToken],
            )
            if (!published) {
              return { published: false, stored: false, evictedEntries: 0 }
            }
            const evictedEntries = evictLeastRecentlyUsed(db, maxBytes)
            const retained = db
              .query('SELECT 1 AS retained FROM entries WHERE key_digest = ?')
              .get(keyDigest(serialized.key)) as RetainedEntryRow | null
            return {
              published: true,
              stored: retained !== null,
              evictedEntries,
            }
          })
          .immediate(),
      )
    },
    async release(lease) {
      assertProjectKey(projectKey, lease.key)
      await database.use((db) => {
        db.run('DELETE FROM leases WHERE key_digest = ? AND owner_token = ?', [
          keyDigest(lease.key),
          lease.ownerToken,
        ])
      })
    },
  }
}
