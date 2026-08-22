import { openLocalExecutionCache } from '@pickle-spec/runner'

export interface CacheCommandOptions {
  projectRoot?: string
  cacheRoot?: string
  report?: (message: string) => void
}

function cacheUsage(argv: readonly string[]): string {
  const subcommand = argv[1]
  return subcommand === 'inspect' || subcommand === 'clear'
    ? `Usage: pickle cache ${subcommand}`
    : 'Usage: pickle cache <inspect|clear>'
}

export async function runCacheCommand(
  argv: readonly string[],
  options: CacheCommandOptions = {},
): Promise<number> {
  if (argv[0] !== 'cache' || argv.length !== 2) {
    throw new Error(cacheUsage(argv))
  }
  const subcommand = argv[1]
  if (subcommand !== 'inspect' && subcommand !== 'clear') {
    throw new Error(cacheUsage(argv))
  }
  const report = options.report ?? console.log
  const cache = await openLocalExecutionCache({
    projectRoot: options.projectRoot ?? process.cwd(),
    cacheRoot: options.cacheRoot ?? process.env.PICKLE_CACHE_ROOT,
  })
  const entries = await cache.inspect()
  if (subcommand === 'inspect') {
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
