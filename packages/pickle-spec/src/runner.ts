; (globalThis as any).AI_SDK_LOG_WARNINGS = false

import { Stagehand } from '@browserbasehq/stagehand'
import type {
  FailureKind,
  PickleSpecConfig,
  ScenarioAttemptResult,
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
  getActivePage,
} from './browser-lifecycle'
import { navigateAndSimplify } from './dom-optimization'

export { cancelRun } from './cancellation'

class TimeoutError extends Error {
  constructor(
    message: string,
    readonly kind: 'step' | 'scenario',
  ) {
    super(message)
    this.name = 'TimeoutError'
  }
}

class StepExecutionAbortedError extends Error {
  constructor() {
    super('Step execution aborted')
    this.name = 'StepExecutionAbortedError'
  }
}

function makeFailedStepResult(
  step: PickleStep,
  startTime: number,
  error: string,
  failureKind: FailureKind,
): StepResult {
  return { step, status: 'failed', durationMs: Date.now() - startTime, error, failureKind }
}

function makeSkippedResult(pickle: Pickle): ScenarioResult {
  return {
    pickle,
    status: 'skipped',
    steps: pickle.steps.map(step => ({ step, status: 'skipped' as const, durationMs: 0 })),
    durationMs: 0,
    attempts: 0,
  }
}

function makeScenarioFailure(
  pickle: Pickle,
  error: string,
  failureKind: FailureKind,
  durationMs = 0,
): ScenarioResult {
  const steps: StepResult[] = pickle.steps.map((step, index) => (
    index === 0
      ? { step, status: 'failed', durationMs, error, failureKind }
      : { step, status: 'skipped', durationMs: 0 }
  ))

  return {
    pickle,
    status: 'failed',
    steps,
    durationMs,
    error,
    failureKind,
  }
}

function shouldRetryScenario(result: ScenarioResult, config: PickleSpecConfig, attempt: number): boolean {
  const retries = config.execution?.retries ?? 0
  if (config.execution?.retryOn !== 'infrastructure') return false
  if (attempt > retries) return false
  return result.status === 'failed' && result.failureKind === 'infrastructure'
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number | undefined,
  error: TimeoutError,
  onTimeout: () => Promise<void>,
): Promise<T> {
  if (!timeoutMs) return promise

  return Promise.race([
    promise,
    Bun.sleep(timeoutMs).then(async () => {
      await onTimeout()
      throw error
    }),
  ])
}

function throwIfStepExecutionAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new StepExecutionAbortedError()
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

function toAttemptResult(result: ScenarioResult): ScenarioAttemptResult {
  return {
    status: result.status,
    durationMs: result.durationMs,
    error: result.error,
    failureKind: result.failureKind,
  }
}

function finalizeScenarioResult(result: ScenarioResult, attempts: ScenarioAttemptResult[]): ScenarioResult {
  return {
    ...result,
    attempts: attempts.length,
    flaky: result.status === 'passed' && attempts.some(attempt => attempt.status === 'failed'),
    attemptResults: attempts,
  }
}

function makeGlobalFailureResults(
  features: ParsedFeature[],
  error: string,
  failureKind: FailureKind,
): FeatureResult[] {
  return features.map(feature => ({
    featureFile: feature.filePath,
    featureName: feature.featureName,
    durationMs: 0,
    scenarios: feature.pickles.map(pickle => (
      hasIgnoreTag(pickle)
        ? makeSkippedResult(pickle)
        : finalizeScenarioResult(
          makeScenarioFailure(pickle, error, failureKind),
          [{ status: 'failed', durationMs: 0, error, failureKind }],
        )
    )),
  }))
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
  prompt: string,
  verbose: boolean,
  reporter: ReporterContext,
  observeTimeout = 10000,
  actTimeoutMs = 15000,
  signal?: AbortSignal,
): Promise<{ success: boolean; error?: string }[]> {
  throwIfStepExecutionAborted(signal)
  if (verbose) reporter.verbose(`Observing: "${prompt}"`)

  let { data: actions } = await withCancellation(
    stagehand.observe(prompt, { timeout: observeTimeout }),
  )
  throwIfStepExecutionAborted(signal)

  if (actions.length === 0) {
    if (verbose) reporter.verbose('Observe returned no actions, retrying once')
    ;({ data: actions } = await withCancellation(
      stagehand.observe(prompt, { timeout: observeTimeout }),
    ))
    throwIfStepExecutionAborted(signal)
  }

  if (actions.length === 0) {
    return [{ success: false, error: 'Observe returned no actions' }]
  }

  const executedActions: { success: boolean; error?: string }[] = []

  for (const action of actions) {
    throwIfStepExecutionAborted(signal)
    if (isCancelled()) throw new CancellationError()
    if (verbose) reporter.verbose(`Acting: ${action.description}`)
    try {
      const result = await withCancellation(
        stagehand.act(action, { timeout: actTimeoutMs }),
      )
      throwIfStepExecutionAborted(signal)
      executedActions.push({
        success: result.data.success,
        error: result.data.success ? undefined : result.data.message,
      })
    } catch (err) {
      if (err instanceof StepExecutionAbortedError) throw err
      rethrowIfCancellation(err)
      if (verbose) reporter.verbose(`Act threw error`)
      executedActions.push({ success: false, error: err instanceof Error ? err.message : String(err) })
    }
  }

  return executedActions
}

