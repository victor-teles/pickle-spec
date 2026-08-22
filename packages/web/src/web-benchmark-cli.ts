import type { WebPerformanceBenchmarkResult } from './web-benchmark'
import { removeWebBenchmarkProviderCredentials } from './web-benchmark-credentials'
import {
  type ControlledWebBenchmarkOptions,
  runControlledWebPerformanceBenchmark,
} from './web-controlled-benchmark'

const defaultOptions: ControlledWebBenchmarkOptions = { samplePairs: 20 }

function numericArgument(
  argv: readonly string[],
  name: string,
): number | undefined {
  const index = argv.indexOf(name)
  if (index === -1) return undefined
  const value = Number(argv[index + 1])
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} requires a non-negative number`)
  }
  return value
}

function benchmarkOptions(
  argv: readonly string[],
): ControlledWebBenchmarkOptions {
  return {
    samplePairs:
      numericArgument(argv, '--sample-pairs') ?? defaultOptions.samplePairs,
  }
}

export function webPerformanceBenchmarkExitCode(
  result: WebPerformanceBenchmarkResult,
): number {
  return result.passed ? 0 : 1
}

export async function webBenchmarkMain(
  argv: readonly string[] = process.argv.slice(2),
): Promise<number> {
  try {
    removeWebBenchmarkProviderCredentials(process.env)
    const result = await runControlledWebPerformanceBenchmark(
      benchmarkOptions(argv),
    )
    process.stdout.write(`${JSON.stringify(result)}\n`)
    return webPerformanceBenchmarkExitCode(result)
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    )
    return 2
  }
}

if (import.meta.main) process.exitCode = await webBenchmarkMain()
