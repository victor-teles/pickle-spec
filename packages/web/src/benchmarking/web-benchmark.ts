import type {
  ReplayBenchmarkGate,
  ReplayBenchmarkMode,
  ReplayBenchmarkSample,
  ReplayBenchmarkStatistics,
  ReplayPerformanceBenchmarkResult,
} from '@pickle-spec/runner/benchmarking'
import {
  evaluateReplayPerformanceBenchmark,
  runReplayPerformanceBenchmark,
} from '@pickle-spec/runner/benchmarking'

export type WebBenchmarkMode = ReplayBenchmarkMode
export type WebBenchmarkSample = ReplayBenchmarkSample
export type WebBenchmarkStatistics = ReplayBenchmarkStatistics
export type WebPerformanceGate = ReplayBenchmarkGate

export interface WebPerformanceBenchmarkResult
  extends ReplayPerformanceBenchmarkResult {
  warmupPairsDiscarded: 3
}

export interface RunWebPerformanceBenchmarkInput {
  samplePairs?: number
  run(mode: WebBenchmarkMode): void | Promise<void>
}

const webReplayBenchmarkBudgets = {
  p50Ratio: 0.5,
  p95Ratio: 0.65,
}

export function evaluateWebPerformanceGates(
  samples: readonly WebBenchmarkSample[],
): WebPerformanceBenchmarkResult {
  const result = evaluateReplayPerformanceBenchmark({
    samples,
    budgets: webReplayBenchmarkBudgets,
  })
  return result as WebPerformanceBenchmarkResult
}

export async function runWebPerformanceBenchmark(
  input: RunWebPerformanceBenchmarkInput,
): Promise<WebPerformanceBenchmarkResult> {
  const result = await runReplayPerformanceBenchmark({
    samplePairs: input.samplePairs,
    budgets: webReplayBenchmarkBudgets,
    async measure(mode) {
      const startedAt = performance.now()
      await input.run(mode)
      return performance.now() - startedAt
    },
  })
  return result as WebPerformanceBenchmarkResult
}