async function executeStep(
  stagehand: Stagehand,
  step: PickleStep,
  effectiveType: EffectiveStepType,
  baseUrl: string,
  navTimeout: number,
  verbose: boolean,
  reporter: ReporterContext,
  screenshotCtx?: { config: ScreenshotConfig; featureName: string; scenarioName: string; stepIndex: number },
  traceCtx?: { traceDir: string; stepIndex: number },
  domSimplification = true,
  observeTimeout = 10000,
  actTimeoutMs = 15000,
  signal?: AbortSignal,
): Promise<StepResult> {
  const startTime = Date.now()
  const prompt = buildStepPrompt(step)
  throwIfStepExecutionAborted(signal)

  let recorder: TraceRecorder | null = null
  if (traceCtx) {
    try { recorder = await startStepTrace(stagehand) } catch { }
    throwIfStepExecutionAborted(signal)
  }

  async function finalize(result: StepResult): Promise<StepResult> {
    throwIfStepExecutionAborted(signal)
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
        const page = await getActivePage(stagehand)
        throwIfStepExecutionAborted(signal)
        const target = navMatch[1]!.trim()
        const url = target.startsWith('/') ? `${baseUrl}${target}` : target

        if (url.startsWith('http') || url.startsWith('/')) {
          if (verbose) reporter.verbose(`Navigating to ${url}`)
          await navigateAndSimplify(page, url, { waitUntil: 'domcontentloaded', timeout: navTimeout }, domSimplification)
        } else {
          if (verbose) reporter.verbose(`Navigating to ${baseUrl}`)
          await navigateAndSimplify(page, baseUrl, { waitUntil: 'domcontentloaded', timeout: navTimeout }, domSimplification)
        }
      } else {
        const execResults = await executeWithObserveAct(
          stagehand, prompt, verbose, reporter, observeTimeout, actTimeoutMs, signal,
        )
        for (const execResult of execResults) {
          if (!execResult.success) {
            return await finalize(makeFailedStepResult(step, startTime, execResult.error ?? 'Action failed', 'infrastructure'))
          }
        }
      }

      return await finalize({ step, status: 'passed', durationMs: Date.now() - startTime })
    }

    if (verbose) reporter.verbose(`Verifying: "${prompt}"`)
    const verificationPrompt =
      `Verify the following condition on the current page: "${prompt}". ` +
      `Determine if the page currently meets this expectation.`
    const { data: verification } = await withCancellation(
      stagehand.extract(verificationPrompt, VerificationSchema),
    )
    throwIfStepExecutionAborted(signal)

    if (!verification.meetsExpectation) {
      const error = `Expected: "${prompt}" | Actual: ${verification.actualState}`
      return await finalize(makeFailedStepResult(step, startTime, error, 'assertion'))
    }

    return await finalize({ step, status: 'passed', durationMs: Date.now() - startTime })
  } catch (err) {
    if (err instanceof StepExecutionAbortedError) throw err
    rethrowIfCancellation(err)
    const result = makeFailedStepResult(step, startTime, err instanceof Error ? err.message : String(err), 'infrastructure')
    if (!isCancelled()) return await finalize(result)
    return {
      ...result,
      failureKind: 'cancellation',
    }
  }
}

// --- Scenario execution ---

