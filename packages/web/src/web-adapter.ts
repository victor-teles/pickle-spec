import {
  Stagehand,
  browserbase,
  localBrowser,
  type ModelConfig,
} from '@browserbasehq/stagehand'
import type {
  ExecutionTargetAdapter,
  StepExecution,
  TestArtifact,
} from '@pickle-spec/runner'
import type { ScenarioStep } from '@pickle-spec/spec'
import { mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'

export interface BrowserOptions {
  environment?: 'local' | 'browserbase'
  modelName?: string
  modelApiKey?: string
  headless?: boolean
  browserbaseApiKey?: string
  browserbaseProjectId?: string
  cache?: boolean
  selfHeal?: boolean
  domSettleTimeoutMs?: number
  observeTimeoutMs?: number
  actTimeoutMs?: number
  navigationTimeoutMs?: number
}

export interface ScreenshotOptions {
  mode?: 'off' | 'on-failure' | 'on-step'
  outputDir?: string
  format?: 'png' | 'jpeg'
  fullPage?: boolean
}

export interface WebAdapterOptions {
  baseUrl: string
  browser?: BrowserOptions
  screenshots?: ScreenshotOptions
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function knownFields(value: Record<string, unknown>, fields: readonly string[], parent: string): void {
  for (const field of Object.keys(value)) {
    if (!fields.includes(field)) throw new Error(`${parent}.${field} is not supported`)
  }
}

function optionalString(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== 'string') throw new Error(`${field} must be a string`)
}

function optionalBoolean(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== 'boolean') throw new Error(`${field} must be a boolean`)
}

function optionalPositiveInteger(value: unknown, field: string): void {
  if (value !== undefined && (!Number.isInteger(value) || (value as number) < 1)) {
    throw new Error(`${field} must be an integer greater than or equal to 1`)
  }
}

export function validateWebAdapterOptions(value: unknown): WebAdapterOptions {
  const web = record(value, 'web')
  knownFields(web, ['baseUrl', 'browser', 'screenshots'], 'web')
  if (typeof web.baseUrl !== 'string' || !web.baseUrl.trim()) {
    throw new Error('web.baseUrl must not be empty')
  }
  try {
    new URL(web.baseUrl)
  } catch {
    throw new Error('web.baseUrl must be a valid URL')
  }

  if (web.browser !== undefined) {
    const browser = record(web.browser, 'web.browser')
    knownFields(browser, [
      'environment', 'modelName', 'modelApiKey', 'headless', 'browserbaseApiKey',
      'browserbaseProjectId', 'cache', 'selfHeal', 'domSettleTimeoutMs', 'observeTimeoutMs',
      'actTimeoutMs', 'navigationTimeoutMs',
    ], 'web.browser')
    if (browser.environment !== undefined && browser.environment !== 'local' && browser.environment !== 'browserbase') {
      throw new Error('web.browser.environment must be local or browserbase')
    }
    optionalString(browser.modelName, 'web.browser.modelName')
    optionalString(browser.modelApiKey, 'web.browser.modelApiKey')
    optionalString(browser.browserbaseApiKey, 'web.browser.browserbaseApiKey')
    optionalString(browser.browserbaseProjectId, 'web.browser.browserbaseProjectId')
    optionalBoolean(browser.headless, 'web.browser.headless')
    optionalBoolean(browser.cache, 'web.browser.cache')
    optionalBoolean(browser.selfHeal, 'web.browser.selfHeal')
    optionalPositiveInteger(browser.domSettleTimeoutMs, 'web.browser.domSettleTimeoutMs')
    optionalPositiveInteger(browser.observeTimeoutMs, 'web.browser.observeTimeoutMs')
    optionalPositiveInteger(browser.actTimeoutMs, 'web.browser.actTimeoutMs')
    optionalPositiveInteger(browser.navigationTimeoutMs, 'web.browser.navigationTimeoutMs')
  }

  if (web.screenshots !== undefined) {
    const screenshots = record(web.screenshots, 'web.screenshots')
    knownFields(screenshots, ['mode', 'outputDir', 'format', 'fullPage'], 'web.screenshots')
    if (screenshots.mode !== undefined && !['off', 'on-failure', 'on-step'].includes(screenshots.mode as string)) {
      throw new Error('web.screenshots.mode must be off, on-failure, or on-step')
    }
    optionalString(screenshots.outputDir, 'web.screenshots.outputDir')
    if (screenshots.format !== undefined && screenshots.format !== 'png' && screenshots.format !== 'jpeg') {
      throw new Error('web.screenshots.format must be png or jpeg')
    }
    optionalBoolean(screenshots.fullPage, 'web.screenshots.fullPage')
  }

  return web as unknown as WebAdapterOptions
}

