import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import type {
  ExecutionCacheCoordination,
  ExecutionCacheKey,
  ExecutionCacheLease,
  ExecutionCacheLeaseAcquisition,
  ExecutionCacheLeasePublicationResult,
  ExecutionCacheWriteMetadata,
  SerializedExecutionCacheEnvelope,
  SerializedExecutionCacheTerminalOutcome,
} from '../execution-cache'
import type { LocalExecutionCacheDatabase } from './local-execution-cache-database'
import type { ExecutionCacheLeaseTiming } from './local-execution-cache-lease-wait'
import {
  validateTiming,
  waitForLeaseRelease,
} from './local-execution-cache-lease-wait'
import {
  assertExecutionCacheProjectKey,
  evictLeastRecentlyUsed,
  executionCacheEntryIsRetained,
  executionCacheEntrySize,
  executionCacheKeyDigest,
  readExecutionCacheEntrySnapshot,
  writeExecutionCacheEntry,
} from './local-execution-cache-records'

export type { ExecutionCacheLeaseTiming } from './local-execution-cache-lease-wait'

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
  baselineRevision: number | null
}

interface PublishLeaseInput {
  db: Database
  lease: ExecutionCacheLease
  serialized: SerializedExecutionCacheEnvelope
  metadata: ExecutionCacheWriteMetadata
  projectKey: string
  maxBytes: number
  now: () => Date
}

function renewLease(
  database: LocalExecutionCacheDatabase,
  lease: ExecutionCacheLease,
  timing: ExecutionCacheLeaseTiming,
  now: () => Date,
): Promise<boolean> {
  return database.use((db) => {
    const timestamp = now().getTime()
    const result = db.run(
      `UPDATE leases SET expires_at = ?
       WHERE key_digest = ? AND owner_token = ? AND expires_at > ?`,
      [
        timestamp + timing.ttlMs,
        executionCacheKeyDigest(lease.key),
        lease.ownerToken,
        timestamp,
      ],
    )
    return result.changes === 1
  })
}

function publishLocalLease(
  options: LocalExecutionCacheCoordinationOptions,
  lease: ExecutionCacheLease,
  serialized: SerializedExecutionCacheEnvelope,
  metadata: ExecutionCacheWriteMetadata,
): Promise<ExecutionCacheLeasePublicationResult> {
  const { database, maxBytes, now, projectKey } = options
  assertExecutionCacheProjectKey(projectKey, lease.key)
  assertExecutionCacheProjectKey(projectKey, serialized.key)
  if (
    executionCacheKeyDigest(lease.key) !==
    executionCacheKeyDigest(serialized.key)
  ) {
    throw new Error('Execution cache lease cannot publish another key')
  }
  return database.use((db) =>
    db
      .transaction(() =>
        publishLeaseEntry({
          db,
          lease,
          serialized,
          metadata,
          projectKey,
          maxBytes,
          now,
        }),
      )
      .immediate(),
  )
}

function completeLocalLease(
  options: LocalExecutionCacheCoordinationOptions,
  lease: ExecutionCacheLease,
  terminalOutcome: SerializedExecutionCacheTerminalOutcome,
): Promise<boolean> {
  const { database, now, projectKey } = options
  return database.use((db) =>
    db
      .transaction(() => {
        const digestKey = executionCacheKeyDigest(lease.key)
        const timestamp = now().getTime()
        const active = db
          .query(
            `SELECT 1 FROM leases
             WHERE key_digest = ? AND owner_token = ? AND expires_at > ?`,
          )
          .get(digestKey, lease.ownerToken, timestamp)
        if (!active) return false
        db.run(
          `INSERT INTO lease_outcomes (
             key_digest, project_key, owner_token, terminal_outcome, completed_at
           ) VALUES (?, ?, ?, ?, ?)`,
          [
            digestKey,
            projectKey,
            lease.ownerToken,
            terminalOutcome.source,
            timestamp,
          ],
        )
        db.run('DELETE FROM leases WHERE key_digest = ? AND owner_token = ?', [
          digestKey,
          lease.ownerToken,
        ])
        return true
      })
      .immediate(),
  )
}

function leaseFromRow(
  key: ExecutionCacheKey,
  row: LeaseRow,
  heartbeatMs: number,
): ExecutionCacheLease {
  return {
    key,
    ownerToken: row.ownerToken,
    baselineRevision: row.baselineRevision ?? undefined,
    heartbeatMs,
  }
}

function leaseIsOwned(
  active: LeaseRow | null,
  lease: ExecutionCacheLease,
  timestamp: number,
): boolean {
  return Boolean(
    active &&
      active.ownerToken === lease.ownerToken &&
      active.expiresAt > timestamp,
  )
}

function deleteLease(
  db: Database,
  digestKey: string,
  ownerToken: string,
): void {
  db.run('DELETE FROM leases WHERE key_digest = ? AND owner_token = ?', [
    digestKey,
    ownerToken,
  ])
}

