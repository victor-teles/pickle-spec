import type { BrowserContext, Locator, Page } from '@browserbasehq/stagehand'
import type { ScenarioVariableBinding } from '@pickle-spec/spec'
import {
  bindWebTemplate,
  type WebLocator,
  type WebTemplate,
} from '../../execution-cache/web-execution-cache'
import { abortError } from './abort'

export type LocatorState = 'attached' | 'detached' | 'visible' | 'hidden'

export async function activePage(context: BrowserContext): Promise<Page> {
  const page = await context.activePage()
  if (!page) throw new Error('No active browser page')
  return page
}

export function boundValue(
  template: WebTemplate,
  bindings: readonly ScenarioVariableBinding[],
): string {
  const value = bindWebTemplate(template, bindings)
  if (value === undefined) {
    throw new Error('A required Replay variable is not bound')
  }
  return value
}

export function locatorFor(
  page: Page,
  locator: WebLocator,
  bindings: readonly ScenarioVariableBinding[],
): Locator {
  const matched = page.locator(boundValue(locator.selector, bindings))
  return locator.nth === undefined ? matched.first() : matched.nth(locator.nth)
}

export function locatorCount(
  page: Page,
  locator: WebLocator,
  bindings: readonly ScenarioVariableBinding[],
): Promise<number> {
  return page.locator(boundValue(locator.selector, bindings)).count()
}

function reachedState(
  state: LocatorState,
  exists: boolean,
  visible: boolean,
): boolean {
  switch (state) {
    case 'attached':
      return exists
    case 'detached':
      return !exists
    case 'visible':
      return visible
    case 'hidden':
      return !visible
  }
}

export async function waitForLocator(
  page: Page,
  locator: WebLocator,
  state: LocatorState,
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
    if (reachedState(state, exists, visible)) return true
    await Bun.sleep(50)
  }
  return false
}
