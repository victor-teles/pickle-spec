export type WebBenchmarkMode = 'adaptive' | 'replay'

export interface WebBenchmarkSample {
  adaptiveMs: number
  replayMs: number
}

export interface WebBenchmarkStatistics {
  p50Ms: number
  p95Ms: number
}

export interface WebPerformanceGate {
  ratio: number
  limitRatio: number
  passed: boolean
}

export interface WebPerformanceBenchmarkResult {
  warmupPairsDiscarded: 3
  samples: WebBenchmarkSample[]
  adaptive: WebBenchmarkStatistics
  replay: WebBenchmarkStatistics
  gates: {
    p50: WebPerformanceGate
    p95: WebPerformanceGate
  }
  passed: boolean
}

export interface RunWebPerformanceBenchmarkInput {
  samplePairs?: number
  run(mode: WebBenchmarkMode): void | Promise<void>
}

const warmupPairs = 3
const minimumSamplePairs = 20
const p50LimitRatio = 0.5
const p95LimitRatio = 0.65

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.ceil(sorted.length * ratio) - 1]!
}

function statistics(values: readonly number[]): WebBenchmarkStatistics {
  return {
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  }
}

function performanceRatio(replayMs: number, adaptiveMs: number): number {
  if (adaptiveMs !== 0) return replayMs / adaptiveMs
  return replayMs === 0 ? 0 : Number.POSITIVE_INFINITY
}

function assertSample(sample: WebBenchmarkSample, index: number): void {
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

function assertSampleCount(samplePairs: number): void {
  if (!Number.isSafeInteger(samplePairs) || samplePairs < minimumSamplePairs) {
    throw new Error(
      `Web benchmark requires at least ${minimumSamplePairs} paired samples`,
    )
  }
}

export function evaluateWebPerformanceGates(
  samples: readonly WebBenchmarkSample[],
): WebPerformanceBenchmarkResult {
  assertSampleCount(samples.length)
  samples.forEach(assertSample)
  const adaptive = statistics(samples.map((sample) => sample.adaptiveMs))
  const replay = statistics(samples.map((sample) => sample.replayMs))
  const p50Ratio = performanceRatio(replay.p50Ms, adaptive.p50Ms)
  const p95Ratio = performanceRatio(replay.p95Ms, adaptive.p95Ms)
  const p50 = {
    ratio: p50Ratio,
    limitRatio: p50LimitRatio,
    passed: p50Ratio <= p50LimitRatio,
  }
  const p95 = {
    ratio: p95Ratio,
    limitRatio: p95LimitRatio,
    passed: p95Ratio <= p95LimitRatio,
  }
  return {
    warmupPairsDiscarded: warmupPairs,
    samples: samples.map((sample) => ({ ...sample })),
    adaptive,
    replay,
    gates: { p50, p95 },
    passed: p50.passed && p95.passed,
  }
}

async function measure(
  mode: WebBenchmarkMode,
  run: RunWebPerformanceBenchmarkInput['run'],
): Promise<number> {
  const startedAt = performance.now()
  await run(mode)
  return performance.now() - startedAt
}

export async function runWebPerformanceBenchmark(
  input: RunWebPerformanceBenchmarkInput,
): Promise<WebPerformanceBenchmarkResult> {
  const samplePairs = input.samplePairs ?? minimumSamplePairs
  assertSampleCount(samplePairs)

  const samples: WebBenchmarkSample[] = []
  for (let index = 0; index < warmupPairs + samplePairs; index++) {
    const sample = {
      adaptiveMs: await measure('adaptive', input.run),
      replayMs: await measure('replay', input.run),
    }
    assertSample(sample, index)
    if (index >= warmupPairs) samples.push(sample)
  }
  return evaluateWebPerformanceGates(samples)
}