async function executeScenarioAttempt(
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
  const stepResults: StepResult[] = []
  let scenarioFailed = false
  const screenshotConfig = config.screenshots
  const hasScreenshots = screenshotConfig && screenshotConfig.mode !== 'off'
  const artifactsDir = config.screenshots?.outputDir ?? './.pickle/artifacts'
  const traceDir = join(artifactsDir, 'traces', sanitize(featureName), sanitize(pickle.name))
  const configuredScenarioTimeout = config.execution?.scenarioTimeoutMs
  const configuredStepTimeout = config.execution?.stepTimeoutMs

  for (let i = 0; i < pickle.steps.length; i++) {
    const step = pickle.steps[i]!
    const info = stepInfoMap.get(step.astNodeIds[0]!)
    const keyword = info?.keyword ?? '  '

    const elapsed = Date.now() - startTime
    const remainingScenarioTime = configuredScenarioTimeout !== undefined
      ? configuredScenarioTimeout - elapsed
      : undefined

    if (scenarioFailed || isCancelled()) {
      reporter.stepResult(keyword, step.text, { step, status: 'skipped', durationMs: 0 })
      stepResults.push({ step, status: 'skipped', durationMs: 0 })
      continue
    }

    if (remainingScenarioTime !== undefined && remainingScenarioTime <= 0) {
      const timeoutResult = makeFailedStepResult(
        step,
        startTime,
        `Scenario timed out after ${configuredScenarioTimeout}ms`,
        'infrastructure',
      )
      reporter.stepResult(keyword, step.text, timeoutResult)
      stepResults.push(timeoutResult)
      scenarioFailed = true
      continue
    }

    const effectiveType: EffectiveStepType = info?.type ?? 'Action'
    reporter.stepStart(keyword, step.text)

    const screenshotCtx = hasScreenshots
      ? { config: screenshotConfig!, featureName, scenarioName: pickle.name, stepIndex: i }
      : undefined
    const effectiveStepTimeout = remainingScenarioTime === undefined
      ? configuredStepTimeout
      : configuredStepTimeout === undefined
        ? remainingScenarioTime
        : Math.min(configuredStepTimeout, remainingScenarioTime)
    const timeoutKind =
      effectiveStepTimeout === undefined
        ? 'step'
        : configuredScenarioTimeout !== undefined && effectiveStepTimeout === remainingScenarioTime
          ? 'scenario'
          : 'step'
    const timeoutMessage = timeoutKind === 'scenario'
      ? `Scenario timed out after ${configuredScenarioTimeout}ms`
      : `Step timed out after ${effectiveStepTimeout}ms`

    try {
      const stepController = new AbortController()
      const result = await withTimeout(
        executeStep(
          stagehand, step, effectiveType, baseUrl, navTimeout,
          verbose, reporter, screenshotCtx, { traceDir, stepIndex: i },
          config.browser?.domSimplification ?? true,
          config.browser?.observeTimeout ?? 10000,
          config.browser?.actTimeoutMs ?? 15000,
          stepController.signal,
        ),
        effectiveStepTimeout,
        new TimeoutError(timeoutMessage, timeoutKind),
        async () => {
          stepController.abort()
          await closeStagehand(stagehand)
        },
      )
      stepResults.push(result)
      reporter.stepResult(keyword, step.text, result)
      if (result.status === 'failed') scenarioFailed = true
    } catch (err) {
      if (err instanceof TimeoutError) {
        const timeoutResult = makeFailedStepResult(step, startTime, err.message, 'infrastructure')
        reporter.stepResult(keyword, step.text, timeoutResult)
        stepResults.push(timeoutResult)
        scenarioFailed = true
        continue
      }
      if (err instanceof CancellationError || isCancelled()) {
        reporter.stepResult(keyword, step.text, { step, status: 'skipped', durationMs: 0 })
        stepResults.push({ step, status: 'skipped', durationMs: 0 })
        break
      }
      throw err
    }
  }

  const failedStep = stepResults.find(step => step.status === 'failed')
  return {
    pickle,
    status: (scenarioFailed || isCancelled()) ? 'failed' : 'passed',
    steps: stepResults,
    durationMs: Date.now() - startTime,
    error: failedStep?.error,
    failureKind: isCancelled() ? 'cancellation' : failedStep?.failureKind,
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
  let browserDirty = false
  let forceFreshBrowser = false

  async function closeSerialStagehand(): Promise<void> {
    if (!stagehand) return
    if (verbose) reportVerbose('Closing browser')
    await closeStagehand(stagehand)
    setActiveStagehand(null)
    stagehand = null
    browserDirty = false
  }

  async function prepareStagehandForAttempt(): Promise<Stagehand> {
    if (!stagehand || forceFreshBrowser) {
      await closeSerialStagehand()
      stagehand = await createStagehandAndNavigate(browserConfig, baseUrl, navTimeout, verbose, reporter)
      setActiveStagehand(stagehand)
      forceFreshBrowser = false
      browserDirty = false
      return stagehand
    }

    if (browserDirty) {
      try {
        await resetBrowserState(stagehand, baseUrl, navTimeout, browserConfig.domSimplification ?? true)
      } catch {
        await closeSerialStagehand()
        stagehand = await createStagehandAndNavigate(browserConfig, baseUrl, navTimeout, verbose, reporter)
        setActiveStagehand(stagehand)
      }
      browserDirty = false
    }

    return stagehand
  }

  try {
    for (const pickle of pickles) {
      if (isCancelled()) break

      if (hasIgnoreTag(pickle)) {
        reporter.scenarioIgnored(pickle.name)
        scenarioResults.push(makeSkippedResult(pickle))
        continue
      }

      reporter.scenarioStart(pickle.name)
      const attemptResults: ScenarioAttemptResult[] = []
      let attempt = 1
      let finalResult: ScenarioResult | null = null

      while (true) {
        let attemptResult: ScenarioResult
        try {
          const activeStagehand = await prepareStagehandForAttempt()
          attemptResult = await executeScenarioAttempt(activeStagehand, pickle, config, stepInfoMap, verbose, featureName, signal, reporter)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          const failureKind: FailureKind = (err instanceof CancellationError || isCancelled())
            ? 'cancellation'
            : 'infrastructure'
          attemptResult = makeScenarioFailure(pickle, message, failureKind)
        }
        attemptResults.push(toAttemptResult(attemptResult))
        browserDirty = true
        forceFreshBrowser = attemptResult.failureKind === 'infrastructure'

        if (!shouldRetryScenario(attemptResult, config, attempt)) {
          finalResult = finalizeScenarioResult(attemptResult, attemptResults)
          scenarioResults.push(finalResult)
          break
        }

        forceFreshBrowser = true
        attempt++
      }

      if (finalResult?.failureKind === 'cancellation') {
        break
      }
    }
  } finally {
    await closeSerialStagehand()
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
        const attemptResults: ScenarioAttemptResult[] = []
        let attempt = 1
        let finalResult: ScenarioResult | null = null

        try {
          while (true) {
            let stagehand: Stagehand | null = null
            let attemptResult: ScenarioResult

            try {
              if (isCancelled()) {
                attemptResult = makeScenarioFailure(pickle, 'Run cancelled by user', 'cancellation')
              } else {
                stagehand = await createStagehandAndNavigate(browserConfig, baseUrl, navTimeout, verbose, reporter)
                addActiveStagehand(stagehand)
                attemptResult = await executeScenarioAttempt(stagehand, pickle, config, stepInfoMap, verbose, featureName, signal, reporter)
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err)
              const failureKind: FailureKind = (err instanceof CancellationError || isCancelled())
                ? 'cancellation'
                : 'infrastructure'
              attemptResult = makeScenarioFailure(pickle, message, failureKind)
            } finally {
              if (stagehand) {
                await closeStagehand(stagehand)
                removeActiveStagehand(stagehand)
              }
            }

            attemptResults.push(toAttemptResult(attemptResult))

            if (!shouldRetryScenario(attemptResult, config, attempt)) {
              finalResult = finalizeScenarioResult(attemptResult, attemptResults)
              return { pickle, result: finalResult }
            }

            attempt++
          }
        } finally {
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
      try {
        server = await startServer(config.server)
        setActiveServer(server)
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err)
        const featureResults = makeGlobalFailureResults(features, error, isCancelled() ? 'cancellation' : 'infrastructure')
        return {
          features: featureResults,
          totalDurationMs: Date.now() - overallStart,
          ...aggregateResults(featureResults),
          cancelled: isCancelled(),
          artifactsDir: config.screenshots?.outputDir ?? './.pickle/artifacts',
        }
      }
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
      server: server
        ? {
          mode: server.reused ? 'reused' : 'spawned',
          url: server.url ?? config.server?.url,
        }
        : undefined,
    }
  } finally {
    if (server) {
      stopServer(server)
      setActiveServer(null)
    }
  }
}
