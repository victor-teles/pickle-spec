import { removeProviderCredentials } from '@pickle-spec/runner/benchmarking'
import { z } from 'zod'
import type { WebPerformanceBenchmarkResult } from './web-benchmark'
import {
  type ControlledWebBenchmarkOptions,
  runControlledWebPerformanceBenchmark,
} from './web-controlled-benchmark'

const defaultOptions: ControlledWebBenchmarkOptions = { samplePairs: 20 }
const benchmarkArgumentsSchema = z.union([
  z.tuple([]),
  z.tuple([
    z.literal('--sample-pairs'),
    z.coerce.number().int().min(defaultOptions.samplePairs),
  ]),
])

function benchmarkOptions(
  argv: readonly string[],
): ControlledWebBenchmarkOptions {
  const parsed = benchmarkArgumentsSchema.parse(argv)
  return { samplePairs: parsed[1] ?? defaultOptions.samplePairs }
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
    removeProviderCredentials(process.env)
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
