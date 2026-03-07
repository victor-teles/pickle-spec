; (globalThis as any).AI_SDK_LOG_WARNINGS = false

import { Stagehand } from '@browserbasehq/stagehand'
import { z } from 'zod'
import type {
  PickleSpecConfig,
  StepResult,
  ScenarioResult,
  FeatureResult,
  RunResult,
  ScreenshotConfig,
  StepStatus,
} from './types'
import type { Pickle, PickleStep } from '@cucumber/messages'
import { hasIgnoreTag, type ParsedFeature } from './parser'
import { startServer, stopServer, type ManagedServer } from './server'
import { reportScenarioIgnored, reportFeatureStart, reportVerbose, suppressThirdPartyLogs, createDirectReporter, createBufferedReporter, startParallelProgress, type ReporterContext } from './reporter'
import { join } from 'path'
import { captureScreenshot, sanitize } from './screenshots'
import { startStepTrace, type TraceRecorder } from './trace'
import {
  type EffectiveStepType,
  buildStepInfoMap,
  buildStepPrompt,
  VerificationSchema,
  NAVIGATION_PATTERN,
} from './step-utils'
import {
  CancellationError,
  initCancellation,
  isCancelled,
  withCancellation,
  rethrowIfCancellation,
  setActiveStagehand,
  addActiveStagehand,
  removeActiveStagehand,
  setActiveServer,
} from './cancellation'
import {
  createStagehandAndNavigate,
  resetBrowserState,
  closeStagehand,
} from './browser-lifecycle'
import { navigateAndSimplify } from './dom-optimization'

export { cancelRun } from './cancellation'

function makeFailedStepResult(step: PickleStep, startTime: number, error: string): StepResult {
  return { step, status: 'failed', durationMs: Date.now() - startTime, error }
}

function makeSkippedResult(pickle: Pickle): ScenarioResult {
  return {
    pickle,
    status: 'skipped',
    steps: pickle.steps.map(step => ({ step, status: 'skipped' as const, durationMs: 0 })),
    durationMs: 0,
  }
}

async function maybeScreenshot(
  stagehand: Stagehand,
  step: PickleStep,
  status: StepStatus,
  screenshotCtx?: { config: ScreenshotConfig; featureName: string; scenarioName: string; stepIndex: number },
): Promise<string | undefined> {
  if (!screenshotCtx) return undefined
  return captureScreenshot(stagehand, screenshotCtx.config, {
    ...screenshotCtx, stepText: step.text, status,
  })
}

function aggregateResults(featureResults: FeatureResult[]): { passed: number; failed: number; skipped: number } {
  let passed = 0, failed = 0, skipped = 0
  for (const f of featureResults) {
    for (const s of f.scenarios) {
      if (s.status === 'passed') passed++
      else if (s.status === 'failed') failed++
      else skipped++
    }
  }
  return { passed, failed, skipped }
}

// --- Concurrency ---

class Semaphore {
  private queue: (() => void)[] = []
  private active = 0

  constructor(private readonly limit: number) { }

  async acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active++
      return
    }
    return new Promise<void>(resolve => {
      this.queue.push(resolve)
    })
  }

  release(): void {
    this.active--
    const next = this.queue.shift()
    if (next) {
      this.active++
      next()
    }
  }
}