export interface WebObservedAction {
  description: string
  handle: unknown
}

export interface WebAutomation {
  navigate(url: string, signal?: AbortSignal): Promise<void>
  observe(prompt: string, signal?: AbortSignal): Promise<WebObservedAction[]>
  act(action: WebObservedAction, signal?: AbortSignal): Promise<{ success: boolean; message?: string }>
  verify(prompt: string, signal?: AbortSignal): Promise<{
    meetsExpectation: boolean
    actualState: string
  }>
  screenshot(options: { format: 'png' | 'jpeg'; fullPage: boolean }): Promise<Uint8Array>
  close(): Promise<void>
}

export interface WebAutomationFactory {
  open(input: { browser: BrowserOptions; signal?: AbortSignal }): Promise<WebAutomation>
}

const verificationSchema = z.object({
  meetsExpectation: z.boolean(),
  actualState: z.string(),
})

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

function abortError(): DOMException {
  return new DOMException('Scenario cancelled', 'AbortError')
}

function withAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(abortError())

  return new Promise<T>((resolvePromise, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      value => {
        signal.removeEventListener('abort', onAbort)
        resolvePromise(value)
      },
      error => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

async function activePage(stagehand: Stagehand) {
  const page = await stagehand.browser.context.activePage()
  if (!page) throw new Error('No active browser page')
  return page
}

const stagehandFactory: WebAutomationFactory = {
  async open({ browser: options, signal }) {
    if (signal?.aborted) throw abortError()
    const browser = options.environment === 'browserbase'
      ? await browserbase.launch({
          apiKey: options.browserbaseApiKey ?? process.env.BROWSERBASE_API_KEY!,
          projectId: options.browserbaseProjectId ?? process.env.BROWSERBASE_PROJECT_ID!,
        })
      : await localBrowser.launch({ headless: options.headless ?? true })
    const model: ModelConfig = {
      modelName: (options.modelName ?? 'anthropic/claude-sonnet-4-6') as ModelConfig['modelName'],
      ...(options.modelApiKey ? { apiKey: options.modelApiKey } : {}),
    }
    const stagehand = await Stagehand.create({
      browser,
      model,
      logging: { level: 'off', format: 'json' },
      selfHeal: options.selfHeal ?? true,
      domSettleTimeoutMs: options.domSettleTimeoutMs ?? 3_000,
      ...(options.cache !== undefined ? { cache: options.cache } : {}),
    })

    return {
      async navigate(url, operationSignal) {
        const page = await activePage(stagehand)
        await withAbort(page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: options.navigationTimeoutMs ?? 15_000,
        }).then(() => undefined), operationSignal)
      },
      async observe(prompt, operationSignal) {
        const result = await withAbort(
          stagehand.observe(prompt, { timeout: options.observeTimeoutMs ?? 10_000 }),
          operationSignal,
        )
        return result.data.map(action => ({
          description: action.description,
          handle: action,
        }))
      },
      async act(action, operationSignal) {
        const result = await withAbort(
          stagehand.act(action.handle as Parameters<Stagehand['act']>[0], {
            timeout: options.actTimeoutMs ?? 15_000,
          }),
          operationSignal,
        )
        return {
          success: result.data.success,
          ...(result.data.success ? {} : { message: result.data.message }),
        }
      },
      async verify(prompt, operationSignal) {
        const result = await withAbort(
          stagehand.extract(
            `Verify the following condition on the current page: "${prompt}". ` +
              'Determine if the page currently meets this expectation.',
            verificationSchema,
          ),
          operationSignal,
        )
        return result.data
      },
      async screenshot(screenshotOptions) {
        const page = await activePage(stagehand)
        return new Uint8Array(await page.screenshot({
          type: screenshotOptions.format,
          fullPage: screenshotOptions.fullPage,
        }))
      },
      async close() {
        try { await stagehand.close() } catch {}
        try { await stagehand.browser.close() } catch {}
      },
    }
  },
}

