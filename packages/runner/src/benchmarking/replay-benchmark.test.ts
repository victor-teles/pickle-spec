import { expect, test } from 'bun:test'
import {
  evaluateReplayPerformanceBenchmark,
  runReplayPerformanceBenchmark,
} from '../../benchmarking'
import { requiredValue } from '../required-value'

function replayDuration(index: number): number {
  if (index < 10) return 50
  if (index < 19) return 65
  return 100
}

test('evaluates nearest-rank percentiles against inclusive Replay budgets', () => {
  const samples = Array.from({ length: 20 }, (_, index) => ({
    adaptiveMs: 100,
    replayMs: replayDuration(index),
  }))

  expect(
    evaluateReplayPerformanceBenchmark({
      samples,
      budgets: { p50Ratio: 0.5, p95Ratio: 0.65 },
    }),
  ).toEqual({
    warmupPairsDiscarded: 3,
    samples,
    adaptive: { p50Ms: 100, p95Ms: 100 },
    replay: { p50Ms: 50, p95Ms: 65 },
    gates: {
      p50: { ratio: 0.5, limitRatio: 0.5, passed: true },
      p95: { ratio: 0.65, limitRatio: 0.65, passed: true },
    },
    passed: true,
  })
})

test('requires at least twenty measured pairs', () => {
  expect(() =>
    evaluateReplayPerformanceBenchmark({
      samples: Array.from({ length: 19 }, () => ({
        adaptiveMs: 100,
        replayMs: 50,
      })),
      budgets: { p50Ratio: 0.5, p95Ratio: 0.65 },
    }),
  ).toThrow('Replay benchmark requires at least 20 paired samples')
})

test('rejects non-finite and negative measured durations', () => {
  for (const invalidDuration of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const samples = Array.from({ length: 20 }, () => ({
      adaptiveMs: 100,
      replayMs: 50,
    }))
    requiredValue(samples[0]).replayMs = invalidDuration

    expect(() =>
      evaluateReplayPerformanceBenchmark({
        samples,
        budgets: { p50Ratio: 0.5, p95Ratio: 0.65 },
      }),
    ).toThrow(
      'Replay benchmark duration at pair 1 must be a non-negative finite number',
    )
  }
})

test('rejects non-finite and negative ratio budgets', () => {
  const samples = Array.from({ length: 20 }, () => ({
    adaptiveMs: 100,
    replayMs: 50,
  }))

  for (const invalidBudget of [Number.NaN, Number.POSITIVE_INFINITY, -0.01]) {
    expect(() =>
      evaluateReplayPerformanceBenchmark({
        samples,
        budgets: { p50Ratio: invalidBudget, p95Ratio: 0.65 },
      }),
    ).toThrow(
      'Replay benchmark p50Ratio budget must be a non-negative finite number',
    )
  }
})

test('rejects zero Adaptive baseline percentiles', () => {
  expect(() =>
    evaluateReplayPerformanceBenchmark({
      samples: Array.from({ length: 20 }, () => ({
        adaptiveMs: 0,
        replayMs: 1,
      })),
      budgets: { p50Ratio: 0.5, p95Ratio: 0.65 },
    }),
  ).toThrow('Adaptive benchmark percentiles must be greater than zero')
})

test('rejects ratios that overflow finite numbers', () => {
  expect(() =>
    evaluateReplayPerformanceBenchmark({
      samples: Array.from({ length: 20 }, () => ({
        adaptiveMs: Number.MIN_VALUE,
        replayMs: 1,
      })),
      budgets: { p50Ratio: 0.5, p95Ratio: 0.65 },
    }),
  ).toThrow('Replay benchmark ratios must be finite')
})

test('fails gates only when a ratio exceeds its inclusive budget', () => {
  const result = evaluateReplayPerformanceBenchmark({
    samples: Array.from({ length: 20 }, () => ({
      adaptiveMs: 100,
      replayMs: 66,
    })),
    budgets: { p50Ratio: 0.65, p95Ratio: 0.65 },
  })

  expect(result.gates).toEqual({
    p50: { ratio: 0.66, limitRatio: 0.65, passed: false },
    p95: { ratio: 0.66, limitRatio: 0.65, passed: false },
  })
  expect(result.passed).toBe(false)
})

