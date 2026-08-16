import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import {
  type ExecutionTargetAdapter,
  isEvidenceState,
  type ResolvedAction,
  type StepExecution,
  slug,
  type TestArtifact,
} from '@pickle-spec/runner'
import type { ScenarioStep } from '@pickle-spec/spec'
import { abortError } from './abort'
import { stagehandFactory } from './stagehand-factory'
import {
  type BrowserOptions,
  defaultModelName,
  type ScreenshotOptions,
  type WebAdapterOptions,
} from './web-options'
import { WebProcessPool } from './web-pool'

export type {
  BrowserOptions,
  ScreenshotOptions,
  WebAdapterOptions,
} from './web-options'
export {
  screenshotModes,
  validateWebAdapterOptions,
  webAdapterOptionsSchema,
} from './web-options'

export interface WebObservedAction {
  description: string
  handle: unknown
}

export interface WebIsolationState {
  cookieCount: number
  storageKeyCount: number
}

export interface WebActResult {
  success: boolean
  message?: string
}

export interface WebVerificationResult {
  meetsExpectation: boolean
  actualState: string
}

export interface WebScreenshotCapture {
  format: 'png' | 'jpeg'
  fullPage: boolean
}

export interface WebClientContext {
  browser: BrowserOptions
  signal?: AbortSignal
}

export interface WebAutomation {
  navigate(url: string, signal?: AbortSignal): Promise<void>
  observe(prompt: string, signal?: AbortSignal): Promise<WebObservedAction[]>
  act(action: WebObservedAction, signal?: AbortSignal): Promise<WebActResult>
  verify(prompt: string, signal?: AbortSignal): Promise<WebVerificationResult>
  screenshot(options: WebScreenshotCapture): Promise<Uint8Array>
  readIsolationState(): Promise<WebIsolationState>
  close(): Promise<void>
}

export interface WebBrowserProcess {
  openContext(input: WebClientContext): Promise<WebAutomation>
  close(): Promise<void>
}

export interface WebAutomationFactory {
  launch(input: WebClientContext): Promise<WebBrowserProcess>
}

const navigationPattern = new RegExp(
  '(?:' +
    'I (?:am on|navigate to|visit|go to|open)' +
    '|(?:eu )?(?:navego para|visito|abro|estou em)' +
    '|(?:yo )?(?:navego a|visito|abro|estoy en)' +
    '|(?:je )?(?:navigue vers|visite|ouvre|suis sur)' +
    ')' +
    '\\s+(?:(?:the|a|o|la|le|el|à)\\s+)?' +
    '["\']?(.+?)["\']?\\s*$',
  'i',
)

const providerApiKeyEnvNamesByProvider: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  groq: ['GROQ_API_KEY'],
  cerebras: ['CEREBRAS_API_KEY'],
}

type BrowserLaunchConfig = {
  browser: BrowserOptions | undefined
  requireProviderApiKey: boolean
}

function promptFor(step: ScenarioStep): string {
  let prompt = step.text
  if (step.argument?.dataTable) {
    prompt += '\n\nWith the following data:\n'
    prompt += step.argument.dataTable.map((row) => row.join(' | ')).join('\n')
  }
  if (step.argument?.docString) prompt += `\n\n${step.argument.docString}`
  return prompt
}

function screenshotName(value: string): string {
  return slug(value).slice(0, 80)
}

