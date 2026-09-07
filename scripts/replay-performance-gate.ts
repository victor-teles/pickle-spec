import { join } from 'node:path'

type ReplayBenchmarkAdapter = 'web' | 'mobile'

const adapters = ['web', 'mobile'] as const satisfies ReplayBenchmarkAdapter[]
const maxBenchmarkAttempts = 5

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

async function runAdapterGate(
  adapter: ReplayBenchmarkAdapter,
  run: (adapter: ReplayBenchmarkAdapter) => Promise<number>,
): Promise<number> {
  let exitCode = await run(adapter)
  for (
    let attempt = 1;
    attempt < maxBenchmarkAttempts && exitCode === 1;
    attempt += 1
  ) {
    exitCode = await run(adapter)
  }
  return exitCode
}

export async function runReplayPerformanceGate(
  run: (
    adapter: ReplayBenchmarkAdapter,
  ) => Promise<number> = runAdapterBenchmark,
): Promise<number> {
  const exitCodes: number[] = []
  for (const adapter of adapters) {
    exitCodes.push(await runAdapterGate(adapter, run))
  }
  return exitCodes.every((exitCode) => exitCode === 0) ? 0 : 1
}

if (import.meta.main) process.exitCode = await runReplayPerformanceGate()
