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
import {
  localProjectKey,
  resolveLocalProjectStorage,
} from './local-project-storage'

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

export async function openLocalExecutionCache(
  options: LocalExecutionCacheOptions,
): Promise<LocalExecutionCache> {
  const projectKey = localProjectKey(options.projectRoot)
  const databasePath = options.cacheRoot
    ? resolveLocalProjectStorage(options.projectRoot, options.cacheRoot)
        .executionCachePath
    : resolveLocalProjectStorage(options.projectRoot).executionCachePath
  const maxBytes = options.maxBytes ?? defaultExecutionCacheMaxBytes
  const now = options.now ?? (() => new Date())
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error(
      'Execution cache maxBytes must be an integer greater than 0',
    )
  }
  const database = await openLocalExecutionCacheDatabase(databasePath)
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
