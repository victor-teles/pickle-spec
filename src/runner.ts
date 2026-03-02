// Disable AI SDK warning logs before any AI SDK code is imported
;(globalThis as any).AI_SDK_LOG_WARNINGS = false

import { Stagehand } from '@browserbasehq/stagehand'
import { z } from 'zod'
import type {
  PickleSpecConfig,
  StepResult,
  ScenarioResult,
  FeatureResult,
  RunResult,
} from './types'
import type { Pickle, PickleStep } from '@cucumber/messages'
import { hasIgnoreTag, type ParsedFeature } from './parser'
import { startServer, stopServer, type ManagedServer } from './server'
import { reportStepResult, reportStepStart, reportScenarioStart, reportScenarioIgnored, reportFeatureStart, reportVerbose, reportVerboseLog, suppressThirdPartyLogs } from './reporter'
import { captureScreenshot } from './screenshots'
import type { ScreenshotConfig } from './types'
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
  setActiveStagehand,
  setActiveServer,
} from './cancellation'

export { cancelRun } from './cancellation'

/**
 * Execute a single step against Stagehand.
 */
async function executeStep(
  stagehand: Stagehand,
  step: PickleStep,
  effectiveType: EffectiveStepType,
  baseUrl: string,
  verbose: boolean,
  signal: AbortSignal,
  screenshotCtx?: { config: ScreenshotConfig; featureName: string; scenarioName: string; stepIndex: number },
): Promise<StepResult> {
  const startTime = Date.now()
  const prompt = buildStepPrompt(step)
  let result: StepResult

  try {
    if (effectiveType === 'Context' || effectiveType === 'Action') {
      const navMatch = prompt.match(NAVIGATION_PATTERN)

      if (navMatch && effectiveType === 'Context') {
        const page = stagehand.context.pages()[0]!
        const target = navMatch[1]!.trim()
        const url = target.startsWith('/') ? `${baseUrl}${target}` : target

        if (url.startsWith('http') || url.startsWith('/')) {
          if (verbose) reportVerbose(`Navigating to ${url}`)
          await withCancellation(page.goto(url, { waitUntil: 'domcontentloaded' }))
        } else {
          if (verbose) reportVerbose(`Navigating to ${baseUrl}`)
          await withCancellation(page.goto(baseUrl, { waitUntil: 'domcontentloaded' }))
        }
      } else {
        if (verbose) reportVerbose(`Agent executing: "${prompt}"`)
        const agent = stagehand.agent()
        const execResult = await agent.execute({
          instruction: prompt,
          maxSteps: 10,
          signal,
        })
        if (!execResult.success) {
          result = {
            step,
            status: 'failed',
            durationMs: Date.now() - startTime,
            error: execResult.message,
          }
          if (screenshotCtx) {
            result.screenshotPath = await captureScreenshot(stagehand, screenshotCtx.config, {
              ...screenshotCtx, stepText: step.text, status: result.status,
            })
          }
          return result
        }
      }

      result = { step, status: 'passed', durationMs: Date.now() - startTime }
    } else {
      if (verbose) reportVerbose(`Verifying: "${prompt}"`)
      const agent = stagehand.agent()
      const execResult = await agent.execute({
        instruction:
          `Verify the following condition on the current page: "${prompt}". ` +
          `Determine if the page currently meets this expectation. ` +
          `You may scroll or observe the page to gather enough information.`,
        maxSteps: 5,
        output: VerificationSchema,
        signal,
      })

      const verification = execResult.output as z.infer<typeof VerificationSchema> | undefined

      if (!verification || !verification.meetsExpectation) {
        result = {
          step,
          status: 'failed',
          durationMs: Date.now() - startTime,
          error: `Expected: "${prompt}" | Actual: ${verification?.actualState ?? execResult.message}`,
        }
        if (screenshotCtx) {
          result.screenshotPath = await captureScreenshot(stagehand, screenshotCtx.config, {
            ...screenshotCtx, stepText: step.text, status: result.status,
          })
        }
        return result
      }

      result = { step, status: 'passed', durationMs: Date.now() - startTime }
    }
  } catch (err) {
    if (err instanceof CancellationError) throw err
    if (isCancelled()) throw new CancellationError()
    if (err instanceof Error && (err.name === 'AbortError' || err.name === 'AgentAbortError')) {
      throw new CancellationError()
    }

    result = {
      step,
      status: 'failed',
      durationMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    }
    if (screenshotCtx && !isCancelled()) {
      result.screenshotPath = await captureScreenshot(stagehand, screenshotCtx.config, {
        ...screenshotCtx, stepText: step.text, status: result.status,
      })
    }
    return result
  }

  if (screenshotCtx) {
    result.screenshotPath = await captureScreenshot(stagehand, screenshotCtx.config, {
      ...screenshotCtx, stepText: step.text, status: result.status,
    })
  }
  return result
}

/**
 * Execute a single scenario (Pickle).
 */
