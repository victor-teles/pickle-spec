import type {
  ExecutionPlanStore,
  ExecutionTargetAdapter,
} from '@pickle-spec/runner'
import { runScenarios } from '@pickle-spec/runner'
import type { ScenarioSelection } from '@pickle-spec/spec'
import {
  createWebAdapter,
  type WebAdapterOptions,
  type WebAutomation,
  type WebAutomationFactory,
} from './web-adapter'

export interface BenchmarkTimings {
  wallClockMs: number
  modelCallMs: number
  navigationMs: number
  artifactMs: number
}

export interface BenchmarkModeSamples {
  cold: BenchmarkTimings[]
  warm: BenchmarkTimings[]
}

export interface BenchmarkAdapterSamples {
  adaptive: BenchmarkModeSamples
  replay: BenchmarkModeSamples
}

export interface WebPerformanceBenchmarkResult {
  baseline: BenchmarkAdapterSamples
  candidate: BenchmarkAdapterSamples
}

export interface PerformanceGateEvaluation {
  warmReplayP50: {
    baselineMs: number
    candidateMs: number
    improvementRatio: number
    passed: boolean
  }
  adaptiveP95: {
    baselineMs: number
    candidateMs: number
    regressionRatio: number
    passed: boolean
  }
  passed: boolean
}

export interface RunWebPerformanceBenchmarkInput {
  selections: readonly ScenarioSelection[]
  options: WebAdapterOptions
  factory?: WebAutomationFactory
  plans?: ExecutionPlanStore
  executionTargetProfile?: { id: string }
  delays?: {
    launchMs: number
    navigationMs: number
    modelCallMs: number
    artifactMs: number
    navigationMultiplier?: number
  }
}

interface SessionMetrics {
  navigationMs: number
  modelCallMs: number
  artifactMs: number
}

interface MeasuringAutomationFactory {
  factory: WebAutomationFactory
  takeMetrics(): SessionMetrics[]
  resetMetrics(): void
}

function percentile(values: readonly number[], ratio: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil(ratio * sorted.length) - 1),
  )
  return sorted[index]!
}

function stubAutomation(): WebAutomation {
  return {
    async navigate() {},
    async observe() {
      return [{ description: 'Measured action', handle: {} }]
    },
    async act() {
      return { success: true }
    },
    async verify() {
      return { meetsExpectation: true, actualState: 'Ready' }
    },
    async screenshot() {
      return new Uint8Array()
    },
    async readIsolationState() {
      return { cookieCount: 0, storageKeyCount: 0 }
    },
    async close() {},
  }
}

function wrapAutomation(
  inner: WebAutomation,
  metrics: SessionMetrics,
  delays: Required<NonNullable<RunWebPerformanceBenchmarkInput['delays']>>,
): WebAutomation {
  return {
    async navigate(_url, signal) {
      const started = performance.now()
      const navigationDelay =
        delays.navigationMs * (delays.navigationMultiplier ?? 1)
      await Bun.sleep(navigationDelay)
      await inner.navigate(_url, signal)
      metrics.navigationMs += performance.now() - started
    },
    async observe(prompt, signal) {
      const started = performance.now()
      await Bun.sleep(delays.modelCallMs)
      const result = await inner.observe(prompt, signal)
      metrics.modelCallMs += performance.now() - started
      return result
    },
    async act(action, signal) {
      return inner.act(action, signal)
    },
    async verify(prompt, signal) {
      const started = performance.now()
      await Bun.sleep(delays.modelCallMs)
      const result = await inner.verify(prompt, signal)
      metrics.modelCallMs += performance.now() - started
      return result
    },
    async screenshot(options) {
      const started = performance.now()
      await Bun.sleep(delays.artifactMs)
      const result = await inner.screenshot(options)
      metrics.artifactMs += performance.now() - started
      return result
    },
    readIsolationState: () => inner.readIsolationState(),
    close: () => inner.close(),
  }
}

export function createMeasuringAutomationFactory(
  delays: Required<NonNullable<RunWebPerformanceBenchmarkInput['delays']>> = {
    launchMs: 200,
    navigationMs: 40,
    modelCallMs: 120,
    artifactMs: 20,
    navigationMultiplier: 1,
  },
): MeasuringAutomationFactory {
  const metrics: SessionMetrics[] = []
  let launched = false

  return {
    factory: {
      async launch(input) {
        if (!launched) {
          await Bun.sleep(delays.launchMs)
          launched = true
        }
        if (input.signal?.aborted) throw new Error('Scenario cancelled')
        return {
          async openContext(_context) {
            const sessionMetrics: SessionMetrics = {
              navigationMs: 0,
              modelCallMs: 0,
              artifactMs: 0,
            }
            metrics.push(sessionMetrics)
            return wrapAutomation(stubAutomation(), sessionMetrics, delays)
          },
          close: async () => {},
        }
      },
    },
    takeMetrics() {
      return metrics.splice(0)
    },
    resetMetrics() {
      metrics.length = 0
    },
  }
}

function createBenchmarkAdapter(
  kind: 'baseline' | 'candidate',
  options: WebAdapterOptions,
  factory: WebAutomationFactory,
): ExecutionTargetAdapter {
  return createWebAdapter(
    { ...options, profile: 'default', screenshots: { mode: 'off' } },
    factory,
    kind === 'baseline' ? { navigationPolicy: 'eager' } : {},
  )
}

