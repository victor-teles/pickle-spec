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
import type { ParsedFeature } from './parser'
import { startServer, stopServer, type ManagedServer } from './server'
import { reportStepResult, reportScenarioStart, reportFeatureStart } from './reporter'

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

/**
 * Execute a single step against Stagehand.
 */
async function executeStep(
  stagehand: Stagehand,
  step: PickleStep,
  effectiveType: EffectiveStepType,
  baseUrl: string,
): Promise<StepResult> {
  const startTime = Date.now()
  const prompt = buildStepPrompt(step)

  try {
    if (effectiveType === 'Context' || effectiveType === 'Action') {
      const navMatch = prompt.match(NAVIGATION_PATTERN)

      if (navMatch && effectiveType === 'Context') {
        const page = stagehand.context.pages()[0]!
        const target = navMatch[1]!.trim()
        const url = target.startsWith('/') ? `${baseUrl}${target}` : target

        if (url.startsWith('http') || url.startsWith('/')) {
          await page.goto(url, { waitUntil: 'domcontentloaded' })
        } else {
          // Target is a natural-language page name (e.g. "main page") — navigate to base URL
          await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
        }
      } else {
        const agent = stagehand.agent()
        const result = await agent.execute({
          instruction: prompt,
          maxSteps: 10,
        })
        if (!result.success) {
          return {
            step,
            status: 'failed',
            durationMs: Date.now() - startTime,
            error: result.message,
          }
        }
      }

      return {
        step,
        status: 'passed',
        durationMs: Date.now() - startTime,
      }
    } else {
      const agent = stagehand.agent()
      const result = await agent.execute({
        instruction:
          `Verify the following condition on the current page: "${prompt}". ` +
          `Determine if the page currently meets this expectation. ` +
          `You may scroll or observe the page to gather enough information.`,
        maxSteps: 5,
        output: VerificationSchema,
      })

      const verification = result.output as z.infer<typeof VerificationSchema> | undefined

      if (!verification || !verification.meetsExpectation) {
        return {
          step,
          status: 'failed',
          durationMs: Date.now() - startTime,
          error: `Expected: "${prompt}" | Actual: ${verification?.actualState ?? result.message}`,
        }
      }

      return {
        step,
        status: 'passed',
        durationMs: Date.now() - startTime,
      }
    }
  } catch (err) {
    return {
      step,
      status: 'failed',
      durationMs: Date.now() - startTime,
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

/**
 * Execute a single scenario (Pickle).
 */
async function executeScenario(
  pickle: Pickle,
  config: PickleSpecConfig,
  stepInfoMap: Map<string, { keyword: string; type: EffectiveStepType }>,
  verbose: boolean,
): Promise<ScenarioResult> {
  const startTime = Date.now()
  const stagehandConfig = config.browser!
  const baseUrl = config.server?.url ?? 'http://localhost:3000'

  const stagehand = new Stagehand({
    env: stagehandConfig.env ?? 'LOCAL',
    model: stagehandConfig.modelClientOptions
      ? { modelName: stagehandConfig.modelName ?? 'claude-4-6-sonnet-latest', ...stagehandConfig.modelClientOptions }
      : (stagehandConfig.modelName ?? 'claude-4-6-sonnet-latest'),
    localBrowserLaunchOptions: {
      headless: stagehandConfig.headless ?? true,
    },
    verbose: verbose ? 2 : 0,
    apiKey: stagehandConfig.apiKey,
    projectId: stagehandConfig.projectId,
    domSettleTimeout: stagehandConfig.domSettleTimeout ?? 3000,
    actTimeoutMs: stagehandConfig.actTimeoutMs,
    experimental: true
  })

  await stagehand.init()

  const page = stagehand.context.pages()[0]!
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })

  const stepResults: StepResult[] = []
  let scenarioFailed = false

  for (const step of pickle.steps) {
    if (scenarioFailed) {
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

    const result = await executeStep(stagehand, step, effectiveType, baseUrl)
    stepResults.push(result)
    reportStepResult(keyword, step.text, result)

    if (result.status === 'failed') {
      scenarioFailed = true
    }
  }

  await stagehand.close()

  return {
    pickle,
    status: scenarioFailed ? 'failed' : 'passed',
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
  let server: ManagedServer | undefined

  try {
    if (config.server?.command) {
      server = await startServer(config.server)
    }

    const featureResults: FeatureResult[] = []

    for (const feature of features) {
      reportFeatureStart(feature.featureName, feature.filePath)
      const featureStart = Date.now()

      const stepInfoMap = buildStepInfoMap(feature.document)
      const scenarioResults: ScenarioResult[] = []

      for (const pickle of feature.pickles) {
        reportScenarioStart(pickle.name)
        const result = await executeScenario(pickle, config, stepInfoMap, options.verbose)
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

    return {
      features: featureResults,
      totalDurationMs: Date.now() - overallStart,
      passed,
      failed,
      skipped,
    }
  } finally {
    if (server) {
      stopServer(server)
    }
  }
}