function promptFor(step: ScenarioStep): string {
  let prompt = step.text
  if (step.argument?.dataTable) {
    prompt += '\n\nWith the following data:\n'
    prompt += step.argument.dataTable.map(row => row.join(' | ')).join('\n')
  }
  if (step.argument?.docString) prompt += `\n\n${step.argument.docString}`
  return prompt
}

function safeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80)
}

function navigationUrl(baseUrl: string, target: string): string {
  if (/^https?:\/\//i.test(target)) return target
  if (target.startsWith('/')) return new URL(target, baseUrl).toString()
  return baseUrl
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createWebAdapter(
  options: WebAdapterOptions,
  factory: WebAutomationFactory = stagehandFactory,
): ExecutionTargetAdapter {
  const validatedOptions = validateWebAdapterOptions(options)
  return {
    capabilities: ['web', 'screenshots'],
    async openSession(input) {
      const automation = await factory.open({
        browser: validatedOptions.browser ?? {},
        signal: input.signal,
      })
      let closed = false
      let navigated = false
      let stepIndex = 0

      const close = async () => {
        if (closed) return
        closed = true
        input.signal?.removeEventListener('abort', onAbort)
        await automation.close()
      }
      const onAbort = () => { void close() }
      input.signal?.addEventListener('abort', onAbort, { once: true })

      async function screenshot(
        step: ScenarioStep,
        state: StepExecution['state'],
      ): Promise<TestArtifact | undefined> {
        const screenshotOptions = validatedOptions.screenshots
        const mode = screenshotOptions?.mode ?? 'off'
        if (mode === 'off') return undefined
        if (mode === 'on-failure' && state !== 'failed' && state !== 'infrastructure-error') {
          return undefined
        }
        if (state === 'cancelled' || state === 'skipped') return undefined

        try {
          const format = screenshotOptions?.format ?? 'png'
          const directory = resolve(
            screenshotOptions?.outputDir ?? './.pickle/artifacts',
            safeName(input.specification.name),
            safeName(input.scenario.name),
          )
          await mkdir(directory, { recursive: true })
          const path = join(
            directory,
            `step-${String(stepIndex).padStart(2, '0')}-${state}-${safeName(step.text).slice(0, 40)}.${format}`,
          )
          await Bun.write(path, await automation.screenshot({
            format,
            fullPage: screenshotOptions?.fullPage ?? false,
          }))
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
        await automation.navigate(validatedOptions.baseUrl, signal)
        navigated = true
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
              const url = navigationUrl(validatedOptions.baseUrl, navigation[1]!.trim())
              await automation.navigate(url, operationSignal)
              navigated = true
              return finish(step, {
                state: 'passed',
                resolvedActions: [{ description: `Navigate to ${url}` }],
              })
            }

            await ensureNavigation(operationSignal)
            if (step.type === 'outcome') {
              const verification = await automation.verify(prompt, operationSignal)
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

            let actions = await automation.observe(prompt, operationSignal)
            if (actions.length === 0) actions = await automation.observe(prompt, operationSignal)
            if (actions.length === 0) {
              return finish(step, {
                state: 'infrastructure-error',
                resolvedActions: [],
                message: 'Observe returned no actions',
              })
            }

            const resolvedActions = []
            for (const action of actions) {
              const result = await automation.act(action, operationSignal)
              resolvedActions.push({ description: action.description })
              if (!result.success) {
                return finish(step, {
                  state: 'infrastructure-error',
                  resolvedActions,
                  message: result.message ?? 'Web action failed',
                })
              }
            }
            return finish(step, { state: 'passed', resolvedActions })
          } catch (error) {
            if (operationSignal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
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
