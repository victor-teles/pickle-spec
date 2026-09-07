import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { openLocalExecutionPlanStore } from '@pickle-spec/runner'
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
  const handle = page.locator('[data-slot="resizable-handle"]').last()
  const bounds = await handle.boundingBox()
  if (!bounds) throw new Error('Plan dock resize handle is unavailable')
  await page.mouse.move(
    bounds.x + bounds.width / 2,
    bounds.y + bounds.height / 2,
  )
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width / 2, 260, { steps: 8 })
  await page.mouse.up()
}

test('edits locators inline with recovery, revision chaining, keyboard focus, and mobile reflow', async () => {
  const project = await fixture.createProject('inline-plan-editor')
  const seeded = await createExecutionPlanBrowserProject(
    project,
    fixture.workspace,
  )
  const before = await seeded.cache.inspect()
  const store = await openLocalExecutionPlanStore({ projectRoot: project })
  const { child, url } = await fixture.start(project, {
    PICKLE_CACHE_ROOT: seeded.cacheRoot,
    PICKLE_HOME: seeded.pickleHome,
  })
  const context = await fixture.browser.newContext({
    viewport: { width: 1440, height: 1000 },
  })
  const page = await context.newPage()
  let releaseSave: () => void = () => undefined
  try {
    await page.goto(url)
    await waitForStudio(page, 'inline-plan-editor')
    const cached = await inspectScenario(page, 'Complete cached plan')
    await expandPlanDock(page)
    await cached.getByRole('button', { name: 'Start draft from cache' }).click()
    const draft = page.getByRole('region', {
      name: 'Execution plan draft editor',
    })
    await draft.waitFor()
    expect(await cached.getByText('Current cached plan').count()).toBe(0)
    expect(
      await draft
        .getByRole('list', { name: 'Plan steps', exact: true })
        .count(),
    ).toBe(1)
    expect(
      await draft
        .getByText('When I enter account credentials', { exact: true })
        .count(),
    ).toBe(1)
    await draft.getByRole('button', { name: 'Draft details' }).click()
    const initialRevision = await draft
      .getByText(/^Revision [a-f0-9]{64}$/)
      .innerText()
    await draft.getByRole('button', { name: 'Draft details' }).click()
    const edit = draft.getByRole('button', {
      name: 'Edit locator',
      exact: true,
    })
    const selector = draft.getByLabel('Locator', { exact: true })
    const match = draft.getByLabel('Match number (optional)', { exact: true })
    const save = draft.getByRole('button', {
      name: 'Save change',
      exact: true,
    })
    const cancel = draft.getByRole('button', { name: 'Cancel', exact: true })
    const close = draft.getByRole('button', {
      name: 'Close draft',
      exact: true,
    })
    await edit.first().focus()
    await page.keyboard.press('Enter')
    await expect
      .poll(() => selector.evaluate((element) => element.matches(':focus')))
      .toBe(true)
    expect(await selector.inputValue()).toBe('#account-help')
    expect(await selector.getAttribute('spellcheck')).toBe('false')
    expect(await match.inputValue()).toBe('')
    expect(await save.isDisabled()).toBe(true)
    await selector.fill(' ')
    await save.click()
    await draft
      .getByRole('alert')
      .filter({ hasText: 'Enter a locator.' })
      .waitFor()
    expect(await selector.getAttribute('aria-invalid')).toBe('true')
    expect(await match.getAttribute('aria-invalid')).toBe('false')
    await selector.fill('#repaired-help')
    await match.fill('0')
    await save.click()
    await draft
      .getByRole('alert')
      .filter({ hasText: 'Enter a whole match number' })
      .waitFor()
    expect(await match.evaluate((element) => element.matches(':focus'))).toBe(
      true,
    )
    expect(await selector.getAttribute('aria-invalid')).toBe('false')
    expect(await edit.nth(1).isDisabled()).toBe(true)
    expect(await close.isDisabled()).toBe(true)
    await match.fill('1')
    await page.route('**/_serverFn/**', (route) => route.abort('failed'))
    await save.click()
    await draft
      .getByRole('alert')
      .filter({ hasText: 'Unable to save this draft.' })
      .waitFor()
    expect(await selector.inputValue()).toBe('#repaired-help')
    expect(await match.inputValue()).toBe('1')
    await page.unroute('**/_serverFn/**')
    const saveGate = new Promise<void>((resolveSave) => {
      releaseSave = resolveSave
    })
    await page.route('**/_serverFn/**', async (route) => {
      await saveGate
      await route.continue()
    })
    await save.click()
    await draft.getByRole('button', { name: 'Saving…', exact: true }).waitFor()
    expect(await selector.isDisabled()).toBe(true)
    expect(await match.isDisabled()).toBe(true)
    expect(await cancel.isDisabled()).toBe(true)
    expect(await close.isDisabled()).toBe(true)
    expect(await edit.nth(1).isDisabled()).toBe(true)
    releaseSave()
    await draft
      .getByRole('status')
      .filter({ hasText: 'Saved to draft' })
      .waitFor()
    await page.unroute('**/_serverFn/**')
    await expect
      .poll(() => edit.first().evaluate((element) => element.matches(':focus')))
      .toBe(true)
    await draft.getByRole('button', { name: 'Draft details' }).click()
    const firstRevision = await draft
      .getByText(/^Revision [a-f0-9]{64}$/)
      .innerText()
    const first = await store.readRevision(
      firstRevision.replace('Revision ', ''),
    )
    expect(first.ok && first.value?.origin).toEqual({
      kind: 'revision',
      revisionId: initialRevision.replace('Revision ', ''),
    })
    await draft.getByRole('button', { name: 'Draft details' }).click()
    await edit.first().click()
    expect(await match.inputValue()).toBe('1')
    await match.fill('')
    await save.click()
    await draft
      .getByRole('status')
      .filter({ hasText: 'Saved to draft' })
      .waitFor()
    await draft.getByRole('button', { name: 'Draft details' }).click()
    const secondRevision = await draft
      .getByText(/^Revision [a-f0-9]{64}$/)
      .innerText()
    const second = await store.readRevision(
      secondRevision.replace('Revision ', ''),
    )
    expect(second.ok && second.value?.origin).toEqual({
      kind: 'revision',
      revisionId: firstRevision.replace('Revision ', ''),
    })
    await draft.getByRole('button', { name: 'Draft details' }).click()
    await edit.first().click()
    expect(await match.inputValue()).toBe('')
    await selector.fill('#<unknown-variable>')
    await save.click()
    await draft
      .getByRole('alert')
      .filter({ hasText: 'unknown variable' })
      .waitFor()
    expect(await selector.inputValue()).toBe('#<unknown-variable>')
    await cancel.click()
    await expect
      .poll(() => edit.first().evaluate((element) => element.matches(':focus')))
      .toBe(true)
    await edit.nth(1).click()
    await selector.fill(`[data-test="${'long-selector-'.repeat(18)}"]`)
    const accessibility = await new AxeBuilder({ page })
      .include('[aria-label="Execution plan draft editor"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(accessibility.violations).toEqual([])
    await cancel.scrollIntoViewIfNeeded()
    await page.screenshot({
      path: resolve(evidenceDirectory, 'inline-editor-desktop.png'),
      fullPage: true,
    })
    await cancel.click()
    await close.click()
    await cached.getByText('Current cached plan').waitFor()
    expect(await cached.textContent()).toContain('#account-help')
    expect(await cached.textContent()).not.toContain('#repaired-help')
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Show Bottom panel' }).waitFor()
    await inspectScenario(page, 'Complete cached plan')
    await expandPlanDock(page)
    await page.getByRole('button', { name: 'Start draft from cache' }).click()
    await edit.nth(1).click()
    await selector.fill(`[data-test="${'long-selector-'.repeat(18)}"]`)

    await page.emulateMedia({ reducedMotion: 'reduce' })
    expect(
      await page
        .locator('html')
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true)
    await cancel.scrollIntoViewIfNeeded()
    const mobileAccessibility = await new AxeBuilder({ page })
      .include('[aria-label="Execution plan draft editor"]')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
      .analyze()
    expect(mobileAccessibility.violations).toEqual([])

    await page.screenshot({
      path: resolve(evidenceDirectory, 'inline-editor-390px.png'),
      fullPage: true,
    })
    await cancel.click()
    await close.click()
    await cached.getByText('Current cached plan').waitFor()
    expect(await cached.textContent()).toContain('#account-help')
    expect(await cached.textContent()).not.toContain('#repaired-help')
    expect(await seeded.cache.inspect()).toEqual(before)
  } finally {
    releaseSave()
    await context.close()
    child.kill()
    await child.exited
  }
}, 60_000)
