import type { Database } from 'bun:sqlite'
import { randomUUID } from 'node:crypto'
import type {
  ExecutionCacheCoordination,
  ExecutionCacheKey,
  ExecutionCacheLease,
  ExecutionCacheLeaseAcquisition,
  ExecutionCacheLeasePublicationResult,
  ExecutionCacheLeaseWaitResult,
  ExecutionCacheWriteMetadata,
  SerializedExecutionCacheEnvelope,
  SerializedExecutionCacheTerminalOutcome,
} from './execution-cache'
import type { LocalExecutionCacheDatabase } from './local-execution-cache-database'
import {
  assertExecutionCacheProjectKey,
  evictLeastRecentlyUsed,
  executionCacheEntryIsRetained,
  executionCacheEntrySize,
  executionCacheKeyDigest,
  readExecutionCacheEntrySnapshot,
  writeExecutionCacheEntry,
} from './local-execution-cache-records'

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
  baselineRevision: number | null
}

interface LeaseOutcomeRow {
  source: string
}

interface WaitForLeaseInput {
  database: LocalExecutionCacheDatabase
  key: ExecutionCacheKey
  ownerToken: string
  baselineRevision?: number
  signal?: AbortSignal
  timing: ExecutionCacheLeaseTiming
  now: () => Date
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

const defaultTiming: ExecutionCacheLeaseTiming = {
  ttlMs: 30_000,
  heartbeatMs: 10_000,
  waitTimeoutMs: 30_000,
  minPollMs: 100,
  maxPollMs: 500,
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

async function leaseIsActive(
  database: LocalExecutionCacheDatabase,
  digestKey: string,
  ownerToken: string,
  timestamp: number,
): Promise<boolean> {
  const active = await database.use((db) =>
    db
      .query(
        `SELECT 1 FROM leases
         WHERE key_digest = ? AND owner_token = ? AND expires_at > ?`,
      )
      .get(digestKey, ownerToken, timestamp),
  )
  return Boolean(active)
}

async function releasedLeaseResult(
  input: WaitForLeaseInput,
  digestKey: string,
): Promise<ExecutionCacheLeaseWaitResult> {
  const released = await input.database.use((db) => {
    const currentRevision = readExecutionCacheEntrySnapshot(
      db,
      digestKey,
    )?.revision
    const outcome = db
      .query(
        `SELECT terminal_outcome AS source FROM lease_outcomes
         WHERE key_digest = ? AND owner_token = ?`,
      )
      .get(digestKey, input.ownerToken) as LeaseOutcomeRow | null
    return { currentRevision, outcome }
  })
  return {
    status: 'released',
    published: released.currentRevision !== input.baselineRevision,
    terminalOutcome: released.outcome
      ? (released.outcome as SerializedExecutionCacheTerminalOutcome)
      : undefined,
  }
}

async function waitForLeaseRelease(
  input: WaitForLeaseInput,
): Promise<ExecutionCacheLeaseWaitResult> {
  const deadline = input.now().getTime() + input.timing.waitTimeoutMs
  const digestKey = executionCacheKeyDigest(input.key)
  while (!input.signal?.aborted) {
    const timestamp = input.now().getTime()
    const active = await leaseIsActive(
      input.database,
      digestKey,
      input.ownerToken,
      timestamp,
    )
    if (input.signal?.aborted) break
    if (!active) return releasedLeaseResult(input, digestKey)
    if (timestamp >= deadline) break

    const delayMs = Math.min(pollDelay(input.timing), deadline - timestamp)
    if (!(await waitForDelay(delayMs, input.signal))) break
  }
  return { status: input.signal?.aborted ? 'cancelled' : 'timed-out' }
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
  const { database, maxBytes, now, projectKey } = options
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
    },
    async complete(lease, terminalOutcome) {
      assertExecutionCacheProjectKey(projectKey, lease.key)
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
                 key_digest, project_key, owner_token, terminal_outcome,
                 completed_at
               ) VALUES (?, ?, ?, ?, ?)`,
              [
                digestKey,
                projectKey,
                lease.ownerToken,
                terminalOutcome.source,
                timestamp,
              ],
            )
            db.run(
              'DELETE FROM leases WHERE key_digest = ? AND owner_token = ?',
              [digestKey, lease.ownerToken],
            )
            return true
          })
          .immediate(),
      )
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
