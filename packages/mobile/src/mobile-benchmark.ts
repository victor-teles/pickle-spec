export type MobileBenchmarkMode = 'adaptive' | 'replay'

export interface MobileBenchmarkSample {
  adaptiveMs: number
  replayMs: number
}

export interface MobileBenchmarkStatistics {
  p50Ms: number
  p95Ms: number
}

export interface MobilePerformanceGate {
  ratio: number
  limitRatio: number
  passed: boolean
}

export interface MobilePerformanceBenchmarkResult {
  warmupPairsDiscarded: 3
  samples: MobileBenchmarkSample[]
  adaptive: MobileBenchmarkStatistics
  replay: MobileBenchmarkStatistics
  gates: {
    p50: MobilePerformanceGate
    p95: MobilePerformanceGate
  }
  passed: boolean
}

export interface RunMobilePerformanceBenchmarkInput {
  samplePairs?: number
  measure(mode: MobileBenchmarkMode): number | Promise<number>
}

const warmupPairs = 3
const minimumSamplePairs = 20
const p50LimitRatio = 0.75
const p95LimitRatio = 1.1

function percentile(values: readonly number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.ceil(sorted.length * ratio) - 1
  return sorted[index]!
}

function statistics(values: readonly number[]): MobileBenchmarkStatistics {
  return {
    p50Ms: percentile(values, 0.5),
    p95Ms: percentile(values, 0.95),
  }
}

function performanceRatio(replayMs: number, adaptiveMs: number): number {
  if (adaptiveMs !== 0) return replayMs / adaptiveMs
  return replayMs === 0 ? 0 : Number.POSITIVE_INFINITY
}

function assertSample(sample: MobileBenchmarkSample, index: number): void {
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

export function evaluateMobilePerformanceGates(
  samples: readonly MobileBenchmarkSample[],
): MobilePerformanceBenchmarkResult {
  if (samples.length < minimumSamplePairs) {
    throw new Error(
      `Mobile benchmark requires at least ${minimumSamplePairs} paired samples`,
    )
  }
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

export async function runMobilePerformanceBenchmark(
  input: RunMobilePerformanceBenchmarkInput,
): Promise<MobilePerformanceBenchmarkResult> {
  const samplePairs = input.samplePairs ?? minimumSamplePairs
  if (!Number.isSafeInteger(samplePairs) || samplePairs < minimumSamplePairs) {
    throw new Error(
      `Mobile benchmark requires at least ${minimumSamplePairs} paired samples`,
    )
  }

  const samples: MobileBenchmarkSample[] = []
  for (let index = 0; index < warmupPairs + samplePairs; index++) {
    const sample = {
      adaptiveMs: await input.measure('adaptive'),
      replayMs: await input.measure('replay'),
    }
    assertSample(sample, index)
    if (index >= warmupPairs) samples.push(sample)
  }
  return evaluateMobilePerformanceGates(samples)
}
