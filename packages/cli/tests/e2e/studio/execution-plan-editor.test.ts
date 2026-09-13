import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { AxeBuilder } from '@axe-core/playwright'
import type { Page } from 'playwright'
import { afterAll, beforeAll, expect, test } from 'vitest'
import {
  evidenceDirectory,
  inspectScenario,
  waitForStudio,
} from '../support/execution-plan-browser'
import { createExecutionPlanBrowserProject } from '../support/execution-plan-fixture'
import { StudioBrowserFixture } from '../support/studio-browser-fixture'

const fixture = new StudioBrowserFixture()
beforeAll(async () => {
  await Promise.all([
    fixture.setup(),
    mkdir(evidenceDirectory, { recursive: true }),
  ])
}, 60_000)
afterAll(async () => {
  await fixture.teardown()
})

async function expandPlanDock(page: Page) {
  const bounds = await page
    .locator('[data-slot="resizable-handle"]')
    .last()
    .boundingBox()
  if (!bounds) throw new Error('Plan dock resize handle is unavailable')
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2, 260, { steps: 8 })
  await page.mouse.up()
}

test('saves the current plan directly with validation, recovery, reload persistence, and mobile node editing', async () => {
  const project = await fixture.createProject('direct-plan-editor')
  const seeded = await createExecutionPlanBrowserProject(
    project,
    fixture.workspace,
  )
  const { child, url } = await fixture.start(project, {
    PICKLE_CACHE_ROOT: seeded.cacheRoot,
    PICKLE_HOME: seeded.pickleHome,
  })
  const context = await fixture.browser.newContext({
    viewport: { width: 1440, height: 1000 },
  })
  const page = await context.newPage()
  let releaseSave: (() => void) | undefined
  try {
    await page.goto(url)
    await waitForStudio(page, 'direct-plan-editor')
    const plan = await inspectScenario(page, 'Complete cached plan')
    await expandPlanDock(page)
    expect(await plan.textContent()).not.toMatch(/draft|inactive|activation/i)
    await plan.getByRole('button', { name: 'List', exact: true }).click()
    const edit = plan.getByRole('button', { name: /^Edit locator:/ })
    const selector = plan.getByLabel('Locator', { exact: true })
    const match = plan.getByLabel('Match number (optional)', { exact: true })
    const save = plan.getByRole('button', { name: 'Save change', exact: true })
    const cancel = plan.getByRole('button', { name: 'Cancel', exact: true })
    await edit.first().focus()
    await page.keyboard.press('Enter')
    await expect
      .poll(() => selector.evaluate((element) => element.matches(':focus')))
      .toBe(true)
    expect(await selector.inputValue()).toBe('#account-help')
    expect(
      await selector.locator('xpath=ancestor::*[@data-slot="card"]').count(),
    ).toBe(1)
    expect(await save.isDisabled()).toBe(true)
    await selector.fill(' ')
    await save.click()
    await plan
      .getByRole('alert')
      .filter({ hasText: 'Enter a locator.' })
      .waitFor()
    await selector.fill('#repaired-help')
    await match.fill('0')
    await save.click()
    await plan
      .getByRole('alert')
      .filter({ hasText: 'Enter a whole match number' })
      .waitFor()
    expect(await edit.nth(1).isDisabled()).toBe(true)
    expect(
      await plan.getByRole('button', { name: 'Reload plan' }).isDisabled(),
    ).toBe(true)
    await match.fill('1')
    await page.route('**/_serverFn/**', (route) => route.abort('failed'))
    await save.click()
    await plan
      .getByRole('alert')
      .filter({ hasText: 'Unable to save this plan.' })
      .waitFor()
    expect(await selector.inputValue()).toBe('#repaired-help')
    await page.unroute('**/_serverFn/**')
    const gate = new Promise<void>((resolveSave) => {
      releaseSave = resolveSave
    })
    await page.route('**/_serverFn/**', async (route) => {
      await gate
      await route.continue()
    })
    await save.click()
    await plan.getByRole('button', { name: 'Saving…', exact: true }).waitFor()
    expect(await selector.isDisabled()).toBe(true)
    expect(await cancel.isDisabled()).toBe(true)
    releaseSave?.()
    await plan.getByRole('status').filter({ hasText: 'Plan saved' }).waitFor()
    await page.unroute('**/_serverFn/**')
    await expect
      .poll(() => edit.first().evaluate((element) => element.matches(':focus')))
      .toBe(true)
    await plan.getByRole('button', { name: 'Reload plan', exact: true }).click()
    await plan.getByRole('button', { name: 'List', exact: true }).click()
    await edit.first().click()
    expect(await selector.inputValue()).toBe('#repaired-help')
    expect(await match.inputValue()).toBe('1')
    await selector.fill('#<unknown-variable>')
    await save.click()
    await plan
      .getByRole('alert')
      .filter({ hasText: 'unknown variable' })
      .waitFor()
    expect(await selector.inputValue()).toBe('#<unknown-variable>')
    await cancel.click()
    await edit.first().click()
    expect(await selector.inputValue()).toBe('#repaired-help')
    await match.fill('')
    await save.click()
    await plan.getByRole('status').filter({ hasText: 'Plan saved' }).waitFor()
    await page.reload()
    await inspectScenario(page, 'Complete cached plan')
    await plan.getByRole('button', { name: 'List', exact: true }).click()
    await edit.first().click()
    expect(await selector.inputValue()).toBe('#repaired-help')
    expect(await match.inputValue()).toBe('')
    await cancel.click()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Show Bottom panel' }).waitFor()
    await inspectScenario(page, 'Complete cached plan')
    await expandPlanDock(page)
    await plan.getByRole('button', { name: 'List', exact: true }).click()
    await edit.first().click()
    await selector.fill(`[data-test="${'long-selector-'.repeat(18)}"]`)
    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(
      await page
        .locator('html')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
    await cancel.scrollIntoViewIfNeeded()
    const accessibility = await new AxeBuilder({ page })
      .include('[aria-label="Execution plan editor"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(accessibility.violations).toEqual([])
    await page.screenshot({
      path: resolve(evidenceDirectory, 'direct-plan-mobile.png'),
      fullPage: true,
    })
    await cancel.click()
  } finally {
    releaseSave?.()
    await context.close()
    child.kill()
    await child.exited
  }
}, 60_000)

test('edits fields inside canvas nodes through dragging, zooming and fullscreen', async () => {
  const project = await fixture.createProject('direct-node-editor')
  const seeded = await createExecutionPlanBrowserProject(
    project,
    fixture.workspace,
  )
  const { child, url } = await fixture.start(project, {
    PICKLE_CACHE_ROOT: seeded.cacheRoot,
    PICKLE_HOME: seeded.pickleHome,
  })
  const context = await fixture.browser.newContext({
    viewport: { width: 1440, height: 1000 },
  })
  const page = await context.newPage()
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  try {
    await page.goto(url)
    await waitForStudio(page, 'direct-node-editor')
    const plan = await inspectScenario(page, 'Complete cached plan')
    await expandPlanDock(page)
    await plan.getByRole('button', { name: 'Expand', exact: true }).click()
    await expect
      .poll(() => page.evaluate(() => Boolean(document.fullscreenElement)))
      .toBe(true)
    const first = plan.locator('.react-flow__node-step').first()
    const before = await first.getAttribute('style')
    const nodeBounds = await first.boundingBox()
    const bounds = await first.locator('.plan-drag-handle').boundingBox()
    if (!bounds || !nodeBounds) throw new Error('Missing canvas node')
    await page.mouse.move(bounds.x + 50, bounds.y + 20)
    await page.mouse.down()
    await page.mouse.move(bounds.x + 110, bounds.y + 100, { steps: 8 })
    await expect.poll(() => first.getAttribute('style')).not.toBe(before)
    const duringDrag = await first.boundingBox()
    if (!duringDrag) throw new Error('Missing dragged node')
    expect(duringDrag.x).toBeGreaterThan(nodeBounds.x + 40)
    expect(duringDrag.y).toBeGreaterThan(nodeBounds.y + 60)
    await page.mouse.move(bounds.x + 150, bounds.y + 140, { steps: 4 })
    await expect
      .poll(async () => (await first.boundingBox())?.x)
      .toBeCloseTo(duringDrag.x + 40, 0)
    await expect
      .poll(async () => (await first.boundingBox())?.y)
      .toBeCloseTo(duringDrag.y + 40, 0)
    await page.mouse.up()
    expect(await first.getAttribute('style')).not.toBe(before)
    await plan.getByRole('button', { name: 'Arrange', exact: true }).click()
    await expect.poll(() => first.getAttribute('style')).toBe(before)
    const viewport = plan.locator('.react-flow__viewport')
    const zoom = await viewport.getAttribute('style')
    await plan.getByRole('button', { name: 'Zoom out', exact: true }).click()
    await expect.poll(() => viewport.getAttribute('style')).not.toBe(zoom)
    await plan.getByRole('button', { name: 'Arrange', exact: true }).click()
    const edit = first.getByRole('button', { name: /^Edit locator:/ }).first()
    await edit.focus()
    await page.keyboard.press('Enter')
    const selector = first.getByLabel('Locator', { exact: true })
    await expect
      .poll(() => selector.evaluate((element) => element.matches(':focus')))
      .toBe(true)
    await selector.fill('#node-help')
    expect(
      await plan
        .getByRole('button', { name: 'List', exact: true })
        .isDisabled(),
    ).toBe(true)
    await page.screenshot({
      path: resolve(evidenceDirectory, 'direct-plan-nodes.png'),
    })
    const accessibility = await new AxeBuilder({ page })
      .include('[aria-label="Execution plan editor"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(accessibility.violations).toEqual([])
    await first
      .getByRole('button', { name: 'Save change', exact: true })
      .click()
    await plan.getByRole('status').filter({ hasText: 'Plan saved' }).waitFor()
    await expect
      .poll(() => edit.evaluate((element) => element.matches(':focus')))
      .toBe(true)
    expect(await first.textContent()).toContain('#node-help')
    await plan.getByRole('button', { name: 'Fit', exact: true }).click()
    await plan.getByRole('button', { name: /^Inspect action: Check/ }).click()
    expect(await plan.getByLabel('Locator', { exact: true }).count()).toBe(0)
    await plan.getByText(/^Protected check /).waitFor()
    await plan
      .getByRole('button', { name: 'Exit fullscreen', exact: true })
      .click()
    expect(errors).toEqual([])
  } finally {
    await context.close()
    child.kill()
    await child.exited
  }
}, 60_000)
