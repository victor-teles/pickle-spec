import {
  type BrowserContext,
  browserbase,
  localBrowser,
  type ModelConfig,
  Stagehand,
  type StagehandCreateOptions,
} from '@browserbasehq/stagehand'
import {
  createWebEvidenceCollector,
  installWebEvidenceScript,
} from '../evidence/web-evidence'
import {
  defaultWebActionTimeoutMs,
  defaultWebNavigationTimeoutMs,
} from '../execution-cache/web-execution-cache'
import { abortError } from './abort'
import {
  type BlockedResourceType,
  blockedResourceTypes,
  type ResolvedFidelity,
} from './fidelity'
import { createStagehandAutomation } from './stagehand-automation'
import type { WebAutomationFactory, WebClientContext } from './web-automation'
import { type BrowserOptions, defaultModelName } from './web-options'

const defaultDomSettleTimeoutMs = 3_000
const defaultObserveTimeoutMs = 10_000

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

function stagehandModel(
  context: WebClientContext,
  defaults: BrowserOptions,
): ModelConfig {
  const modelName =
    context.browser.modelName ?? defaults.modelName ?? defaultModelName
  const modelApiKey = context.browser.modelApiKey ?? defaults.modelApiKey
  const model: ModelConfig = {
    modelName: modelName as ModelConfig['modelName'],
  }
  if (modelApiKey !== undefined) model.apiKey = modelApiKey
  return model
}

function stagehandCreateOptions(
  browser: StagehandCreateOptions['browser'],
  context: WebClientContext,
  defaults: BrowserOptions,
): StagehandCreateOptions {
  const selfHeal = context.browser.selfHeal ?? defaults.selfHeal ?? true
  const domSettleTimeoutMs =
    context.browser.domSettleTimeoutMs ??
    defaults.domSettleTimeoutMs ??
    defaultDomSettleTimeoutMs
  const cache = context.browser.cache ?? defaults.cache
  const createOptions: StagehandCreateOptions = {
    browser,
    logging: { level: 'off', format: 'json' },
    selfHeal,
    domSettleTimeoutMs,
  }
  if (context.mode !== 'replay') {
    createOptions.model = stagehandModel(context, defaults)
  }
  if (cache !== undefined) createOptions.cache = cache
  return createOptions
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
    let evidenceScriptInstalled = false

    async function ensureStagehand(
      context: WebClientContext,
    ): Promise<Stagehand> {
      if (stagehand) return stagehand
      stagehand = await Stagehand.create(
        stagehandCreateOptions(browser, context, options),
      )
      return stagehand
    }

    return {
      async openContext(context) {
        if (context.signal?.aborted) throw abortError()
        const activeStagehand = await ensureStagehand(context)
        await applyFidelity(browser.context, context.fidelity)
        const evidence = createWebEvidenceCollector()
        if (!evidenceScriptInstalled) {
          try {
            await browser.context.addInitScript(installWebEvidenceScript)
            evidenceScriptInstalled = true
          } catch (error) {
            evidence.recordAdapterFailure(
              'Browser evidence initialization failed',
              error,
            )
          }
        }
        return createStagehandAutomation(
          browser,
          activeStagehand,
          {
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
          },
          evidence,
        )
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
