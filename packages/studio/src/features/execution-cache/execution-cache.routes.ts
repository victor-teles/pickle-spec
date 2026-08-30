import {
  requestError,
  type StudioHttpHandler,
  unavailable,
} from '../../server/http'
import type { StudioExecutionCacheGateway } from './execution-cache.contracts'

interface ExecutionCacheRoutesOptions {
  executionCache?: StudioExecutionCacheGateway
}

export function createExecutionCacheRoutes(
  options: ExecutionCacheRoutesOptions,
): StudioHttpHandler {
  return async function handleExecutionCacheRequest(request, url) {
    if (url.pathname !== '/api/execution-cache') return null
    if (!options.executionCache) {
      return unavailable('Execution cache is unavailable')
    }
    try {
      if (request.method === 'GET') {
        return Response.json(await options.executionCache.inspect())
      }
      if (request.method === 'DELETE') {
        return Response.json(await options.executionCache.clear())
      }
      return null
    } catch (error) {
      return requestError(error, 500)
    }
  }
}