async function executeWithObserveAct(
  stagehand: Stagehand,
  agent: ReturnType<Stagehand['agent']>,
  prompt: string,
  verbose: boolean,
  signal: AbortSignal,
  reporter: ReporterContext,
  observeTimeout = 10000,
): Promise<{ success: boolean; error?: string }[]> {
  if (verbose) reporter.verbose(`Observing: "${prompt}"`)

  const actions = await withCancellation(stagehand.observe(prompt, { timeout: observeTimeout }))

  if (actions.length === 0) {
    if (verbose) reporter.verbose(`Observe returned no actions, falling back to agent`)
    const result = await agent.execute({ instruction: prompt, maxSteps: 10, signal })
    return [{ success: result.success, error: result.success ? undefined : result.message }]
  }

  const executedActions: { success: boolean; error?: string }[] = []

  for (const action of actions) {
    if (isCancelled()) throw new CancellationError()
    if (verbose) reporter.verbose(`Acting: ${action.description}`)
    try {
      const result = await withCancellation(stagehand.act(action))
      executedActions.push({ success: result.success, error: result.success ? undefined : result.message })
    } catch (err) {
      rethrowIfCancellation(err)
      if (verbose) reporter.verbose(`Act threw error`)
      executedActions.push({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return executedActions
}

async function executeStep(
  stagehand: Stagehand,
  agent: ReturnType<Stagehand['agent']>,
  step: PickleStep,
  effectiveType: EffectiveStepType,
  baseUrl: string,
  navTimeout: number,
  verbose: boolean,
  signal: AbortSignal,
  reporter: ReporterContext,
  screenshotCtx?: { config: ScreenshotConfig; featureName: string; scenarioName: string; stepIndex: number },
  traceCtx?: { traceDir: string; stepIndex: number },
  domSimplification = true,
  observeTimeout = 10000,
): Promise<StepResult> {
  const startTime = Date.now()
  const prompt = buildStepPrompt(step)

  let recorder: TraceRecorder | null = null
  if (traceCtx) {
    try { recorder = await startStepTrace(stagehand) } catch { }
  }

  async function finalize(result: StepResult): Promise<StepResult> {
    if (recorder && traceCtx) {
      try {
        await recorder.stop()
        const prefix = `step-${String(traceCtx.stepIndex).padStart(2, '0')}`
        result.traceFramePaths = await recorder.saveFrames(traceCtx.traceDir, prefix)
      } catch { }
    }
    result.screenshotPath = await maybeScreenshot(stagehand, step, result.status, screenshotCtx)
    return result
  }

  try {
    if (effectiveType === 'Context' || effectiveType === 'Action') {
      const navMatch = prompt.match(NAVIGATION_PATTERN)

      if (navMatch && effectiveType === 'Context') {
        const page = stagehand.context.pages()[0]!
        const target = navMatch[1]!.trim()
        const url = target.startsWith('/') ? `${baseUrl}${target}` : target

        if (url.startsWith('http') || url.startsWith('/')) {
          if (verbose) reporter.verbose(`Navigating to ${url}`)
          await navigateAndSimplify(page, url, { waitUntil: 'domcontentloaded', timeoutMs: navTimeout }, domSimplification)
        } else {
          if (verbose) reporter.verbose(`Navigating to ${baseUrl}`)
          await navigateAndSimplify(page, baseUrl, { waitUntil: 'domcontentloaded', timeoutMs: navTimeout }, domSimplification)
        }
      } else {
        const execResults = await executeWithObserveAct(stagehand, agent, prompt, verbose, signal, reporter, observeTimeout)
        for (const execResult of execResults) {
          if (!execResult.success) {
            return await finalize(makeFailedStepResult(step, startTime, execResult.error ?? 'Action failed'))
          }
        }
      }

      return await finalize({ step, status: 'passed', durationMs: Date.now() - startTime })
    }

    if (verbose) reporter.verbose(`Verifying: "${prompt}"`)
    const execResult = await agent.execute({
      instruction:
        `Verify the following condition on the current page: "${prompt}". ` +
        `Determine if the page currently meets this expectation. `,
      maxSteps: 5,
      output: VerificationSchema,
      signal,
    })

    const verification = execResult.output as z.infer<typeof VerificationSchema> | undefined

    if (!verification || !verification.meetsExpectation) {
      const error = `Expected: "${prompt}" | Actual: ${verification?.actualState ?? execResult.message}`
      return await finalize(makeFailedStepResult(step, startTime, error))
    }

    return await finalize({ step, status: 'passed', durationMs: Date.now() - startTime })
  } catch (err) {
    rethrowIfCancellation(err)
    const result = makeFailedStepResult(step, startTime, err instanceof Error ? err.message : String(err))
    if (!isCancelled()) return await finalize(result)
    return result
  }
}

// --- Scenario execution ---

async function executeScenario(
  stagehand: Stagehand,
  pickle: Pickle,
  config: PickleSpecConfig,
  stepInfoMap: Map<string, { keyword: string; type: EffectiveStepType }>,
  verbose: boolean,
  featureName: string,
  signal: AbortSignal,
  reporter: ReporterContext,
): Promise<ScenarioResult> {
  const startTime = Date.now()
  const baseUrl = config.server?.url ?? 'http://localhost:3000'
  const navTimeout = config.browser?.navigationTimeout ?? 15000
  const agent = stagehand.agent()
  const stepResults: StepResult[] = []
  let scenarioFailed = false
  const screenshotConfig = config.screenshots
  const hasScreenshots = screenshotConfig && screenshotConfig.mode !== 'off'
  const artifactsDir = config.screenshots?.outputDir ?? './.pickle/artifacts'
  const traceDir = join(artifactsDir, 'traces', sanitize(featureName), sanitize(pickle.name))

  for (let i = 0; i < pickle.steps.length; i++) {
    const step = pickle.steps[i]!
    const info = stepInfoMap.get(step.astNodeIds[0]!)
    const keyword = info?.keyword ?? '  '

    if (scenarioFailed || isCancelled()) {
      reporter.stepResult(keyword, step.text, { step, status: 'skipped', durationMs: 0 })
      stepResults.push({ step, status: 'skipped', durationMs: 0 })
      continue
    }

    const effectiveType: EffectiveStepType = info?.type ?? 'Action'
    reporter.stepStart(keyword, step.text)

    const screenshotCtx = hasScreenshots
      ? { config: screenshotConfig!, featureName, scenarioName: pickle.name, stepIndex: i }
      : undefined

    try {
      const result = await executeStep(
        stagehand, agent, step, effectiveType, baseUrl, navTimeout,
        verbose, signal, reporter, screenshotCtx, { traceDir, stepIndex: i },
        config.browser?.domSimplification ?? true,
        config.browser?.observeTimeout ?? 10000,
      )
      stepResults.push(result)
      reporter.stepResult(keyword, step.text, result)
      if (result.status === 'failed') scenarioFailed = true
    } catch (err) {
      if (err instanceof CancellationError || isCancelled()) {
        reporter.stepResult(keyword, step.text, { step, status: 'skipped', durationMs: 0 })
        stepResults.push({ step, status: 'skipped', durationMs: 0 })
        break
      }
      throw err
    }
  }

  return {
    pickle,
    status: (scenarioFailed || isCancelled()) ? 'failed' : 'passed',
    steps: stepResults,
    durationMs: Date.now() - startTime,
  }
}

// --- Feature execution strategies ---

async function runFeatureSerial(
  pickles: readonly Pickle[],
  config: PickleSpecConfig,
  stepInfoMap: Map<string, { keyword: string; type: EffectiveStepType }>,
  featureName: string,
  verbose: boolean,
  signal: AbortSignal,
): Promise<ScenarioResult[]> {
  const browserConfig = config.browser!
  const baseUrl = config.server?.url ?? 'http://localhost:3000'
  const navTimeout = browserConfig.navigationTimeout ?? 15000
  const reporter = createDirectReporter()
  const scenarioResults: ScenarioResult[] = []
  let stagehand: Stagehand | null = null

  try {
    stagehand = await createStagehandAndNavigate(browserConfig, baseUrl, navTimeout, verbose, reporter)
    setActiveStagehand(stagehand)
    let isFirstScenario = true

    for (const pickle of pickles) {
      if (isCancelled()) break

      if (hasIgnoreTag(pickle)) {
        reporter.scenarioIgnored(pickle.name)
        scenarioResults.push(makeSkippedResult(pickle))
        continue
      }

      if (!isFirstScenario) {
        try {
          await resetBrowserState(stagehand!, baseUrl, navTimeout, browserConfig.domSimplification ?? true)
        } catch {
          await closeStagehand(stagehand!)
          stagehand = await createStagehandAndNavigate(browserConfig, baseUrl, navTimeout, verbose, reporter)
          setActiveStagehand(stagehand)
        }
      }
      isFirstScenario = false

      reporter.scenarioStart(pickle.name)
      const result = await executeScenario(stagehand!, pickle, config, stepInfoMap, verbose, featureName, signal, reporter)
      scenarioResults.push(result)
    }
  } finally {
    if (stagehand) {
      if (verbose) reportVerbose('Closing browser')
      await closeStagehand(stagehand)
      setActiveStagehand(null)
    }
  }

  return scenarioResults
}

async function runFeatureParallel(
  pickles: readonly Pickle[],
  runnablePickles: readonly Pickle[],
  config: PickleSpecConfig,
  stepInfoMap: Map<string, { keyword: string; type: EffectiveStepType }>,
  featureName: string,
  verbose: boolean,
  signal: AbortSignal,
  concurrency: number,
): Promise<ScenarioResult[]> {
  const browserConfig = config.browser!
  const baseUrl = config.server?.url ?? 'http://localhost:3000'
  const navTimeout = browserConfig.navigationTimeout ?? 15000
  const semaphore = new Semaphore(concurrency)
  const scenarioResults: ScenarioResult[] = []
  let completed = 0
  let progress = startParallelProgress(runnablePickles.length)

  const scenarioTasks: Promise<{ pickle: Pickle; result: ScenarioResult }>[] = []

  for (const pickle of pickles) {
    if (isCancelled()) break

    if (hasIgnoreTag(pickle)) {
      reportScenarioIgnored(pickle.name)
      scenarioResults.push(makeSkippedResult(pickle))
      continue
    }

    const task = (async () => {
      await semaphore.acquire()
      try {
        if (isCancelled()) return { pickle, result: makeSkippedResult(pickle) }

        const reporter = createBufferedReporter()
        reporter.scenarioStart(pickle.name)
        let stagehand: Stagehand | null = null

        try {
          stagehand = await createStagehandAndNavigate(browserConfig, baseUrl, navTimeout, verbose, reporter)
          addActiveStagehand(stagehand)
          const result = await executeScenario(stagehand, pickle, config, stepInfoMap, verbose, featureName, signal, reporter)
          return { pickle, result }
        } catch (err) {
          if (err instanceof CancellationError || isCancelled()) {
            return { pickle, result: makeSkippedResult(pickle) }
          }
          return {
            pickle,
            result: {
              pickle,
              status: 'failed' as const,
              steps: pickle.steps.map(step => ({ step, status: 'failed' as const, durationMs: 0, error: err instanceof Error ? err.message : String(err) })),
              durationMs: 0,
            },
          }
        } finally {
          if (stagehand) {
            await closeStagehand(stagehand)
            removeActiveStagehand(stagehand)
          }
          completed++
          progress.stop()
          reporter.flush()
          if (completed < runnablePickles.length) {
            progress = startParallelProgress(runnablePickles.length)
            progress.update(completed)
          }
        }
      } finally {
        semaphore.release()
      }
    })()

    scenarioTasks.push(task)
  }

  const settled = await Promise.allSettled(scenarioTasks)
  progress.stop()
  for (const entry of settled) {
    if (entry.status === 'fulfilled') {
      scenarioResults.push(entry.value.result)
    }
  }

  return scenarioResults
}

// --- Main entry point ---

export async function runFeatures(
  features: ParsedFeature[],
  config: PickleSpecConfig,
  options: { verbose: boolean },
): Promise<RunResult> {
  const overallStart = Date.now()
  const signal = initCancellation()
  let server: ManagedServer | undefined
  const concurrency = config.concurrency ?? 1
  const verbose = options.verbose || config.verbose || false

  try {
    if (config.server?.command) {
      server = await startServer(config.server)
      setActiveServer(server)
    }

    const featureResults: FeatureResult[] = []

    for (const feature of features) {
      if (isCancelled()) break
      reportFeatureStart(feature.featureName, feature.filePath)
      const featureStart = Date.now()
      const stepInfoMap = buildStepInfoMap(feature.document)
      const runnablePickles = feature.pickles.filter(p => !hasIgnoreTag(p))

      let scenarioResults: ScenarioResult[]

      if (runnablePickles.length === 0) {
        scenarioResults = feature.pickles.map(pickle => {
          reportScenarioIgnored(pickle.name)
          return makeSkippedResult(pickle)
        })
      } else {
        const restoreLogs = verbose ? undefined : suppressThirdPartyLogs()
        try {
          scenarioResults = concurrency <= 1
            ? await runFeatureSerial(feature.pickles, config, stepInfoMap, feature.featureName, verbose, signal)
            : await runFeatureParallel(feature.pickles, runnablePickles, config, stepInfoMap, feature.featureName, verbose, signal, concurrency)
        } finally {
          restoreLogs?.()
        }
      }

      featureResults.push({
        featureFile: feature.filePath,
        featureName: feature.featureName,
        scenarios: scenarioResults,
        durationMs: Date.now() - featureStart,
      })
    }

    const artifactsDir = config.screenshots?.outputDir ?? './.pickle/artifacts'
    return {
      features: featureResults,
      totalDurationMs: Date.now() - overallStart,
      ...aggregateResults(featureResults),
      cancelled: isCancelled(),
      artifactsDir,
    }
  } finally {
    if (server) {
      stopServer(server)
      setActiveServer(null)
    }
  }
}
