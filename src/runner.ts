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
import { StepKeywordType } from '@cucumber/messages'
import type { Pickle, PickleStep, Step, GherkinDocument } from '@cucumber/messages'
import { hasIgnoreTag, type ParsedFeature } from './parser'
import { startServer, stopServer, type ManagedServer } from './server'
import { reportStepResult, reportStepStart, reportScenarioStart, reportScenarioIgnored, reportFeatureStart, reportVerbose, reportVerboseLog } from './reporter'
import { captureScreenshot } from './screenshots'
import type { ScreenshotConfig } from './types'

/**
 * Effective step type for dispatch: Context (Given), Action (When), Outcome (Then).
 */
type EffectiveStepType = 'Context' | 'Action' | 'Outcome'

/**
 * Build a map from AST Step ID to its keyword and keyword type.
 */
function buildStepInfoMap(document: GherkinDocument): Map<string, { keyword: string; type: EffectiveStepType }> {
  const map = new Map<string, { keyword: string; type: EffectiveStepType }>()

  if (!document.feature) return map

  function processSteps(steps: readonly Step[], previousType: EffectiveStepType = 'Context') {
    let lastEffective: EffectiveStepType = previousType
    for (const step of steps) {
      let effective: EffectiveStepType
      switch (step.keywordType) {
        case StepKeywordType.CONTEXT:
          effective = 'Context'
          break
        case StepKeywordType.ACTION:
          effective = 'Action'
          break
        case StepKeywordType.OUTCOME:
          effective = 'Outcome'
          break
        case StepKeywordType.CONJUNCTION:
        default:
          effective = lastEffective
          break
      }
      lastEffective = effective
      map.set(step.id, { keyword: step.keyword, type: effective })
    }
  }

  for (const child of document.feature.children) {
    if (child.background) {
      processSteps(child.background.steps)
    }
    if (child.scenario) {
      processSteps(child.scenario.steps)
    }
    if (child.rule) {
      for (const ruleChild of child.rule.children) {
        if (ruleChild.background) {
          processSteps(ruleChild.background.steps)
        }
        if (ruleChild.scenario) {
          processSteps(ruleChild.scenario.steps)
        }
      }
    }
  }

  return map
}

/**
 * Build prompt text for a step, including data table or doc string arguments.
 */
function buildStepPrompt(step: PickleStep): string {
  let prompt = step.text

  if (step.argument?.dataTable) {
    const rows = step.argument.dataTable.rows
    if (rows.length > 0) {
      const headers = rows[0]!.cells.map(c => c.value)
      const dataRows = rows.slice(1)
      prompt += '\n\nWith the following data:\n'
      prompt += headers.join(' | ') + '\n'
      for (const row of dataRows) {
        prompt += row.cells.map(c => c.value).join(' | ') + '\n'
      }
    }
  }

  if (step.argument?.docString) {
    prompt += '\n\n' + step.argument.docString.content
  }

  return prompt
}

const VerificationSchema = z.object({
  meetsExpectation: z.boolean().describe(
    'Whether the current page state matches the expected condition',
  ),
  actualState: z.string().describe(
    'Description of the actual state observed on the page',
  ),
})

/**
 * Multilingual regex to detect navigation patterns in step text.
 * Supports English, Portuguese, Spanish, and French.
 */
const NAVIGATION_PATTERN = new RegExp(
  '(?:' +
    'I (?:am on|navigate to|visit|go to|open)' +               // English
    '|(?:eu )?(?:navego para|visito|abro|estou em)' +           // Portuguese
    '|(?:yo )?(?:navego a|visito|abro|estoy en)' +              // Spanish
    '|(?:je )?(?:navigue vers|visite|ouvre|suis sur)' +          // French
  ')' +
  '\\s+(?:(?:the|a|o|la|le|el|à)\\s+)?' +                      // optional articles
  '["\'"]?(.+?)["\'"]?\\s*$',                                   // capture target (non-greedy)
  'i',
)

// --- Cancellation infrastructure ---

let abortController: AbortController | null = null
let activeStagehand: Stagehand | null = null
let activeServer: ManagedServer | null = null

class CancellationError extends Error {
  constructor() {
    super('Run cancelled by user')
    this.name = 'CancellationError'
  }
}

function initCancellation(): AbortSignal {
  abortController = new AbortController()
  return abortController.signal
}

export function cancelRun(): void {
  if (abortController && !abortController.signal.aborted) {
    abortController.abort()
  }

  if (activeStagehand) {
    activeStagehand.close({ force: true }).catch(() => {})
    activeStagehand = null
  }

  if (activeServer) {
    stopServer(activeServer)
    activeServer = null
  }
}

function isCancelled(): boolean {
  return abortController?.signal.aborted ?? false
}

function withCancellation<T>(promise: Promise<T>): Promise<T> {
  if (isCancelled()) return Promise.reject(new CancellationError())

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new CancellationError())
    abortController!.signal.addEventListener('abort', onAbort, { once: true })

    promise.then(
      (value) => {
        abortController?.signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err) => {
        abortController?.signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}

const SUPPRESSED_CONSOLE_PATTERNS = [
  /AI SDK Warning/,
  /\[Stagehand\]/,
  /\[v3-piercer\]/,
  /OUT OF SYNC/,
  /DEPRECATED/,
]

function suppressThirdPartyLogs(): () => void {
  const origWarn = console.warn
  const origError = console.error
  const origLog = console.log

  const shouldSuppress = (args: unknown[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : ''
    return SUPPRESSED_CONSOLE_PATTERNS.some(p => p.test(msg))
  }

  console.warn = (...args: unknown[]) => {
    if (!shouldSuppress(args)) origWarn.apply(console, args)
  }
  console.error = (...args: unknown[]) => {
    if (!shouldSuppress(args)) origError.apply(console, args)
  }
  console.log = (...args: unknown[]) => {
    if (!shouldSuppress(args)) origLog.apply(console, args)
  }

  return () => {
    console.warn = origWarn
    console.error = origError
    console.log = origLog
  }
}

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

  activeStagehand = stagehand

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
  activeStagehand = null
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
      activeServer = server
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
      activeServer = null
    }
  }
}