function publishLeaseEntry(
  input: PublishLeaseInput,
): ExecutionCacheLeasePublicationResult {
  const { db, lease, maxBytes, metadata, now, projectKey, serialized } = input
  const timestamp = now()
  const digestKey = executionCacheKeyDigest(lease.key)
  const active = db
    .query(
      `SELECT owner_token AS ownerToken, expires_at AS expiresAt,
              baseline_revision AS baselineRevision
       FROM leases WHERE key_digest = ?`,
    )
    .get(digestKey) as LeaseRow | null
  if (!leaseIsOwned(active, lease, timestamp.getTime())) {
    return { published: false, stored: false, evictedEntries: 0 }
  }
  if (executionCacheEntrySize(serialized) > maxBytes) {
    return { published: true, stored: false, evictedEntries: 0 }
  }

  const published = writeExecutionCacheEntry(
    db,
    serialized,
    metadata,
    timestamp.toISOString(),
    {
      kind: 'compare-and-swap',
      expectedRevision: active?.baselineRevision ?? undefined,
    },
  )
  if (!published) {
    deleteLease(db, digestKey, lease.ownerToken)
    return { published: false, stored: false, evictedEntries: 0 }
  }

  const evictedEntries = evictLeastRecentlyUsed(db, projectKey, maxBytes)
  const stored = executionCacheEntryIsRetained(db, serialized.key)
  if (stored) deleteLease(db, digestKey, lease.ownerToken)
  return { published: true, stored, evictedEntries }
}

function acquireLease(
  db: Database,
  key: ExecutionCacheKey,
  projectKey: string,
  timing: ExecutionCacheLeaseTiming,
  now: () => Date,
): ExecutionCacheLeaseAcquisition {
  const digestKey = executionCacheKeyDigest(key)
  const timestamp = now().getTime()
  db.run('DELETE FROM lease_outcomes WHERE completed_at <= ?', [
    timestamp - timing.waitTimeoutMs,
  ])
  const existing = db
    .query(
      `SELECT owner_token AS ownerToken, expires_at AS expiresAt,
              baseline_revision AS baselineRevision
       FROM leases WHERE key_digest = ?`,
    )
    .get(digestKey) as LeaseRow | null
  if (existing && existing.expiresAt > timestamp) {
    return {
      acquired: false,
      ownerToken: existing.ownerToken,
      baselineRevision: existing.baselineRevision ?? undefined,
    }
  }

  const ownerToken = randomUUID()
  const baselineRevision = readExecutionCacheEntrySnapshot(
    db,
    digestKey,
  )?.revision
  db.run(
    `INSERT INTO leases (
       key_digest, project_key, owner_token, expires_at, baseline_revision
     ) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(key_digest) DO UPDATE SET
       project_key = excluded.project_key,
       owner_token = excluded.owner_token,
       expires_at = excluded.expires_at,
       baseline_revision = excluded.baseline_revision
     WHERE leases.expires_at <= ?`,
    [
      digestKey,
      projectKey,
      ownerToken,
      timestamp + timing.ttlMs,
      baselineRevision ?? null,
      timestamp,
    ],
  )
  const acquired = db
    .query(
      `SELECT owner_token AS ownerToken, expires_at AS expiresAt,
              baseline_revision AS baselineRevision
       FROM leases WHERE key_digest = ?`,
    )
    .get(digestKey) as LeaseRow
  if (acquired.ownerToken !== ownerToken) {
    return {
      acquired: false,
      ownerToken: acquired.ownerToken,
      baselineRevision: acquired.baselineRevision ?? undefined,
    }
  }
  return {
    acquired: true,
    lease: leaseFromRow(key, acquired, timing.heartbeatMs),
  }
}

export function createLocalExecutionCacheCoordination(
  options: LocalExecutionCacheCoordinationOptions,
): ExecutionCacheCoordination {
  const { database, now, projectKey } = options
  const timing = validateTiming(options.timing)
  return {
    async readCurrent(key) {
      assertExecutionCacheProjectKey(projectKey, key)
      return database.use((db) =>
        readExecutionCacheEntrySnapshot(db, executionCacheKeyDigest(key)),
      )
    },
    async acquire(key) {
      assertExecutionCacheProjectKey(projectKey, key)
      return database.use((db) =>
        db
          .transaction(() => acquireLease(db, key, projectKey, timing, now))
          .immediate(),
      )
    },
    async renew(lease) {
      assertExecutionCacheProjectKey(projectKey, lease.key)
      return renewLease(database, lease, timing, now)
    },
    async wait(key, ownerToken, baselineRevision, signal) {
      assertExecutionCacheProjectKey(projectKey, key)
      return waitForLeaseRelease({
        database,
        key,
        ownerToken,
        baselineRevision,
        signal,
        timing,
        now,
      })
    },
    async publish(lease, serialized, metadata) {
      return publishLocalLease(options, lease, serialized, metadata)
    },
    async complete(lease, terminalOutcome) {
      assertExecutionCacheProjectKey(projectKey, lease.key)
      return completeLocalLease(options, lease, terminalOutcome)
    },
    async release(lease) {
      assertExecutionCacheProjectKey(projectKey, lease.key)
      await database.use((db) => {
        db.run('DELETE FROM leases WHERE key_digest = ? AND owner_token = ?', [
          executionCacheKeyDigest(lease.key),
          lease.ownerToken,
        ])
      })
    },
  }
}
