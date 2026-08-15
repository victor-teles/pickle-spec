import {
  Stagehand,
  localBrowser,
  browserbase,
  type ModelConfig,
  type Page,
} from '@browserbasehq/stagehand'
import type { BrowserConfig } from './types'
import type { ReporterContext, StagehandLogLine } from './reporter'
import { navigateAndSimplify } from './dom-optimization'

export async function getActivePage(stagehand: Stagehand): Promise<Page> {
  const page = await stagehand.browser.context.activePage()
  if (!page) {
    throw new Error('No active browser page')
  }
  return page
}

function resolveCache(browserConfig: BrowserConfig): boolean | undefined {
  if (browserConfig.cache !== undefined) return browserConfig.cache
  if (browserConfig.cacheDir === false) return false
  if (typeof browserConfig.cacheDir === 'string') return true
  return undefined
}

function resolveModel(browserConfig: BrowserConfig): ModelConfig {
  const modelName = (browserConfig.modelName ?? 'anthropic/claude-sonnet-4-6') as ModelConfig['modelName']
  const model: ModelConfig = { modelName }
  if (browserConfig.modelClientOptions?.apiKey) {
    model.apiKey = browserConfig.modelClientOptions.apiKey
  }
  return model
}

function resolveLogging(
  browserConfig: BrowserConfig,
  verbose: boolean,
  reporter: ReporterContext,
) {
  const levelFromBrowser =
    browserConfig.verbose === 2 ? 'debug'
      : browserConfig.verbose === 1 ? 'info'
        : browserConfig.verbose === 0 ? 'off'
          : undefined

  const level = verbose ? 'debug' : (levelFromBrowser ?? 'off')

  return {
    level: level as 'off' | 'error' | 'warn' | 'info' | 'debug',
    format: 'json' as const,
    onLog: verbose || (browserConfig.verbose !== undefined && browserConfig.verbose > 0)
      ? (line: StagehandLogLine) => reporter.verboseLog(line)
      : undefined,
  }
}

export async function createStagehand(
  browserConfig: BrowserConfig,
  verbose: boolean,
  reporter: ReporterContext,
): Promise<Stagehand> {
  const env = browserConfig.env ?? 'LOCAL'

  if (verbose) reporter.verbose('Launching browser...')

  const browser = env === 'BROWSERBASE'
    ? await browserbase.launch({
      apiKey: browserConfig.apiKey ?? process.env.BROWSERBASE_API_KEY!,
      projectId: browserConfig.projectId ?? process.env.BROWSERBASE_PROJECT_ID!,
    })
    : await localBrowser.launch({
      headless: browserConfig.headless ?? true,
    })

  const cache = resolveCache(browserConfig)

  const stagehand = await Stagehand.create({
    browser,
    model: resolveModel(browserConfig),
    logging: resolveLogging(browserConfig, verbose, reporter),
    selfHeal: browserConfig.selfHeal ?? true,
    domSettleTimeoutMs: browserConfig.domSettleTimeout ?? 3000,
    ...(cache !== undefined ? { cache } : {}),
  })

  if (verbose) reporter.verbose('Browser ready')
  return stagehand
}

export async function resetBrowserState(stagehand: Stagehand, baseUrl: string, navTimeout: number, domSimplification = true): Promise<void> {
  const page = await getActivePage(stagehand)
  await stagehand.browser.context.clearCookies()
  await page.evaluate(() => {
    try { localStorage.clear() } catch {}
    try { sessionStorage.clear() } catch {}
  })
  await navigateAndSimplify(page, baseUrl, { waitUntil: 'domcontentloaded', timeout: navTimeout }, domSimplification)
}

export async function createStagehandAndNavigate(
  browserConfig: BrowserConfig,
  baseUrl: string,
  navTimeout: number,
  verbose: boolean,
  reporter: ReporterContext,
): Promise<Stagehand> {
  const stagehand = await createStagehand(browserConfig, verbose, reporter)
  const page = await getActivePage(stagehand)
  if (verbose) reporter.verbose(`Navigating to ${baseUrl}`)
  await navigateAndSimplify(page, baseUrl, { waitUntil: 'domcontentloaded', timeout: navTimeout }, browserConfig.domSimplification ?? true)
  return stagehand
}

export async function closeStagehand(stagehand: Stagehand): Promise<void> {
  try { await stagehand.close() } catch {}
  try { await stagehand.browser.close() } catch {}
}
