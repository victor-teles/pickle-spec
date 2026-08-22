import {
  type BrowserContext,
  browserbase,
  localBrowser,
  type ModelConfig,
  Stagehand,
  type StagehandBrowser,
  type StagehandCreateOptions,
} from '@browserbasehq/stagehand'
import { z } from 'zod'
import { abortError } from './abort'
import { createDirectBrowser } from './direct-browser'
import {
  type BlockedResourceType,
  blockedResourceTypes,
  type ResolvedFidelity,
} from './fidelity'
import type {
  WebAutomation,
  WebAutomationFactory,
  WebClientContext,
  WebIsolationState,
  WebScreenshotCapture,
} from './web-adapter'
import {
  defaultWebActionTimeoutMs,
  defaultWebNavigationTimeoutMs,
  type WebAssertionDraft,
} from './web-execution-cache'
import { defaultModelName } from './web-options'

const defaultDomSettleTimeoutMs = 3_000
const defaultObserveTimeoutMs = 10_000

const verificationSchema = z.object({
  meetsExpectation: z.boolean(),
  actualState: z.string(),
})

const assertionLocatorShape = {
  selector: z.string().min(1),
  nth: z.number().int().nonnegative().optional(),
}
const assertionDraftSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('exists'), ...assertionLocatorShape }),
  z.strictObject({ kind: z.literal('visible'), ...assertionLocatorShape }),
  z.strictObject({ kind: z.literal('hidden'), ...assertionLocatorShape }),
  z.strictObject({
    kind: z.literal('text-equals'),
    ...assertionLocatorShape,
    expected: z.string(),
  }),
  z.strictObject({
    kind: z.literal('text-contains'),
    ...assertionLocatorShape,
    expected: z.string(),
  }),
  z.strictObject({
    kind: z.literal('value-equals'),
    ...assertionLocatorShape,
    expected: z.string(),
  }),
  z.strictObject({
    kind: z.literal('count-equals'),
    ...assertionLocatorShape,
    expected: z.union([z.number().int().nonnegative(), z.string()]),
  }),
  z.strictObject({ kind: z.literal('url-equals'), expected: z.string() }),
])

type StagehandTimeouts = {
  navigationTimeoutMs: number
  observeTimeoutMs: number
  actTimeoutMs: number
}

type FidelityRoute = {
  request: () => { resourceType: () => string }
  abort: () => Promise<void>
  continue: () => Promise<void>
}

type FidelityBrowserPage = {
  addInitScript: (script: string) => Promise<void>
}

type FidelityBrowserContext = {
  route?: (
    pattern: string,
    handler: (route: FidelityRoute) => Promise<void>,
  ) => Promise<void>
  unroute?: (pattern: string) => Promise<void>
  activePage: () => Promise<FidelityBrowserPage | null>
}

function isBlockedResourceType(value: string): value is BlockedResourceType {
  return blockedResourceTypes.includes(value as BlockedResourceType)
}

function withAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  if (signal.aborted) return Promise.reject(abortError())

  return new Promise<T>((resolvePromise, reject) => {
    const onAbort = () => reject(abortError())
    signal.addEventListener('abort', onAbort, { once: true })
    operation.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolvePromise(value)
      },
      (error) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

async function activePage(context: BrowserContext) {
  const page = await context.activePage()
  if (!page) throw new Error('No active browser page')
  return page
}

async function readStagehandIsolation(
  context: BrowserContext,
): Promise<WebIsolationState> {
  const cookieCount = (await context.cookies()).length
  const page = await context.activePage()
  let storageKeyCount = 0
  if (page) {
    storageKeyCount = (await page.evaluate(
      '(() => { try { return localStorage.length } catch { return 0 } })()',
    )) as number
  }
  return { cookieCount, storageKeyCount }
}

async function applyFidelity(
  browserContext: BrowserContext,
  fidelity?: ResolvedFidelity,
): Promise<void> {
  const context = browserContext as FidelityBrowserContext

  if (!fidelity || fidelity.profile === 'default') {
    if (context.unroute) await context.unroute('**/*')
    return
  }

  const blocked = new Set(fidelity.blockResources)
  if (context.unroute) await context.unroute('**/*')
  if (blocked.size > 0 && context.route) {
    await context.route('**/*', (route) => {
      const resourceType = route.request().resourceType()
      if (isBlockedResourceType(resourceType) && blocked.has(resourceType)) {
        return route.abort()
      }
      return route.continue()
    })
  }
  if (fidelity.disableAnimations) {
    const page = await context.activePage()
    if (page) {
      await page.addInitScript(`
        (() => {
          const style = document.createElement('style')
          style.textContent =
            '*, *::before, *::after { animation: none !important; transition: none !important; }'
          document.documentElement.appendChild(style)
        })()
      `)
    }
  }
}

function createStagehandAutomation(
  browser: StagehandBrowser,
  stagehand: Stagehand,
  timeouts: StagehandTimeouts,
): WebAutomation {
  const direct = createDirectBrowser(browser.context, {
    actionTimeoutMs: timeouts.actTimeoutMs,
    navigationTimeoutMs: timeouts.navigationTimeoutMs,
  })
  return {
    navigate: direct.navigate,
    async observe(prompt, signal) {
      const result = await withAbort(
        stagehand.observe(prompt, {
          timeout: timeouts.observeTimeoutMs,
        }),
        signal,
      )
      return result.data.map((action) => ({
        description: action.description,
        handle: action,
      }))
    },
    async act(action, signal) {
      const result = await withAbort(
        stagehand.act(action.handle as Parameters<Stagehand['act']>[0], {
          timeout: timeouts.actTimeoutMs,
        }),
        signal,
      )
      return {
        success: result.data.success,
        message: result.data.success ? undefined : result.data.message,
      }
    },
    async verify(prompt, signal) {
      const result = await withAbort(
        stagehand.extract(
          `Verify the following condition on the current page: "${prompt}". ` +
            'Determine if the page currently meets this expectation.',
          verificationSchema,
        ),
        signal,
      )
      return result.data
    },
    async compileAssertion(prompt, signal) {
      const result = await withAbort(
        stagehand.extract(
          'Compile the following Scenario outcome into exactly one deterministic ' +
            'browser assertion. Use only the requested expectation, never the ' +
            `current page value as the expected value: "${prompt}"`,
          assertionDraftSchema,
        ),
        signal,
      )
      return result.data as WebAssertionDraft
    },
    executeInstruction: direct.execute,
    async screenshot(options: WebScreenshotCapture) {
      const page = await activePage(browser.context)
      return new Uint8Array(
        await page.screenshot({
          type: options.format,
          fullPage: options.fullPage,
        }),
      )
    },
    readIsolationState: () => readStagehandIsolation(browser.context),
    async close() {},
  }
}

export const stagehandFactory: WebAutomationFactory = {
  async launch({ browser: options, signal }) {
    if (signal?.aborted) throw abortError()
    const browser =
      options.environment === 'browserbase'
        ? await browserbase.launch({
            apiKey:
              options.browserbaseApiKey ?? process.env.BROWSERBASE_API_KEY!,
            projectId:
              options.browserbaseProjectId ??
              process.env.BROWSERBASE_PROJECT_ID!,
          })
        : await localBrowser.launch({ headless: options.headless ?? true })

    let stagehand: Stagehand | undefined

    async function ensureStagehand(
      context: WebClientContext,
    ): Promise<Stagehand> {
      if (stagehand) return stagehand
      const selfHeal = context.browser.selfHeal ?? options.selfHeal ?? true
      const domSettleTimeoutMs =
        context.browser.domSettleTimeoutMs ??
        options.domSettleTimeoutMs ??
        defaultDomSettleTimeoutMs
      const cache = context.browser.cache ?? options.cache

      const createOptions: StagehandCreateOptions = {
        browser,
        logging: { level: 'off', format: 'json' },
        selfHeal,
        domSettleTimeoutMs,
      }
      if (context.mode !== 'replay') {
        const modelName =
          context.browser.modelName ?? options.modelName ?? defaultModelName
        const modelApiKey = context.browser.modelApiKey ?? options.modelApiKey
        const model: ModelConfig = {
          modelName: modelName as ModelConfig['modelName'],
        }
        if (modelApiKey !== undefined) model.apiKey = modelApiKey
        createOptions.model = model
      }
      if (cache !== undefined) createOptions.cache = cache

      stagehand = await Stagehand.create(createOptions)
      return stagehand
    }

    return {
      async openContext(context) {
        if (context.signal?.aborted) throw abortError()
        const activeStagehand = await ensureStagehand(context)
        await applyFidelity(browser.context, context.fidelity)
        return createStagehandAutomation(browser, activeStagehand, {
          navigationTimeoutMs:
            context.browser.navigationTimeoutMs ??
            options.navigationTimeoutMs ??
            defaultWebNavigationTimeoutMs,
          observeTimeoutMs:
            context.browser.observeTimeoutMs ??
            options.observeTimeoutMs ??
            defaultObserveTimeoutMs,
          actTimeoutMs:
            context.browser.actTimeoutMs ??
            options.actTimeoutMs ??
            defaultWebActionTimeoutMs,
        })
      },
      async close() {
        try {
          if (stagehand) {
            await stagehand.close()
            stagehand = undefined
          }
        } catch {}
        try {
          await browser.close()
        } catch {}
      },
    }
  },
}
