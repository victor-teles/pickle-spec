import type {
  BrowserContext,
  Stagehand,
  StagehandBrowser,
} from '@browserbasehq/stagehand'
import { z } from 'zod'
import {
  type createWebEvidenceCollector,
  instrumentWebEvidencePages,
} from '../evidence/web-evidence'
import { webAssertionDraftSchema } from '../execution-cache/web-execution-cache'
import { withAbort } from './abort'
import { createDirectBrowser } from './direct-browser'
import type {
  WebAutomation,
  WebIsolationState,
  WebScreenshotCapture,
} from './web-automation'

const verificationSchema = z.object({
  meetsExpectation: z.boolean(),
  actualState: z.string(),
})

export type StagehandTimeouts = {
  navigationTimeoutMs: number
  observeTimeoutMs: number
  actTimeoutMs: number
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
  const storageKeyCount = page
    ? ((await page.evaluate(
        '(() => { try { return localStorage.length } catch { return 0 } })()',
      )) as number)
    : 0
  return { cookieCount, storageKeyCount }
}

export async function createStagehandAutomation(
  browser: StagehandBrowser,
  stagehand: Stagehand,
  timeouts: StagehandTimeouts,
  evidence: ReturnType<typeof createWebEvidenceCollector>,
): Promise<WebAutomation> {
  const direct = createDirectBrowser(browser.context, {
    actionTimeoutMs: timeouts.actTimeoutMs,
    navigationTimeoutMs: timeouts.navigationTimeoutMs,
  })
  const instrumentPages = async () => {
    const pages = await browser.context.pages()
    return instrumentWebEvidencePages(pages, evidence)
  }
  await instrumentPages()

  return {
    async navigate(url, signal) {
      await instrumentPages()
      await direct.navigate(url, signal)
      await instrumentPages()
    },
    async observe(prompt, signal) {
      await instrumentPages()
      const result = await withAbort(
        stagehand.observe(prompt, { timeout: timeouts.observeTimeoutMs }),
        signal,
      )
      return result.data.map((action) => ({
        description: action.description,
        handle: action,
      }))
    },
    async act(action, signal) {
      await instrumentPages()
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
      await instrumentPages()
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
      await instrumentPages()
      const result = await withAbort(
        stagehand.extract(
          'Compile the following Scenario outcome into exactly one deterministic ' +
            'browser assertion. Use only the requested expectation, never the ' +
            `current page value as the expected value: "${prompt}"`,
          webAssertionDraftSchema,
        ),
        signal,
      )
      return result.data
    },
    async executeInstruction(instruction, bindings, signal) {
      await instrumentPages()
      return direct.execute(instruction, bindings, signal)
    },
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
    async consumeEvidence() {
      return evidence.collect(await instrumentPages())
    },
    async close() {},
  }
}
