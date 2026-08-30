import type { ExecutionCacheEntryMetadata } from '@pickle-spec/runner'

export interface StudioExecutionCacheInspection {
  projectKey: string
  maxBytes: number
  entries: readonly ExecutionCacheEntryMetadata[]
}

export interface StudioExecutionCacheGateway {
  inspect(): Promise<StudioExecutionCacheInspection>
  clear(): Promise<{ clearedEntries: number }>
}
