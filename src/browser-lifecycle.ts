import { Stagehand } from '@browserbasehq/stagehand'
import type { BrowserConfig } from './types'
import type { ReporterContext } from './reporter'
import { withCancellation } from './cancellation'
import { navigateAndSimplify } from './dom-optimization'

export async function createStagehand(
  browserConfig: BrowserConfig,
  verbose: boolean,
  reporter: ReporterContext,
): Promise<Stagehand> {
  const stagehand = new Stagehand({
    env: browserConfig.env ?? 'LOCAL',
    model: browserConfig.modelClientOptions
      ? { modelName: browserConfig.modelName ?? 'claude-4-6-sonnet-latest', ...browserConfig.modelClientOptions }
      : (browserConfig.modelName ?? 'claude-4-6-sonnet-latest'),
    localBrowserLaunchOptions: {
      headless: browserConfig.headless ?? true,
    },
    verbose: browserConfig.verbose ? 2 : (verbose ? 2 : 0),
    disablePino: browserConfig.verbose ? false : (verbose ? false : true),
    logger: verbose ? (line) => reporter.verboseLog(line) : () => {},
    apiKey: browserConfig.apiKey,
    projectId: browserConfig.projectId,
    domSettleTimeout: browserConfig.domSettleTimeout ?? 1000,
    actTimeoutMs: browserConfig.actTimeoutMs ?? 15000,
    cacheDir: browserConfig.cacheDir === false ? undefined : (browserConfig.cacheDir ?? '.pickle/cache'),
    selfHeal: browserConfig.selfHeal ?? true,
    experimental: true,
  })

  if (verbose) reporter.verbose('Launching browser...')
  await withCancellation(stagehand.init())
  if (verbose) reporter.verbose('Browser ready')

  return stagehand
}

export async function resetBrowserState(stagehand: Stagehand, baseUrl: string, navTimeout: number, domSimplification = true): Promise<void> {
  const page = stagehand.context.pages()[0]!
  await stagehand.context.clearCookies()
  await page.evaluate(() => {
    try { localStorage.clear() } catch {}
    try { sessionStorage.clear() } catch {}
  })
  await navigateAndSimplify(page, baseUrl, { waitUntil: 'domcontentloaded', timeoutMs: navTimeout }, domSimplification)
}

export async function createStagehandAndNavigate(
  browserConfig: BrowserConfig,
  baseUrl: string,
  navTimeout: number,
  verbose: boolean,
  reporter: ReporterContext,
): Promise<Stagehand> {
  const stagehand = await createStagehand(browserConfig, verbose, reporter)
  const page = stagehand.context.pages()[0]!
  if (verbose) reporter.verbose(`Navigating to ${baseUrl}`)
  await navigateAndSimplify(page, baseUrl, { waitUntil: 'domcontentloaded', timeoutMs: navTimeout }, browserConfig.domSimplification ?? true)
  return stagehand
}

export async function closeStagehand(stagehand: Stagehand): Promise<void> {
  try { await stagehand.close() } catch {}
}
