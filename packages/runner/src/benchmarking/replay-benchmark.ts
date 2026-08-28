import { requiredValue } from '../required-value'
export type ReplayBenchmarkMode = 'adaptive' | 'replay'

export interface ReplayBenchmarkSample {
  adaptiveMs: number
  replayMs: number
}

export interface ReplayBenchmarkStatistics {
  p50Ms: number
  p95Ms: number
}

export interface ReplayBenchmarkBudgets {
  p50Ratio: number
  p95Ratio: number
}

export interface ReplayBenchmarkGate {
  ratio: number
  limitRatio: number
  passed: boolean
}

export interface ReplayPerformanceBenchmarkResult {
  warmupPairsDiscarded: number
  samples: ReplayBenchmarkSample[]
  adaptive: ReplayBenchmarkStatistics
  replay: ReplayBenchmarkStatistics
  gates: {
    p50: ReplayBenchmarkGate
    p95: ReplayBenchmarkGate
  }
  passed: boolean
}

export interface EvaluateReplayPerformanceBenchmarkInput {
  samples: readonly ReplayBenchmarkSample[]
  budgets: ReplayBenchmarkBudgets
  warmupPairsDiscarded?: number
}

export interface RunReplayPerformanceBenchmarkInput {
  budgets: ReplayBenchmarkBudgets
  samplePairs?: number
  warmupPairs?: number
  measure(mode: ReplayBenchmarkMode): number | Promise<number>
}

export const defaultReplayBenchmarkWarmupPairs = 3
export const minimumReplayBenchmarkSamplePairs = 20

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return requiredValue(sorted[Math.ceil(sorted.length * ratio) - 1])
}

function statistics(values: readonly number[]): ReplayBenchmarkStatistics {
  return {
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  }
}

function assertSampleCount(samplePairs: number): void {
  if (
    !Number.isSafeInteger(samplePairs) ||
    samplePairs < minimumReplayBenchmarkSamplePairs
  ) {
    throw new Error(
      `Replay benchmark requires at least ${minimumReplayBenchmarkSamplePairs} paired samples`,
    )
  }
}

function assertNonNegativeInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Replay benchmark ${name} must be a non-negative integer`)
  }
}

function assertSample(sample: ReplayBenchmarkSample, index: number): void {
  for (const [mode, duration] of [
    ['Adaptive', sample.adaptiveMs],
    ['Replay', sample.replayMs],
  ] as const) {
    if (!Number.isFinite(duration) || duration < 0) {
      throw new Error(
        `${mode} benchmark duration at pair ${index + 1} must be a non-negative finite number`,
      )
    }
  }
}

function assertBudgets(budgets: ReplayBenchmarkBudgets): void {
  for (const [name, ratio] of [
    ['p50Ratio', budgets.p50Ratio],
    ['p95Ratio', budgets.p95Ratio],
  ] as const) {
    if (!Number.isFinite(ratio) || ratio < 0) {
      throw new Error(
        `Replay benchmark ${name} budget must be a non-negative finite number`,
      )
    }
  }
}

export function evaluateReplayPerformanceBenchmark(
  input: EvaluateReplayPerformanceBenchmarkInput,
): ReplayPerformanceBenchmarkResult {
  const warmupPairsDiscarded =
    input.warmupPairsDiscarded ?? defaultReplayBenchmarkWarmupPairs
  assertSampleCount(input.samples.length)
  assertNonNegativeInteger(warmupPairsDiscarded, 'warmupPairsDiscarded')
  input.samples.forEach(assertSample)
  assertBudgets(input.budgets)
  const adaptive = statistics(input.samples.map((sample) => sample.adaptiveMs))
  const replay = statistics(input.samples.map((sample) => sample.replayMs))
  if (adaptive.p50Ms <= 0 || adaptive.p95Ms <= 0) {
    throw new Error('Adaptive benchmark percentiles must be greater than zero')
  }
  const p50Ratio = replay.p50Ms / adaptive.p50Ms
  const p95Ratio = replay.p95Ms / adaptive.p95Ms
  if (!Number.isFinite(p50Ratio) || !Number.isFinite(p95Ratio)) {
    throw new Error('Replay benchmark ratios must be finite')
  }
  const p50 = {
    ratio: p50Ratio,
    limitRatio: input.budgets.p50Ratio,
    passed: p50Ratio <= input.budgets.p50Ratio,
  }
  const p95 = {
    ratio: p95Ratio,
    limitRatio: input.budgets.p95Ratio,
    passed: p95Ratio <= input.budgets.p95Ratio,
  }
  return {
    warmupPairsDiscarded,
    samples: input.samples.map((sample) => ({ ...sample })),
    adaptive,
    replay,
    gates: { p50, p95 },
    passed: p50.passed && p95.passed,
  }
}

export async function runReplayPerformanceBenchmark(
  input: RunReplayPerformanceBenchmarkInput,
): Promise<ReplayPerformanceBenchmarkResult> {
  const samplePairs = input.samplePairs ?? minimumReplayBenchmarkSamplePairs
  const warmupPairs = input.warmupPairs ?? defaultReplayBenchmarkWarmupPairs
  assertSampleCount(samplePairs)
  assertNonNegativeInteger(warmupPairs, 'warmupPairs')
  assertBudgets(input.budgets)
  if (!Number.isSafeInteger(warmupPairs + samplePairs)) {
    throw new Error('Replay benchmark total pair count must be a safe integer')
  }

  const samples: ReplayBenchmarkSample[] = []
  for (let index = 0; index < warmupPairs + samplePairs; index++) {
    const sample = {
      adaptiveMs: await input.measure('adaptive'),
      replayMs: await input.measure('replay'),
    }
    assertSample(sample, index)
    if (index >= warmupPairs) samples.push(sample)
  }

  return evaluateReplayPerformanceBenchmark({
    samples,
    budgets: input.budgets,
    warmupPairsDiscarded: warmupPairs,
  })
}
