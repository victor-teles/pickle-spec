import { randomUUID } from 'node:crypto'
import type {
  ExecutionCacheCoordination,
  ExecutionCacheKey,
  ExecutionCacheLease,
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
          .transaction(() => {
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
                acquired: false as const,
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
               key_digest, owner_token, expires_at, baseline_revision
             ) VALUES (?, ?, ?, ?)
             ON CONFLICT(key_digest) DO UPDATE SET
               owner_token = excluded.owner_token,
               expires_at = excluded.expires_at,
               baseline_revision = excluded.baseline_revision
             WHERE leases.expires_at <= ?`,
              [
                digestKey,
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
                acquired: false as const,
                ownerToken: acquired.ownerToken,
                baselineRevision: acquired.baselineRevision ?? undefined,
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
      const deadline = now().getTime() + timing.waitTimeoutMs
      while (!signal?.aborted) {
        const timestamp = now().getTime()
        const active = await database.use((db) =>
          db
            .query(
              `SELECT 1 FROM leases
                 WHERE key_digest = ? AND owner_token = ? AND expires_at > ?`,
            )
            .get(executionCacheKeyDigest(key), ownerToken, timestamp),
        )
        if (signal?.aborted) break
        if (!active) {
          const released = await database.use((db) => {
            const digestKey = executionCacheKeyDigest(key)
            const currentRevision = readExecutionCacheEntrySnapshot(
              db,
              digestKey,
            )?.revision
            const outcome = db
              .query(
                `SELECT terminal_outcome AS source FROM lease_outcomes
                 WHERE key_digest = ? AND owner_token = ?`,
              )
              .get(digestKey, ownerToken) as LeaseOutcomeRow | null
            return { currentRevision, outcome }
          })
          return {
            status: 'released' as const,
            published: released.currentRevision !== baselineRevision,
            terminalOutcome: released.outcome
              ? (released.outcome as SerializedExecutionCacheTerminalOutcome)
              : undefined,
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
          .transaction(() => {
            const timestamp = now()
            const active = db
              .query(
                `SELECT owner_token AS ownerToken, expires_at AS expiresAt,
                      baseline_revision AS baselineRevision
               FROM leases WHERE key_digest = ?`,
              )
              .get(executionCacheKeyDigest(lease.key)) as LeaseRow | null
            if (
              !active ||
              active.ownerToken !== lease.ownerToken ||
              active.expiresAt <= timestamp.getTime()
            ) {
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
                expectedRevision: active.baselineRevision ?? undefined,
              },
            )
            if (!published) {
              db.run(
                'DELETE FROM leases WHERE key_digest = ? AND owner_token = ?',
                [executionCacheKeyDigest(lease.key), lease.ownerToken],
              )
              return { published: false, stored: false, evictedEntries: 0 }
            }
            const evictedEntries = evictLeastRecentlyUsed(db, maxBytes)
            const stored = executionCacheEntryIsRetained(db, serialized.key)
            if (stored) {
              db.run(
                'DELETE FROM leases WHERE key_digest = ? AND owner_token = ?',
                [executionCacheKeyDigest(lease.key), lease.ownerToken],
              )
            }
            return {
              published: true,
              stored,
              evictedEntries,
            }
          })
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
                 key_digest, owner_token, terminal_outcome, completed_at
               ) VALUES (?, ?, ?, ?)`,
              [digestKey, lease.ownerToken, terminalOutcome.source, timestamp],
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
