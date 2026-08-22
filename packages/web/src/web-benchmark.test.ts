import { describe, expect, test } from 'bun:test'
import {
  evaluateWebPerformanceGates,
  runWebPerformanceBenchmark,
} from '../index'

describe('runWebPerformanceBenchmark', () => {
  test('measures and discards three warmup pairs before retaining twenty pairs', async () => {
    const modes: string[] = []

    const result = await runWebPerformanceBenchmark({
      samplePairs: 20,
      async run(mode) {
        modes.push(mode)
      },
    })

    expect(modes).toHaveLength(46)
    expect(modes.slice(0, 6)).toEqual([
      'adaptive',
      'replay',
      'adaptive',
      'replay',
      'adaptive',
      'replay',
    ])
    expect(result.warmupPairsDiscarded).toBe(3)
    expect(result.samples).toHaveLength(20)
    expect(result.samples.every((sample) => sample.adaptiveMs >= 0)).toBe(true)
    expect(result.samples.every((sample) => sample.replayMs >= 0)).toBe(true)
  })

  test('rejects fewer than twenty measured pairs before running', async () => {
    let ran = false

    await expect(
      runWebPerformanceBenchmark({
        samplePairs: 19,
        async run() {
          ran = true
        },
      }),
    ).rejects.toThrow('at least 20 paired samples')
    expect(ran).toBe(false)
  })
})

describe('evaluateWebPerformanceGates', () => {
  test('passes inclusive Replay p50 and p95 budget boundaries', () => {
    const samples = Array.from({ length: 20 }, (_, index) => ({
      adaptiveMs: 100,
      replayMs: index < 18 ? 50 : 65,
    }))

    expect(evaluateWebPerformanceGates(samples)).toMatchObject({
      adaptive: { p50Ms: 100, p95Ms: 100 },
      replay: { p50Ms: 50, p95Ms: 65 },
      gates: {
        p50: { ratio: 0.5, limitRatio: 0.5, passed: true },
        p95: { ratio: 0.65, limitRatio: 0.65, passed: true },
      },
      passed: true,
    })
  })

  test('fails each Replay percentile above its budget', () => {
    const p50Failure = Array.from({ length: 20 }, (_, index) => ({
      adaptiveMs: 100,
      replayMs: index < 9 ? 50 : 51,
    }))
    const p95Failure = Array.from({ length: 20 }, (_, index) => ({
      adaptiveMs: 100,
      replayMs: index < 18 ? 50 : 66,
    }))

    expect(evaluateWebPerformanceGates(p50Failure)).toMatchObject({
      gates: { p50: { passed: false }, p95: { passed: true } },
      passed: false,
    })
    expect(evaluateWebPerformanceGates(p95Failure)).toMatchObject({
      gates: { p50: { passed: true }, p95: { passed: false } },
      passed: false,
    })
  })

  test('rejects insufficient or invalid samples', () => {
    expect(() =>
      evaluateWebPerformanceGates(
        Array.from({ length: 19 }, () => ({
          adaptiveMs: 100,
          replayMs: 25,
        })),
      ),
    ).toThrow('at least 20 paired samples')
    expect(() =>
      evaluateWebPerformanceGates(
        Array.from({ length: 20 }, (_, index) => ({
          adaptiveMs: index === 0 ? Number.NaN : 100,
          replayMs: 25,
        })),
      ),
    ).toThrow('non-negative finite number')
  })

  test('rejects a zero Adaptive baseline', () => {
    const samples = Array.from({ length: 20 }, () => ({
      adaptiveMs: 0,
      replayMs: 0,
    }))

    expect(() => evaluateWebPerformanceGates(samples)).toThrow(
      'Adaptive benchmark percentiles must be greater than zero',
    )
  })

  test('rejects a ratio overflow', () => {
    const samples = Array.from({ length: 20 }, () => ({
      adaptiveMs: Number.MIN_VALUE,
      replayMs: 1,
    }))

    expect(() => evaluateWebPerformanceGates(samples)).toThrow(
      'Web benchmark ratios must be finite',
    )
  })
})