function navigationUrl(baseUrl: string, target: string): string {
  if (/^https?:\/\//i.test(target)) return target
  if (target.startsWith('/')) return new URL(target, baseUrl).toString()
  return baseUrl
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function replayPayload(handle: unknown): Record<string, unknown> | undefined {
  if (!handle || typeof handle !== 'object') return undefined
  try {
    return JSON.parse(JSON.stringify(handle)) as Record<string, unknown>
  } catch {
    return undefined
  }
}

function plannedAction(action: ResolvedAction): WebObservedAction {
  return {
    description: action.description,
    handle: action.replay ?? {},
  }
}

function providerApiKeyEnvNames(modelName: string | undefined): string[] {
  const provider = (modelName ?? defaultModelName).split('/')[0]!
  return providerApiKeyEnvNamesByProvider[provider] ?? []
}

function resolveModelApiKey(
  browser: BrowserOptions | undefined,
): string | undefined {
  const configured = browser?.modelApiKey?.trim()
  if (configured) return configured
  for (const name of providerApiKeyEnvNames(browser?.modelName)) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
}

function resolveBrowserLaunchOptions({
  browser,
  requireProviderApiKey,
}: BrowserLaunchConfig): BrowserOptions {
  const modelApiKey = resolveModelApiKey(browser)
  const next = {
    ...browser,
    modelApiKey,
  }
  if (
    requireProviderApiKey &&
    next.environment !== 'browserbase' &&
    !next.modelApiKey
  ) {
    const envNames = providerApiKeyEnvNames(next.modelName)
    throw new Error(
      'Model inference requires a provider API key or a Browserbase session. ' +
        `Set ${envNames.join(', ')}, or web.browser.modelApiKey.`,
    )
  }
  return next
}

function shouldCaptureScreenshot(
  mode: NonNullable<ScreenshotOptions['mode']>,
  state: StepExecution['state'],
): boolean {
  if (mode === 'off') return false
  if (state === 'cancelled' || state === 'skipped') return false
  if (mode === 'on-failure') return isEvidenceState(state)
  return true
}

export function createWebAdapter(
  options: WebAdapterOptions,
  factory?: WebAutomationFactory,
): ExecutionTargetAdapter {
  const automationFactory = factory ?? stagehandFactory
  const requireProviderApiKey = factory === undefined
  const pool = new WebProcessPool({
    factory: automationFactory,
    idleTimeoutMs: options.browser?.idleTimeoutMs,
  })

  return {
    capabilities: ['web', 'screenshots'],
    planFormatVersion: 'web.1',
    async dispose() {
      await pool.dispose()
    },
    async openSession(input) {
      let executionMode = input.mode ?? 'adaptive'
      const browserOptions = resolveBrowserLaunchOptions({
        browser: {
          ...options.browser,
          selfHeal:
            executionMode === 'replay'
              ? false
              : (options.browser?.selfHeal ?? true),
        },
        requireProviderApiKey,
      })
      const logicalSession = await pool.openLogicalSession(
        browserOptions,
        input.signal,
      )
      const automation = logicalSession.automation
      let closePromise: Promise<void> | undefined
      let navigated = false
      let stepIndex = 0

      const close = async () => {
        if (closePromise) return closePromise
        closePromise = (async () => {
          input.signal?.removeEventListener('abort', onAbort)
          await automation.close()
          await logicalSession.release()
        })()
        return closePromise
      }
      const onAbort = () => {
        void close()
      }
      input.signal?.addEventListener('abort', onAbort, { once: true })

      async function screenshot(
        step: ScenarioStep,
        state: StepExecution['state'],
      ): Promise<TestArtifact | undefined> {
        const screenshotOptions = options.screenshots
        const mode = screenshotOptions?.mode ?? 'off'
        if (!shouldCaptureScreenshot(mode, state)) return undefined

        try {
          const format = screenshotOptions?.format ?? 'png'
          const directory = resolve(
            screenshotOptions?.outputDir ?? './.pickle/artifacts',
            screenshotName(input.specification.name),
            screenshotName(input.scenario.name),
          )
          await mkdir(directory, { recursive: true })
          const path = join(
            directory,
            `step-${String(stepIndex).padStart(2, '0')}-${state}-${screenshotName(step.text).slice(0, 40)}.${format}`,
          )
          await Bun.write(
            path,
            await automation.screenshot({
              format,
              fullPage: screenshotOptions?.fullPage ?? false,
            }),
          )
          return {
            kind: 'screenshot',
            path,
            mediaType: `image/${format}`,
          }
        } catch {
          return undefined
        }
      }

      async function finish(
        step: ScenarioStep,
        result: StepExecution,
      ): Promise<StepExecution> {
        const artifact = await screenshot(step, result.state)
        return artifact ? { ...result, artifacts: [artifact] } : result
      }

      async function ensureNavigation(signal?: AbortSignal): Promise<void> {
        if (navigated) return
        await automation.navigate(options.baseUrl, signal)
        navigated = true
      }

      async function resolveByObservation(
        prompt: string,
        signal?: AbortSignal,
      ): Promise<StepExecution> {
        let actions = await automation.observe(prompt, signal)
        if (actions.length === 0)
          actions = await automation.observe(prompt, signal)
        if (actions.length === 0) {
          return {
            state: 'failed',
            resolvedActions: [],
            message: 'Observe returned no actions',
          }
        }

        const resolvedActions: ResolvedAction[] = []
        for (const action of actions) {
          const result = await automation.act(action, signal)
          resolvedActions.push({
            description: action.description,
            replay: replayPayload(action.handle),
          })
          if (!result.success) {
            return {
              state: 'failed',
              resolvedActions,
              message: result.message ?? 'Web action failed',
            }
          }
        }
        return { state: 'passed', resolvedActions }
      }

      async function adapt(
        prompt: string,
        signal?: AbortSignal,
      ): Promise<StepExecution> {
        const adapted = await resolveByObservation(prompt, signal)
        if (adapted.state !== 'passed') return adapted
        executionMode = 'adaptive'
        return { ...adapted, state: 'passed-with-adaptation' }
      }

      async function replayOrAdapt(
        prompt: string,
        planned: readonly ResolvedAction[],
        signal?: AbortSignal,
      ): Promise<StepExecution> {
        if (planned.length === 0) return adapt(prompt, signal)
        const resolvedActions: ResolvedAction[] = []
        for (const action of planned) {
          const result = await automation.act(plannedAction(action), signal)
          resolvedActions.push(action)
          if (!result.success) return adapt(prompt, signal)
        }
        return { state: 'passed', resolvedActions }
      }

      return {
        async executeStep(step, signal) {
          stepIndex++
          const operationSignal = signal ?? input.signal
          if (operationSignal?.aborted) throw abortError()
          const prompt = promptFor(step)

          try {
            const navigation = prompt.match(navigationPattern)
            if (navigation) {
              const url = navigationUrl(options.baseUrl, navigation[1]!.trim())
              await automation.navigate(url, operationSignal)
              navigated = true
              return finish(step, {
                state: 'passed',
                resolvedActions: [{ description: `Navigate to ${url}` }],
              })
            }

            await ensureNavigation(operationSignal)
            if (step.type === 'outcome') {
              const verification = await automation.verify(
                prompt,
                operationSignal,
              )
              if (!verification.meetsExpectation) {
                return finish(step, {
                  state: 'failed',
                  resolvedActions: [{ description: `Verify: ${prompt}` }],
                  message: `Expected: "${prompt}" | Actual: ${verification.actualState}`,
                })
              }
              return finish(step, {
                state: 'passed',
                resolvedActions: [{ description: `Verify: ${prompt}` }],
              })
            }

            if (executionMode === 'replay') {
              return finish(
                step,
                await replayOrAdapt(
                  prompt,
                  input.plan?.steps[stepIndex - 1]?.resolvedActions ?? [],
                  operationSignal,
                ),
              )
            }

            return finish(
              step,
              await resolveByObservation(prompt, operationSignal),
            )
          } catch (error) {
            if (
              operationSignal?.aborted ||
              (error instanceof Error && error.name === 'AbortError')
            ) {
              throw abortError()
            }
            return finish(step, {
              state: 'infrastructure-error',
              resolvedActions: [],
              message: errorMessage(error),
            })
          }
        },
        close,
      }
    },
  }
}