async function executeScenario(
  pickle: Pickle,
  config: PickleSpecConfig,
  stepInfoMap: Map<string, { keyword: string; type: EffectiveStepType }>,
  verbose: boolean,
  featureName: string,
  signal: AbortSignal,
): Promise<ScenarioResult> {
  const startTime = Date.now()
  const stagehandConfig = config.browser!
  const baseUrl = config.server?.url ?? 'http://localhost:3000'

  const restoreLogs = suppressThirdPartyLogs()

  const stagehand = new Stagehand({
    env: stagehandConfig.env ?? 'LOCAL',
    model: stagehandConfig.modelClientOptions
      ? { modelName: stagehandConfig.modelName ?? 'claude-4-6-sonnet-latest', ...stagehandConfig.modelClientOptions }
      : (stagehandConfig.modelName ?? 'claude-4-6-sonnet-latest'),
    localBrowserLaunchOptions: {
      headless: stagehandConfig.headless ?? true,
    },
    verbose: 0,
    disablePino: true,
    logger: verbose ? (line) => reportVerboseLog(line) : () => {},
    apiKey: stagehandConfig.apiKey,
    projectId: stagehandConfig.projectId,
    domSettleTimeout: stagehandConfig.domSettleTimeout ?? 3000,
    actTimeoutMs: stagehandConfig.actTimeoutMs,
    experimental: true
  })

  setActiveStagehand(stagehand)

  if (verbose) reportVerbose('Launching browser...')
  await withCancellation(stagehand.init())
  if (verbose) reportVerbose('Browser ready')

  const page = stagehand.context.pages()[0]!
  if (verbose) reportVerbose(`Navigating to ${baseUrl}`)
  await withCancellation(page.goto(baseUrl, { waitUntil: 'domcontentloaded' }))

  const stepResults: StepResult[] = []
  let scenarioFailed = false
  const screenshotConfig = config.screenshots
  const hasScreenshots = screenshotConfig && screenshotConfig.mode !== 'off'

  for (let i = 0; i < pickle.steps.length; i++) {
    const step = pickle.steps[i]!
    if (scenarioFailed || isCancelled()) {
      const info = stepInfoMap.get(step.astNodeIds[0]!)
      reportStepResult(info?.keyword ?? '  ', step.text, {
        step,
        status: 'skipped',
        durationMs: 0,
      })
      stepResults.push({ step, status: 'skipped', durationMs: 0 })
      continue
    }

    const info = stepInfoMap.get(step.astNodeIds[0]!)
    const effectiveType: EffectiveStepType = info?.type ?? 'Action'
    const keyword = info?.keyword ?? '  '

    reportStepStart(keyword, step.text)
    const screenshotCtx = hasScreenshots
      ? { config: screenshotConfig!, featureName, scenarioName: pickle.name, stepIndex: i }
      : undefined

    try {
      const result = await executeStep(stagehand, step, effectiveType, baseUrl, verbose, signal, screenshotCtx)
      stepResults.push(result)
      reportStepResult(keyword, step.text, result)

      if (result.status === 'failed') {
        scenarioFailed = true
      }
    } catch (err) {
      if (err instanceof CancellationError || isCancelled()) {
        reportStepResult(keyword, step.text, { step, status: 'skipped', durationMs: 0 })
        stepResults.push({ step, status: 'skipped', durationMs: 0 })
        break
      }
      throw err
    }
  }

  try {
    if (verbose) reportVerbose('Closing browser')
    await stagehand.close()
  } catch {
    // Browser may already be closed by cancellation handler
  }
  setActiveStagehand(null)
  restoreLogs()

  return {
    pickle,
    status: (scenarioFailed || isCancelled()) ? 'failed' : 'passed',
    steps: stepResults,
    durationMs: Date.now() - startTime,
  }
}

/**
 * Execute all parsed features.
 */
export async function runFeatures(
  features: ParsedFeature[],
  config: PickleSpecConfig,
  options: { verbose: boolean },
): Promise<RunResult> {
  const overallStart = Date.now()
  const signal = initCancellation()
  let server: ManagedServer | undefined

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
      const scenarioResults: ScenarioResult[] = []

      for (const pickle of feature.pickles) {
        if (isCancelled()) break

        if (hasIgnoreTag(pickle)) {
          reportScenarioIgnored(pickle.name)
          scenarioResults.push({
            pickle,
            status: 'skipped',
            steps: pickle.steps.map(step => ({ step, status: 'skipped' as const, durationMs: 0 })),
            durationMs: 0,
          })
          continue
        }

        reportScenarioStart(pickle.name)
        const result = await executeScenario(pickle, config, stepInfoMap, options.verbose, feature.featureName, signal)
        scenarioResults.push(result)
      }

      featureResults.push({
        featureFile: feature.filePath,
        featureName: feature.featureName,
        scenarios: scenarioResults,
        durationMs: Date.now() - featureStart,
      })
    }

    let passed = 0
    let failed = 0
    let skipped = 0
    for (const f of featureResults) {
      for (const s of f.scenarios) {
        if (s.status === 'passed') passed++
        else if (s.status === 'failed') failed++
        else skipped++
      }
    }

    const hasScreenshots = config.screenshots && config.screenshots.mode !== 'off'
    return {
      features: featureResults,
      totalDurationMs: Date.now() - overallStart,
      passed,
      failed,
      skipped,
      cancelled: isCancelled(),
      artifactsDir: hasScreenshots ? (config.screenshots!.outputDir ?? './pickle-artifacts') : undefined,
    }
  } finally {
    if (server) {
      stopServer(server)
      setActiveServer(null)
    }
  }
}