test('accepts zero budgets when Replay percentiles are zero', () => {
  const result = evaluateReplayPerformanceBenchmark({
    samples: Array.from({ length: 20 }, () => ({
      adaptiveMs: 100,
      replayMs: 0,
    })),
    budgets: { p50Ratio: 0, p95Ratio: 0 },
  })

  expect(result.gates.p50).toEqual({ ratio: 0, limitRatio: 0, passed: true })
  expect(result.gates.p95).toEqual({ ratio: 0, limitRatio: 0, passed: true })
  expect(result.passed).toBe(true)
})

test('runs three warmup pairs before twenty paired measurements by default', async () => {
  const modes: string[] = []

  const result = await runReplayPerformanceBenchmark({
    budgets: { p50Ratio: 0.5, p95Ratio: 0.65 },
    measure(mode) {
      modes.push(mode)
      return mode === 'adaptive' ? 100 : 50
    },
  })

  expect(modes).toEqual(
    Array.from({ length: 23 }, () => ['adaptive', 'replay']).flat(),
  )
  expect(result.warmupPairsDiscarded).toBe(3)
  expect(result.samples).toHaveLength(20)
  expect(result.passed).toBe(true)
})

test('supports zero and custom warmup pairs', async () => {
  const withoutWarmups = await runReplayPerformanceBenchmark({
    budgets: { p50Ratio: 0.5, p95Ratio: 0.65 },
    warmupPairs: 0,
    measure: (mode) => (mode === 'adaptive' ? 100 : 50),
  })
  let measurements = 0
  const withWarmups = await runReplayPerformanceBenchmark({
    budgets: { p50Ratio: 0.5, p95Ratio: 0.65 },
    samplePairs: 20,
    warmupPairs: 5,
    measure(mode) {
      measurements += 1
      return mode === 'adaptive' ? 100 : 50
    },
  })

  expect(withoutWarmups.warmupPairsDiscarded).toBe(0)
  expect(withoutWarmups.samples).toHaveLength(20)
  expect(measurements).toBe(50)
  expect(withWarmups.warmupPairsDiscarded).toBe(5)
})

test('validates paired sample and warmup counts before measuring', async () => {
  for (const samplePairs of [19, 20.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    let measured = false
    await expect(
      runReplayPerformanceBenchmark({
        budgets: { p50Ratio: 0.5, p95Ratio: 0.65 },
        samplePairs,
        measure() {
          measured = true
          return 1
        },
      }),
    ).rejects.toThrow('Replay benchmark requires at least 20 paired samples')
    expect(measured).toBe(false)
  }

  for (const warmupPairs of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
    let measured = false
    await expect(
      runReplayPerformanceBenchmark({
        budgets: { p50Ratio: 0.5, p95Ratio: 0.65 },
        warmupPairs,
        measure() {
          measured = true
          return 1
        },
      }),
    ).rejects.toThrow(
      'Replay benchmark warmupPairs must be a non-negative integer',
    )
    expect(measured).toBe(false)
  }

  await expect(
    runReplayPerformanceBenchmark({
      budgets: { p50Ratio: 0.5, p95Ratio: 0.65 },
      samplePairs: Number.MAX_SAFE_INTEGER,
      warmupPairs: 1,
      measure: () => 1,
    }),
  ).rejects.toThrow('Replay benchmark total pair count must be a safe integer')
})

test('validates budgets before measuring', async () => {
  let measured = false

  await expect(
    runReplayPerformanceBenchmark({
      budgets: { p50Ratio: Number.POSITIVE_INFINITY, p95Ratio: 0.65 },
      measure() {
        measured = true
        return 1
      },
    }),
  ).rejects.toThrow(
    'Replay benchmark p50Ratio budget must be a non-negative finite number',
  )
  expect(measured).toBe(false)
})

test('validates discarded warmup metadata during direct evaluation', () => {
  expect(() =>
    evaluateReplayPerformanceBenchmark({
      samples: Array.from({ length: 20 }, () => ({
        adaptiveMs: 100,
        replayMs: 50,
      })),
      budgets: { p50Ratio: 0.5, p95Ratio: 0.65 },
      warmupPairsDiscarded: 1.5,
    }),
  ).toThrow(
    'Replay benchmark warmupPairsDiscarded must be a non-negative integer',
  )
})
