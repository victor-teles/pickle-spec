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
import {
  type WebAssertionDraft,
  webAssertionCompileSchema,
} from '../execution-cache/web-execution-cache'
import { withAbort } from './abort'
import { createDirectBrowser } from './direct-browser'
import { stabilizeSelector } from './stable-selector'
import type {
  WebAutomation,
  WebIsolationState,
  WebObservedAction,
  WebScreenshotCapture,
} from './web-automation'

const verificationSchema = z.object({
  meetsExpectation: z
    .boolean()
    .describe('Whether the current page satisfies the stated expectation'),
  actualState: z
    .string()
    .describe('Short description of the relevant page state actually observed'),
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
      const page = await browser.context.activePage()
      const actions: WebObservedAction[] = []
      for (const action of result.data) {
        actions.push({
          description: action.description,
          handle: {
            ...action,
            selector: page
              ? await stabilizeSelector(page, action.selector)
              : action.selector,
          },
        })
      }
      return actions
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
          `Extract whether the page currently satisfies this expectation: "${prompt}". ` +
            'Judge only the stated condition. Describe the relevant visible state.',
          verificationSchema,
          { timeout: timeouts.observeTimeoutMs },
        ),
        signal,
      )
      return result.data
    },
    async compileAssertion(prompt, signal) {
      await instrumentPages()
      const result = await withAbort(
        stagehand.extract(
          'Extract locators that confirm this expectation. Use element types and ' +
            'visible labels, not colors. Expected values must come from the ' +
            `expectation text, never from the current page value: "${prompt}"`,
          webAssertionCompileSchema,
          { timeout: timeouts.observeTimeoutMs },
        ),
        signal,
      )
      const page = await activePage(browser.context)
      const assertions: WebAssertionDraft[] = []
      for (const draft of result.data.assertions) {
        if (!('selector' in draft)) {
          assertions.push(draft)
          continue
        }
        assertions.push({
          ...draft,
          selector: await stabilizeSelector(page, draft.selector),
        })
      }
      return assertions
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
