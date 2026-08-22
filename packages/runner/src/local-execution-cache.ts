import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type {
  ExecutionCacheCoordination,
  ExecutionCacheStore,
} from './execution-cache'
import {
  createLocalExecutionCacheCoordination,
  type ExecutionCacheLeaseTiming,
} from './local-execution-cache-coordination'
import { openLocalExecutionCacheDatabase } from './local-execution-cache-database'
import { createLocalExecutionCacheEntries } from './local-execution-cache-entries'

export interface LocalExecutionCacheOptions {
  projectRoot: string
  cacheRoot?: string
  maxBytes?: number
  now?: () => Date
  leaseTiming?: Partial<ExecutionCacheLeaseTiming>
}

export interface LocalExecutionCache extends ExecutionCacheStore {
  projectKey: string
  coordination: ExecutionCacheCoordination
}

export const defaultExecutionCacheMaxBytes = 100 * 1024 * 1024

function projectKeyFor(canonicalProjectRoot: string): string {
  return createHash('sha256').update(canonicalProjectRoot).digest('hex')
}

export async function openLocalExecutionCache(
  options: LocalExecutionCacheOptions,
): Promise<LocalExecutionCache> {
  const canonicalProjectRoot = await realpath(resolve(options.projectRoot))
  const projectKey = projectKeyFor(canonicalProjectRoot)
  const cacheRoot =
    options.cacheRoot ?? join(homedir(), '.pickle', 'cache', 'projects')
  const maxBytes = options.maxBytes ?? defaultExecutionCacheMaxBytes
  const now = options.now ?? (() => new Date())
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error(
      'Execution cache maxBytes must be an integer greater than 0',
    )
  }
  const database = await openLocalExecutionCacheDatabase(
    join(cacheRoot, projectKey),
  )
  const store = createLocalExecutionCacheEntries({
    database,
    projectKey,
    maxBytes,
    now,
  })
  const coordination = createLocalExecutionCacheCoordination({
    database,
    projectKey,
    maxBytes,
    now,
    timing: options.leaseTiming,
  })
  return { projectKey, ...store, coordination }
}
