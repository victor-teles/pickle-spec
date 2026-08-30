import type {
  ExecutionCacheKey,
  ExecutionCacheLeaseWaitResult,
  SerializedExecutionCacheTerminalOutcome,
} from '../execution-cache'
import type { LocalExecutionCacheDatabase } from './local-execution-cache-database'
import {
  executionCacheKeyDigest,
  readExecutionCacheEntrySnapshot,
} from './local-execution-cache-records'

export interface ExecutionCacheLeaseTiming {
  ttlMs: number
  heartbeatMs: number
  waitTimeoutMs: number
  minPollMs: number
  maxPollMs: number
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

const defaultTiming: ExecutionCacheLeaseTiming = {
  ttlMs: 30_000,
  heartbeatMs: 10_000,
  waitTimeoutMs: 30_000,
  minPollMs: 100,
  maxPollMs: 500,
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

export function validateTiming(
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

export async function waitForLeaseRelease(
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
