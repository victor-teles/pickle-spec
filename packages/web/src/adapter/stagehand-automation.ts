import type {
  BrowserContext,
  Stagehand,
  StagehandBrowser,
} from '@browserbasehq/stagehand'
import type { ScenarioVariableBinding } from '@pickle-spec/spec'
import { z } from 'zod'
import {
  type createWebEvidenceCollector,
  instrumentWebEvidencePages,
} from '../evidence/web-evidence'
import { startWebRecording, type WebRecording } from '../evidence/web-recording'
import {
  type WebAssertionDraft,
  type WebInstruction,
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

class StagehandAutomation implements WebAutomation {
  private readonly direct
  private recording: WebRecording | undefined

  constructor(
    private readonly browser: StagehandBrowser,
    private readonly stagehand: Stagehand,
    private readonly timeouts: StagehandTimeouts,
    private readonly evidence: ReturnType<typeof createWebEvidenceCollector>,
  ) {
    this.direct = createDirectBrowser(browser.context, {
      actionTimeoutMs: timeouts.actTimeoutMs,
      navigationTimeoutMs: timeouts.navigationTimeoutMs,
    })
  }

  async initialize(): Promise<this> {
    await this.instrumentPages()
    return this
  }

  private async instrumentPages() {
    const pages = await this.browser.context.pages()
    return instrumentWebEvidencePages(pages, this.evidence)
  }

  async screenshot(options: WebScreenshotCapture): Promise<Uint8Array> {
    const page = await activePage(this.browser.context)
    return new Uint8Array(
      await page.screenshot({
        type: options.format,
        fullPage: options.fullPage,
      }),
    )
  }

  async navigate(url: string, signal?: AbortSignal): Promise<void> {
    await this.instrumentPages()
    await this.direct.navigate(url, signal)
    await this.instrumentPages()
  }

  async observe(prompt: string, signal?: AbortSignal) {
    await this.instrumentPages()
    const result = await withAbort(
      this.stagehand.observe(prompt, {
        timeout: this.timeouts.observeTimeoutMs,
      }),
      signal,
    )
    const page = await this.browser.context.activePage()
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
  }

  async act(action: WebObservedAction, signal?: AbortSignal) {
    await this.instrumentPages()
    const result = await withAbort(
      this.stagehand.act(action.handle as Parameters<Stagehand['act']>[0], {
        timeout: this.timeouts.actTimeoutMs,
      }),
      signal,
    )
    return {
      success: result.data.success,
      message: result.data.success ? undefined : result.data.message,
    }
  }

  async verify(prompt: string, signal?: AbortSignal) {
    await this.instrumentPages()
    const result = await withAbort(
      this.stagehand.extract(
        `Extract whether the page currently satisfies this expectation: "${prompt}". ` +
          'Judge only the stated condition. Describe the relevant visible state.',
        verificationSchema,
        { timeout: this.timeouts.observeTimeoutMs },
      ),
      signal,
    )
    return result.data
  }

  async compileAssertion(prompt: string, signal?: AbortSignal) {
    await this.instrumentPages()
    const result = await withAbort(
      this.stagehand.extract(
        'Extract locators that confirm this expectation. Use element types and ' +
          'visible labels, not colors. Named fields, inputs, or buttons that ' +
          'should stay visible use kind visible, not inner text. Expected values ' +
          'must come from the expectation text, never from the current page ' +
          `value: "${prompt}"`,
        webAssertionCompileSchema,
        { timeout: this.timeouts.observeTimeoutMs },
      ),
      signal,
    )
    const page = await activePage(this.browser.context)
    const assertions: WebAssertionDraft[] = []
    for (const draft of result.data.assertions) {
      assertions.push(
        'selector' in draft
          ? {
              ...draft,
              selector: await stabilizeSelector(page, draft.selector),
            }
          : draft,
      )
    }
    return assertions
  }

  async executeInstruction(
    instruction: WebInstruction,
    bindings: readonly ScenarioVariableBinding[],
    signal?: AbortSignal,
  ) {
    await this.instrumentPages()
    return this.direct.execute(instruction, bindings, signal)
  }

  async startRecording(path: string): Promise<void> {
    if (this.recording) await this.recording.stop()
    this.recording = await startWebRecording({
      path,
      captureFrame: () => this.screenshot({ format: 'jpeg', fullPage: false }),
    })
  }

  async stopRecording() {
    const active = this.recording
    this.recording = undefined
    if (!active) throw new Error('Web recording was not started')
    return active.stop()
  }

  readIsolationState(): Promise<WebIsolationState> {
    return readStagehandIsolation(this.browser.context)
  }

  async consumeEvidence() {
    return this.evidence.collect(await this.instrumentPages())
  }

  async close(): Promise<void> {
    const active = this.recording
    this.recording = undefined
    if (active) await active.discard()
  }
}

export async function createStagehandAutomation(
  browser: StagehandBrowser,
  stagehand: Stagehand,
  timeouts: StagehandTimeouts,
  evidence: ReturnType<typeof createWebEvidenceCollector>,
): Promise<WebAutomation> {
  return new StagehandAutomation(
    browser,
    stagehand,
    timeouts,
    evidence,
  ).initialize()
}
