import {
  browserbase,
  localBrowser,
  type ModelConfig,
  Stagehand,
} from '@browserbasehq/stagehand'
import { z } from 'zod'
import { abortError } from './abort'
import type {
  WebAutomation,
  WebAutomationFactory,
  WebClientContext,
  WebIsolationState,
  WebScreenshotCapture,
} from './web-adapter'
import { defaultModelName } from './web-options'

const defaultDomSettleTimeoutMs = 3_000
const defaultNavigationTimeoutMs = 15_000
const defaultObserveTimeoutMs = 10_000
const defaultActTimeoutMs = 15_000

const verificationSchema = z.object({
  meetsExpectation: z.boolean(),
  actualState: z.string(),
})

type StagehandTimeouts = {
  navigationTimeoutMs: number
  observeTimeoutMs: number
  actTimeoutMs: number
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

async function activePage(stagehand: Stagehand) {
  const page = await stagehand.browser.context.activePage()
  if (!page) throw new Error('No active browser page')
  return page
}

async function readStagehandIsolation(
  stagehand: Stagehand,
): Promise<WebIsolationState> {
  const context = stagehand.browser.context
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

function createStagehandAutomation(
  stagehand: Stagehand,
  timeouts: StagehandTimeouts,
): WebAutomation {
  return {
    async navigate(url, signal) {
      const page = await activePage(stagehand)
      await withAbort(
        page
          .goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: timeouts.navigationTimeoutMs,
          })
          .then(() => undefined),
        signal,
      )
    },
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
    async screenshot(options: WebScreenshotCapture) {
      const page = await activePage(stagehand)
      return new Uint8Array(
        await page.screenshot({
          type: options.format,
          fullPage: options.fullPage,
        }),
      )
    },
    readIsolationState: () => readStagehandIsolation(stagehand),
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
      const modelName =
        context.browser.modelName ?? options.modelName ?? defaultModelName
      const modelApiKey = context.browser.modelApiKey ?? options.modelApiKey
      const selfHeal = context.browser.selfHeal ?? options.selfHeal ?? true
      const domSettleTimeoutMs =
        context.browser.domSettleTimeoutMs ??
        options.domSettleTimeoutMs ??
        defaultDomSettleTimeoutMs
      const cache = context.browser.cache ?? options.cache

      stagehand = await Stagehand.create({
        browser,
        model: {
          modelName: modelName as ModelConfig['modelName'],
          apiKey: modelApiKey,
        },
        logging: { level: 'off', format: 'json' },
        selfHeal,
        domSettleTimeoutMs,
        cache,
      })
      return stagehand
    }

    return {
      async openContext(context) {
        if (context.signal?.aborted) throw abortError()
        const activeStagehand = await ensureStagehand(context)
        return createStagehandAutomation(activeStagehand, {
          navigationTimeoutMs:
            context.browser.navigationTimeoutMs ??
            options.navigationTimeoutMs ??
            defaultNavigationTimeoutMs,
          observeTimeoutMs:
            context.browser.observeTimeoutMs ??
            options.observeTimeoutMs ??
            defaultObserveTimeoutMs,
          actTimeoutMs:
            context.browser.actTimeoutMs ??
            options.actTimeoutMs ??
            defaultActTimeoutMs,
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
