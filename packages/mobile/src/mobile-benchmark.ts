import type {
  ReplayBenchmarkGate,
  ReplayBenchmarkMode,
  ReplayBenchmarkSample,
  ReplayBenchmarkStatistics,
  ReplayPerformanceBenchmarkResult,
} from '@pickle-spec/runner'
import {
  evaluateReplayPerformanceBenchmark,
  runReplayPerformanceBenchmark,
} from '@pickle-spec/runner'

export type MobileBenchmarkMode = ReplayBenchmarkMode
export type MobileBenchmarkSample = ReplayBenchmarkSample
export type MobileBenchmarkStatistics = ReplayBenchmarkStatistics
export type MobilePerformanceGate = ReplayBenchmarkGate

export interface MobilePerformanceBenchmarkResult
  extends ReplayPerformanceBenchmarkResult {
  warmupPairsDiscarded: 3
}

export interface RunMobilePerformanceBenchmarkInput {
  samplePairs?: number
  measure(mode: MobileBenchmarkMode): number | Promise<number>
}

const mobileReplayBenchmarkBudgets = {
  p50Ratio: 0.75,
  p95Ratio: 1.1,
}

export function evaluateMobilePerformanceGates(
  samples: readonly MobileBenchmarkSample[],
): MobilePerformanceBenchmarkResult {
  const result = evaluateReplayPerformanceBenchmark({
    samples,
    budgets: mobileReplayBenchmarkBudgets,
  })
  return result as MobilePerformanceBenchmarkResult
}

export async function runMobilePerformanceBenchmark(
  input: RunMobilePerformanceBenchmarkInput,
): Promise<MobilePerformanceBenchmarkResult> {
  const result = await runReplayPerformanceBenchmark({
    samplePairs: input.samplePairs,
    budgets: mobileReplayBenchmarkBudgets,
    measure: input.measure,
  })
  return result as MobilePerformanceBenchmarkResult
}
