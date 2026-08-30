import { openLocalExecutionCache } from '@pickle-spec/runner'
import type { CacheCommandInput } from '../command-inputs'

export interface CacheCommandOptions {
  projectRoot?: string
  cacheRoot?: string
  report?: (message: string) => void
}

export async function runCacheCommand(
  input: CacheCommandInput,
  options: CacheCommandOptions = {},
): Promise<number> {
  const report = options.report ?? console.log
  const cache = await openLocalExecutionCache({
    projectRoot: options.projectRoot ?? process.cwd(),
    cacheRoot: options.cacheRoot ?? process.env.PICKLE_CACHE_ROOT,
  })
  const entries = await cache.inspect()
  if (input.operation === 'inspect') {
    report(
      JSON.stringify(
        {
          kind: 'execution-cache-inspection',
          projectKey: cache.projectKey,
          entries,
        },
        null,
        2,
      ),
    )
    return 0
  }

  await cache.clear()
  const suffix = entries.length === 1 ? 'entry' : 'entries'
  report(`Cleared ${entries.length} Execution cache ${suffix}`)
  return 0
}
