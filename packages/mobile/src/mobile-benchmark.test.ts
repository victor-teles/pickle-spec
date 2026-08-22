import { describe, expect, test } from 'bun:test'
import {
  evaluateMobilePerformanceGates,
  runMobilePerformanceBenchmark,
} from '../index'

describe('runMobilePerformanceBenchmark', () => {
  test('discards three warmup pairs and reports at least twenty paired samples', async () => {
    const measuredModes: string[] = []
    const result = await runMobilePerformanceBenchmark({
      samplePairs: 20,
      async measure(mode) {
        measuredModes.push(mode)
        const pairIndex = Math.floor((measuredModes.length - 1) / 2)
        return mode === 'adaptive' ? 100 + pairIndex : 50 + pairIndex
      },
    })

    expect(measuredModes).toHaveLength(46)
    expect(measuredModes.slice(0, 6)).toEqual([
      'adaptive',
      'replay',
      'adaptive',
      'replay',
      'adaptive',
      'replay',
    ])
    expect(result.warmupPairsDiscarded).toBe(3)
    expect(result.samples).toHaveLength(20)
    expect(result.samples[0]).toEqual({ adaptiveMs: 103, replayMs: 53 })
    expect(result.adaptive).toEqual({ p50Ms: 112, p95Ms: 121 })
    expect(result.replay).toEqual({ p50Ms: 62, p95Ms: 71 })
    expect(result.passed).toBe(true)
  })

  test('rejects an insufficient controlled sample before executing', async () => {
    let measured = false

    await expect(
      runMobilePerformanceBenchmark({
        samplePairs: 19,
        async measure() {
          measured = true
          return 1
        },
      }),
    ).rejects.toThrow('at least 20 paired samples')
    expect(measured).toBe(false)
  })
})

describe('evaluateMobilePerformanceGates', () => {
  test('passes inclusive p50 and p95 ratio boundaries', () => {
    const samples = Array.from({ length: 20 }, (_, index) => ({
      adaptiveMs: 100,
      replayMs: index < 18 ? 75 : 110,
    }))

    expect(evaluateMobilePerformanceGates(samples)).toMatchObject({
      adaptive: { p50Ms: 100, p95Ms: 100 },
      replay: { p50Ms: 75, p95Ms: 110 },
      gates: {
        p50: { ratio: 0.75, limitRatio: 0.75, passed: true },
        p95: { ratio: 1.1, limitRatio: 1.1, passed: true },
      },
      passed: true,
    })
  })

  test('fails each percentile gate above its limit', () => {
    const p50Failure = Array.from({ length: 20 }, (_, index) => ({
      adaptiveMs: 100,
      replayMs: index < 9 ? 75 : 76,
    }))
    const p95Failure = Array.from({ length: 20 }, (_, index) => ({
      adaptiveMs: 100,
      replayMs: index < 18 ? 75 : 111,
    }))

    expect(evaluateMobilePerformanceGates(p50Failure)).toMatchObject({
      gates: { p50: { passed: false }, p95: { passed: true } },
      passed: false,
    })
    expect(evaluateMobilePerformanceGates(p95Failure)).toMatchObject({
      gates: { p50: { passed: true }, p95: { passed: false } },
      passed: false,
    })
  })
})
