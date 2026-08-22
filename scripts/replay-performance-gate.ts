import { join } from 'node:path'

type ReplayBenchmarkAdapter = 'web' | 'mobile'

const adapters = ['web', 'mobile'] as const satisfies ReplayBenchmarkAdapter[]

async function runAdapterBenchmark(
  adapter: ReplayBenchmarkAdapter,
): Promise<number> {
  const child = Bun.spawn(
    [
      process.execPath,
      'run',
      '--cwd',
      join(import.meta.dir, '..', 'packages', adapter),
      'benchmark:replay',
    ],
    {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    },
  )
  return child.exited
}

export async function runReplayPerformanceGate(
  run: (
    adapter: ReplayBenchmarkAdapter,
  ) => Promise<number> = runAdapterBenchmark,
): Promise<number> {
  const exitCodes: number[] = []
  for (const adapter of adapters) exitCodes.push(await run(adapter))
  return exitCodes.every((exitCode) => exitCode === 0) ? 0 : 1
}

if (import.meta.main) process.exitCode = await runReplayPerformanceGate()
