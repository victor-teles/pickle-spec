import type { BrowserContext, Locator, Page } from '@browserbasehq/stagehand'
import type { ScenarioVariableBinding } from '@pickle-spec/spec'
import {
  bindWebTemplate,
  type WebInstruction,
  type WebLocator,
} from '../execution-cache/web-execution-cache'
import { abortError, withAbort } from './abort'
import type { WebDirectExecutionResult } from './web-automation'

interface DirectBrowserOptions {
  actionTimeoutMs: number
  navigationTimeoutMs: number
}

async function activePage(context: BrowserContext): Promise<Page> {
  const page = await context.activePage()
  if (!page) throw new Error('No active browser page')
  return page
}

function boundValue(
  template: Parameters<typeof bindWebTemplate>[0],
  bindings: readonly ScenarioVariableBinding[],
): string {
  const value = bindWebTemplate(template, bindings)
  if (value === undefined) {
    throw new Error('A required Replay variable is not bound')
  }
  return value
}

function locatorFor(
  page: Page,
  locator: WebLocator,
  bindings: readonly ScenarioVariableBinding[],
): Locator {
  const matched = page.locator(boundValue(locator.selector, bindings))
  return locator.nth === undefined ? matched.first() : matched.nth(locator.nth)
}

async function locatorCount(
  page: Page,
  locator: WebLocator,
  bindings: readonly ScenarioVariableBinding[],
): Promise<number> {
  return page.locator(boundValue(locator.selector, bindings)).count()
}

async function waitForNthLocator(
  page: Page,
  locator: WebLocator,
  state: 'attached' | 'detached' | 'visible' | 'hidden',
  bindings: readonly ScenarioVariableBinding[],
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() <= deadline) {
    if (signal?.aborted) throw abortError()
    const count = await locatorCount(page, locator, bindings)
    const exists = count > (locator.nth ?? 0)
    const visible = exists
      ? await locatorFor(page, locator, bindings).isVisible()
      : false
    if (state === 'attached' && exists) return true
    if (state === 'detached' && !exists) return true
    if (state === 'visible' && visible) return true
    if (state === 'hidden' && !visible) return true
    await Bun.sleep(50)
  }
  return false
}

function comparison(
  success: boolean,
  expected: string | number | boolean,
  actual: string | number | boolean,
): WebDirectExecutionResult {
  return success
    ? { success: true, actualState: String(actual) }
    : {
        success: false,
        actualState: String(actual),
        message: `Expected ${JSON.stringify(expected)} but received ${JSON.stringify(actual)}`,
      }
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
      const locator = locatorFor(page, instruction.locator, bindings)
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
        case 'wait-for': {
          const success = await waitForNthLocator(
            page,
            instruction.locator,
            instruction.state,
            bindings,
            options.actionTimeoutMs,
            signal,
          )
          return success
            ? { success: true }
            : {
                success: false,
                actualState: 'wait timed out',
                message: `Timed out waiting for locator to be ${instruction.state}`,
              }
        }
        case 'exists': {
          const actual = await locatorCount(page, instruction.locator, bindings)
          const minimum = (instruction.locator.nth ?? 0) + 1
          return comparison(
            actual >= minimum,
            `at least ${minimum} matches`,
            actual,
          )
        }
        case 'visible': {
          const actual = await locator.isVisible()
          return comparison(actual, true, actual)
        }
        case 'hidden': {
          const count = await locatorCount(page, instruction.locator, bindings)
          const actual =
            count <= (instruction.locator.nth ?? 0) ||
            !(await locator.isVisible())
          return comparison(actual, true, actual)
        }
        case 'text-equals': {
          const expected = boundValue(instruction.expected, bindings)
          const actual = await locator.innerText()
          return comparison(actual === expected, expected, actual)
        }
        case 'text-contains': {
          const expected = boundValue(instruction.expected, bindings)
          const actual = await locator.innerText()
          return comparison(actual.includes(expected), expected, actual)
        }
        case 'value-equals': {
          const expected = boundValue(instruction.expected, bindings)
          const actual = await locator.inputValue()
          return comparison(actual === expected, expected, actual)
        }
        case 'count-equals': {
          const countExpectation = instruction.expected
          const expected =
            typeof countExpectation === 'number'
              ? countExpectation
              : Number(
                  bindings.find(
                    (binding) => binding.name === countExpectation.variable,
                  )?.value,
                )
          if (!Number.isSafeInteger(expected) || expected < 0) {
            throw new Error(
              'Replay count variable must be a non-negative integer',
            )
          }
          const actual = await locatorCount(page, instruction.locator, bindings)
          return comparison(actual === expected, expected, actual)
        }
      }
    },
  }
}
