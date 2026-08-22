import {
  defaultExecutionCacheMaxBytes,
  openLocalExecutionCache,
} from '@pickle-spec/runner'
import type { StudioExecutionCacheGateway } from '@pickle-spec/studio'

interface StudioExecutionCacheConfig {
  maxBytes?: number
}

export function createStudioExecutionCacheGateway(
  projectRoot: string,
  loadConfig: () => Promise<StudioExecutionCacheConfig>,
  cacheRoot = process.env.PICKLE_CACHE_ROOT,
): StudioExecutionCacheGateway {
  async function openCache() {
    const config = await loadConfig()
    const maxBytes = config.maxBytes ?? defaultExecutionCacheMaxBytes
    const cache = await openLocalExecutionCache({
      projectRoot,
      cacheRoot,
      maxBytes,
    })
    return { cache, maxBytes }
  }

  return {
    async inspect() {
      const { cache, maxBytes } = await openCache()
      return {
        projectKey: cache.projectKey,
        maxBytes,
        entries: await cache.inspect(),
      }
    },
    async clear() {
      const { cache } = await openCache()
      const entries = await cache.inspect()
      await cache.clear()
      return { clearedEntries: entries.length }
    },
  }
}
