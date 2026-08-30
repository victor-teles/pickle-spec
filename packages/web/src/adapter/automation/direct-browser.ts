import type { BrowserContext, Locator, Page } from '@browserbasehq/stagehand'
import type { ScenarioVariableBinding } from '@pickle-spec/spec'
import type {
  WebInstruction,
  WebLocator,
} from '../../execution-cache/web-execution-cache'
import { withAbort } from './abort'
import { comparison, executeLocatorAssertion } from './direct-browser-assertion'
import {
  activePage,
  boundValue,
  locatorFor,
  waitForLocator,
} from './direct-browser-locator'
import type { WebDirectExecutionResult } from './web-automation'

interface DirectBrowserOptions {
  actionTimeoutMs: number
  navigationTimeoutMs: number
}

async function executeLocatorAction(
  instruction: WebInstruction,
  locator: Locator,
  bindings: readonly ScenarioVariableBinding[],
  signal?: AbortSignal,
): Promise<WebDirectExecutionResult | undefined> {
  switch (instruction.kind) {
    case 'click':
      await withAbort(locator.sendClickEvent(), signal)
      return { success: true }
    case 'fill':
      await withAbort(
        locator.fill(boundValue(instruction.value, bindings)),
        signal,
      )
      return { success: true }
    case 'type':
      await withAbort(
        locator.type(boundValue(instruction.value, bindings)),
        signal,
      )
      return { success: true }
    case 'hover':
      await withAbort(locator.hover(), signal)
      return { success: true }
    case 'select-option':
      await withAbort(
        locator.selectOption(
          instruction.values.map((value) => boundValue(value, bindings)),
        ),
        signal,
      )
      return { success: true }
    default:
      return undefined
  }
}

function waitsForAttachment(instruction: WebInstruction): boolean {
  switch (instruction.kind) {
    case 'click':
    case 'fill':
    case 'type':
    case 'hover':
    case 'select-option':
    case 'visible':
    case 'text-equals':
    case 'text-contains':
    case 'value-equals':
      return true
    default:
      return false
  }
}

async function executeLocatorInstruction(
  page: Page,
  instruction: Extract<WebInstruction, { locator: WebLocator }>,
  bindings: readonly ScenarioVariableBinding[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<WebDirectExecutionResult> {
  const locator = locatorFor(page, instruction.locator, bindings)
  if (waitsForAttachment(instruction)) {
    const attached = await waitForLocator(
      page,
      instruction.locator,
      'attached',
      bindings,
      timeoutMs,
      signal,
    )
    if (!attached) {
      return {
        success: false,
        actualState: 'not found',
        message: 'Timed out waiting for locator to be attached',
      }
    }
  }
  const action = await executeLocatorAction(
    instruction,
    locator,
    bindings,
    signal,
  )
  if (action) return action
  return executeLocatorAssertion(
    page,
    instruction,
    locator,
    bindings,
    timeoutMs,
    signal,
  )
}

export function createDirectBrowser(
  context: BrowserContext,
  options: DirectBrowserOptions,
) {
  const navigate = async (url: string, signal?: AbortSignal): Promise<void> => {
    const page = await activePage(context)
    await withAbort(
      page
        .goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: options.navigationTimeoutMs,
        })
        .then(() => undefined),
      signal,
    )
  }
  return {
    navigate,
    async execute(
      instruction: WebInstruction,
      bindings: readonly ScenarioVariableBinding[],
      signal?: AbortSignal,
    ): Promise<WebDirectExecutionResult> {
      const page = await activePage(context)
      if (instruction.kind === 'navigate') {
        await navigate(boundValue(instruction.url, bindings), signal)
        return { success: true }
      }
      if (instruction.kind === 'url-equals') {
        const expected = boundValue(instruction.expected, bindings)
        const actual = await page.url()
        return comparison(actual === expected, expected, actual)
      }
      return executeLocatorInstruction(
        page,
        instruction,
        bindings,
        options.actionTimeoutMs,
        signal,
      )
    },
  }
}
