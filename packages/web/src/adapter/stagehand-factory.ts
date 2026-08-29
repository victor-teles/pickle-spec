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
import { requiredValue } from '../required-value'
import { abortError } from './abort'
import {
  type BlockedResourceType,
  blockedResourceTypes,
  type ResolvedFidelity,
} from './fidelity'
import {
  createStagehandAutomation,
  type StagehandTimeouts,
} from './stagehand-automation'
import type {
  WebAutomationFactory,
  WebBrowserProcess,
  WebClientContext,
} from './web-automation'
import {
  type BrowserOptions,
  defaultModelName,
  resolveBrowserConnection,
} from './web-options'

const defaultDomSettleTimeoutMs = 3_000
const defaultObserveTimeoutMs = 10_000

type StagehandBrowser = Awaited<ReturnType<typeof localBrowser.launch>>
type WebEvidenceCollector = ReturnType<typeof createWebEvidenceCollector>

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

async function launchStagehandBrowser(
  options: BrowserOptions,
): Promise<StagehandBrowser> {
  const connection = resolveBrowserConnection(options)
  if (connection.kind === 'cdp') {
    try {
      return await localBrowser.connect({
        cdpUrl: connection.cdpUrl,
        extensionId: connection.extensionId,
      })
    } catch {
      throw new Error('Could not connect to web.browser.cdpUrl')
    }
  }
  if (connection.kind === 'browserbase') {
    return browserbase.launch({
      apiKey:
        options.browserbaseApiKey ??
        requiredValue(process.env.BROWSERBASE_API_KEY),
      projectId:
        options.browserbaseProjectId ??
        requiredValue(process.env.BROWSERBASE_PROJECT_ID),
    })
  }
  return localBrowser.launch({ headless: options.headless ?? true })
}

async function installEvidenceScript(
  browser: StagehandBrowser,
  evidence: WebEvidenceCollector,
): Promise<boolean> {
  try {
    await browser.context.addInitScript(installWebEvidenceScript)
    return true
  } catch (error) {
    evidence.recordAdapterFailure(
      'Browser evidence initialization failed',
      error,
    )
    return false
  }
}

async function closeQuietly(close: () => Promise<void>): Promise<void> {
  try {
    await close()
  } catch {}
}

function stagehandViewport(context: WebClientContext) {
  if (!context.onLiveViewport) return
  return {
    options: context.browser,
    onViewport: context.onLiveViewport,
    signal: context.signal,
  }
}

async function closeStagehandClient(
  browser: StagehandBrowser,
  stagehand: Stagehand | undefined,
): Promise<void> {
  await Promise.all([
    stagehand ? closeQuietly(() => stagehand.close()) : Promise.resolve(),
    closeQuietly(() => browser.close()),
  ])
}

function stagehandClient(
  browser: StagehandBrowser,
  options: BrowserOptions,
): WebBrowserProcess {
  let stagehand: Stagehand | undefined
  let stagehandCreation: Promise<Stagehand> | undefined
  let closed = false
  let evidenceScriptInstalled = false

  async function acceptCreatedStagehand(
    created: Stagehand,
    signal?: AbortSignal,
  ): Promise<Stagehand> {
    if (!closed && !signal?.aborted) return created
    await created.close().catch(() => {})
    throw abortError()
  }

  async function ensureStagehand(
    context: WebClientContext,
  ): Promise<Stagehand> {
    if (stagehand) return stagehand
    if (closed || context.signal?.aborted) throw abortError()
    const creation =
      stagehandCreation ??
      Stagehand.create(stagehandCreateOptions(browser, context, options))
    stagehandCreation = creation
    try {
      stagehand = await acceptCreatedStagehand(await creation, context.signal)
      return stagehand
    } finally {
      stagehandCreation = undefined
    }
  }

  async function openContext(context: WebClientContext) {
    if (context.signal?.aborted) throw abortError()
    const activeStagehand = await ensureStagehand(context)
    await applyFidelity(browser.context, context.fidelity)
    const evidence = createWebEvidenceCollector()
    if (!evidenceScriptInstalled) {
      evidenceScriptInstalled = await installEvidenceScript(browser, evidence)
    }
    return createStagehandAutomation(
      browser,
      activeStagehand,
      stagehandTimeouts(context, options),
      evidence,
      stagehandViewport(context),
    )
  }

  async function close(): Promise<void> {
    closed = true
    const activeStagehand = stagehand
    stagehand = undefined
    await closeStagehandClient(browser, activeStagehand)
  }

  return { openContext, close }
}

function stagehandTimeouts(
  context: WebClientContext,
  options: BrowserOptions,
): StagehandTimeouts {
  return {
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
  }
}

export const stagehandFactory: WebAutomationFactory = {
  async launch({ browser: options, signal }) {
    if (signal?.aborted) throw abortError()
    return stagehandClient(await launchStagehandBrowser(options), options)
  },
}