async function runPass(
  adapter: ExecutionTargetAdapter,
  selections: readonly ScenarioSelection[],
  mode: 'adaptive' | 'replay',
  plans: ExecutionPlanStore | undefined,
  profileId: string,
  measuring: MeasuringAutomationFactory,
): Promise<BenchmarkTimings[]> {
  measuring.resetMetrics()
  const runs = await runScenarios({
    selections,
    executionTargetProfile: { id: profileId },
    adapter,
    plans: mode === 'replay' ? plans : undefined,
    concurrency: 1,
  })
  const metrics = measuring.takeMetrics()

  return runs.map((run, index) => {
    const sample = metrics[index] ?? {
      navigationMs: 0,
      modelCallMs: 0,
      artifactMs: 0,
    }
    const measuredTotal =
      sample.navigationMs + sample.modelCallMs + sample.artifactMs
    return {
      wallClockMs: Math.max(run.result.durationMs ?? 0, measuredTotal),
      modelCallMs: sample.modelCallMs,
      navigationMs: sample.navigationMs,
      artifactMs: sample.artifactMs,
    }
  })
}

async function collectAdapterSamples(
  kind: 'baseline' | 'candidate',
  input: RunWebPerformanceBenchmarkInput,
  measuring: MeasuringAutomationFactory,
): Promise<BenchmarkAdapterSamples> {
  const profileId = input.executionTargetProfile?.id ?? 'web'
  const adapter = createBenchmarkAdapter(kind, input.options, measuring.factory)

  try {
    const adaptiveCold = await runPass(
      adapter,
      input.selections,
      'adaptive',
      input.plans,
      profileId,
      measuring,
    )
    const adaptiveWarm = await runPass(
      adapter,
      input.selections,
      'adaptive',
      input.plans,
      profileId,
      measuring,
    )
    const replayCold = await runPass(
      adapter,
      input.selections,
      'replay',
      input.plans,
      profileId,
      measuring,
    )
    const replayWarm = await runPass(
      adapter,
      input.selections,
      'replay',
      input.plans,
      profileId,
      measuring,
    )

    return {
      adaptive: { cold: adaptiveCold, warm: adaptiveWarm },
      replay: { cold: replayCold, warm: replayWarm },
    }
  } finally {
    await adapter.dispose?.()
  }
}

export async function runWebPerformanceBenchmark(
  input: RunWebPerformanceBenchmarkInput,
): Promise<WebPerformanceBenchmarkResult> {
  const delays = {
    launchMs: 200,
    navigationMs: 40,
    modelCallMs: 120,
    artifactMs: 20,
    navigationMultiplier: 1,
    ...input.delays,
  }
  const baselineMeasuring = createMeasuringAutomationFactory({
    ...delays,
    navigationMultiplier: delays.navigationMultiplier * 2,
  })
  const candidateMeasuring = createMeasuringAutomationFactory(delays)

  return {
    baseline: await collectAdapterSamples('baseline', input, baselineMeasuring),
    candidate: await collectAdapterSamples(
      'candidate',
      input,
      candidateMeasuring,
    ),
  }
}

export function evaluatePerformanceGates(
  baseline: WebPerformanceBenchmarkResult['baseline'],
  candidate: WebPerformanceBenchmarkResult['candidate'],
): PerformanceGateEvaluation {
  const baselineWarmReplay = baseline.replay.warm.map(
    (sample) => sample.wallClockMs,
  )
  const candidateWarmReplay = candidate.replay.warm.map(
    (sample) => sample.wallClockMs,
  )
  const baselineAdaptive = [
    ...baseline.adaptive.cold,
    ...baseline.adaptive.warm,
  ].map((sample) => sample.wallClockMs)
  const candidateAdaptive = [
    ...candidate.adaptive.cold,
    ...candidate.adaptive.warm,
  ].map((sample) => sample.wallClockMs)

  const baselineWarmReplayP50 = percentile(baselineWarmReplay, 0.5)
  const candidateWarmReplayP50 = percentile(candidateWarmReplay, 0.5)
  const baselineAdaptiveP95 = percentile(baselineAdaptive, 0.95)
  const candidateAdaptiveP95 = percentile(candidateAdaptive, 0.95)

  const warmReplayPassed =
    baselineWarmReplayP50 === 0
      ? candidateWarmReplayP50 === 0
      : candidateWarmReplayP50 <= baselineWarmReplayP50 * 0.5
  const adaptivePassed =
    baselineAdaptiveP95 === 0
      ? candidateAdaptiveP95 === 0
      : candidateAdaptiveP95 <= baselineAdaptiveP95 * 1.1

  return {
    warmReplayP50: {
      baselineMs: baselineWarmReplayP50,
      candidateMs: candidateWarmReplayP50,
      improvementRatio:
        baselineWarmReplayP50 === 0
          ? 1
          : 1 - candidateWarmReplayP50 / baselineWarmReplayP50,
      passed: warmReplayPassed,
    },
    adaptiveP95: {
      baselineMs: baselineAdaptiveP95,
      candidateMs: candidateAdaptiveP95,
      regressionRatio:
        baselineAdaptiveP95 === 0
          ? 0
          : candidateAdaptiveP95 / baselineAdaptiveP95 - 1,
      passed: adaptivePassed,
    },
    passed: warmReplayPassed && adaptivePassed,
  }
}
