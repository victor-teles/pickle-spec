import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { AxeBuilder } from '@axe-core/playwright'
import type { Response } from 'playwright'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import {
  evidenceDirectory,
  inspectScenario,
  showDetails,
  tabTo,
  waitForStudio,
  workbenchRail,
} from '../support/execution-plan-browser'
import { createExecutionPlanBrowserProject } from '../support/execution-plan-fixture'
import { StudioBrowserFixture } from '../support/studio-browser-fixture'

const fixture = new StudioBrowserFixture()
async function responseText(response: Response): Promise<string> {
  return response.text().catch(() => '')
}

beforeAll(async () => {
  await Promise.all([
    fixture.setup(),
    mkdir(evidenceDirectory, { recursive: true }),
  ])
}, 60_000)

afterAll(async () => {
  await fixture.teardown()
})

describe('ENG04 readable execution plan browser acceptance', () => {
  test('renders real complete, partial, unsupported, and incompatible cache states without cache mutation or secret disclosure', async () => {
    const project = await fixture.createProject('eng04-plan-states')
    const seeded = await createExecutionPlanBrowserProject(
      project,
      fixture.workspace,
    )
    const before = await seeded.cache.inspect()
    const { child, url } = await fixture.start(project, {
      PICKLE_CACHE_ROOT: seeded.cacheRoot,
      PICKLE_HOME: seeded.pickleHome,
    })
    const context = await fixture.browser.newContext({
      viewport: { width: 1440, height: 1000 },
    })
    const page = await context.newPage()
    const responseBodies: string[] = []
    const browserErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') browserErrors.push(message.text())
    })
    page.on('pageerror', (error) => browserErrors.push(error.message))
    page.on('response', (response) => {
      if (response.status() >= 400)
        browserErrors.push(`${response.status()} ${response.url()}`)
    })
    page.on('response', (response) => {
      if (response.url().startsWith(new URL(url).origin)) {
        void responseText(response).then((body) => responseBodies.push(body))
      }
    })
    try {
      await page.goto(url)
      await waitForStudio(page, 'eng04-plan-states', browserErrors)
      let planRequestCount = 0
      await page.route('**/_serverFn/**', async (route) => {
        planRequestCount += 1
        if (planRequestCount === 1) {
          await route.abort('failed')
          return
        }
        await route.continue()
      })
      const complete = await inspectScenario(page, 'Complete cached plan')
      await page
        .getByRole('alert')
        .filter({ hasText: 'The readable execution plan could not be loaded.' })
        .waitFor()
      await page.getByRole('button', { name: 'Retry', exact: true }).click()
      await complete
        .getByRole('heading', { name: 'Execution plan', exact: true })
        .waitFor()
      expect(planRequestCount).toBe(2)
      await page.unroute('**/_serverFn/**')
      await complete.getByRole('button', { name: 'List', exact: true }).click()
      expect(await complete.textContent()).toContain('Fill')
      expect(await complete.textContent()).toContain('Check visible')
      await complete
        .getByRole('button', { name: /^Edit locator: Fill/ })
        .first()
        .click()
      expect(
        await complete.getByLabel('Locator', { exact: true }).inputValue(),
      ).toBe('#password')
      await complete
        .getByRole('button', { name: 'Cancel', exact: true })
        .click()
      await complete
        .getByRole('button', { name: /^Inspect action: Navigate/ })
        .first()
        .click()
      expect(await complete.textContent()).toContain(
        'https://example.test/account?access_token=%3Credacted%3E',
      )
      await complete.getByRole('button', { name: 'Plan details' }).click()
      const applicationBadge = complete.getByText(
        `Application 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`,
        { exact: true },
      )
      expect(
        await applicationBadge.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true)
      await page.screenshot({
        path: resolve(evidenceDirectory, 'complete-desktop.png'),
        fullPage: true,
      })

      const partial = await inspectScenario(page, 'Partial cached plan')
      await partial.getByText('Uncached', { exact: true }).waitFor()
      expect(await partial.textContent()).toContain('I see the account')
      await page.screenshot({
        path: resolve(evidenceDirectory, 'partial-desktop.png'),
        fullPage: true,
      })

      await inspectScenario(page, 'Complete cached plan', 'custom')
      await page.getByText('Plan unavailable').waitFor()
      expect(await page.textContent('body')).toContain(
        'Readable execution plans are not available for the custom adapter.',
      )

      await inspectScenario(page, 'Malformed cached plan')
      await page.getByText('Plan unavailable').waitFor()
      expect(await page.textContent('body')).toContain(
        'The cached plan does not match the current Gherkin step roles.',
      )

      await inspectScenario(page, 'No cached plan yet')
      await page.getByText('No cached plan', { exact: true }).waitFor()
      expect(await page.textContent('body')).toContain(
        'Run this Scenario with the selected profile to create a readable plan.',
      )

      await expect.poll(() => responseBodies.length).toBeGreaterThan(0)
      const exposedText = `${await page.textContent('body')}\n${responseBodies.join('\n')}`
      expect(exposedText).not.toContain('eng04-super-secret')
      expect(exposedText).not.toContain('eng04-url-secret')
      expect(exposedText).not.toContain('user:pass')
      expect(await seeded.cache.inspect()).toEqual(before)
    } finally {
      await context.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('opens the only profile directly with keyboard review and accessible 320px reflow', async () => {
    const project = await fixture.createProject('eng04-plan-mobile')
    const seeded = await createExecutionPlanBrowserProject(
      project,
      fixture.workspace,
      false,
    )
    const { child, url } = await fixture.start(project, {
      PICKLE_CACHE_ROOT: seeded.cacheRoot,
      PICKLE_HOME: seeded.pickleHome,
    })
    const context = await fixture.browser.newContext({
      viewport: { width: 320, height: 800 },
      reducedMotion: 'reduce',
    })
    const page = await context.newPage()
    try {
      await page.goto(url)
      await waitForStudio(page, 'eng04-plan-mobile')
      const specifications = page.getByRole('button', {
        name: 'Specifications',
        exact: true,
      })
      await tabTo(page, specifications)
      await page.keyboard.press('Enter')
      const showLeft = page.getByRole('button', { name: 'Show Left sidebar' })
      await tabTo(page, showLeft)
      await page.keyboard.press('Enter')
      const scenario = workbenchRail(page).getByRole('button', {
        name: 'Complete cached plan',
        exact: true,
      })
      await tabTo(page, scenario)
      await page.keyboard.press('Enter')
      const showBottom = page.getByRole('button', { name: 'Show Bottom panel' })
      await tabTo(page, showBottom)
      await page.keyboard.press('Enter')
      const planTab = page.getByRole('tab', { name: 'Plan', exact: true })
      await tabTo(
        page,
        page.getByRole('tab', { name: 'Timeline', exact: true }),
      )
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      await page.keyboard.press('ArrowRight')
      expect(
        await planTab.evaluate((element) => element.matches(':focus')),
      ).toBe(true)
      await page.keyboard.press('Enter')
      const complete = page
        .getByRole('region', { name: 'Execution plan editor' })
        .last()
      await complete
        .getByRole('heading', { name: 'Execution plan', exact: true })
        .waitFor()
      expect(
        await page
          .getByRole('button', { name: 'Inspect browser', exact: true })
          .count(),
      ).toBe(0)
      expect(
        await page
          .getByText('Readable execution plan', { exact: true })
          .count(),
      ).toBe(0)
      expect(
        await page
          .getByText('Choose a profile to inspect its current cached plan.')
          .count(),
      ).toBe(0)
      const detailsBounds = await complete.boundingBox()
      expect(detailsBounds?.height).toBeGreaterThan(200)
      const details = complete.getByText('Plan details')
      await details.focus()
      expect(
        await details.evaluate((element) => element.matches(':focus')),
      ).toBe(true)
      await page.keyboard.press('Enter')
      expect(await complete.getByText('Cache revision').isVisible()).toBe(true)
      expect(
        await page
          .locator('html')
          .evaluate((element) => element.scrollWidth <= element.clientWidth),
      ).toBe(true)
      const accessibility = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(accessibility.violations).toEqual([])
      await page.screenshot({
        path: resolve(evidenceDirectory, 'complete-320px.png'),
        fullPage: true,
      })
    } finally {
      await context.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('focuses the actual failed Gherkin step from a persisted run result', async () => {
    const project = await fixture.createProject('eng04-failed-plan')
    const seeded = await createExecutionPlanBrowserProject(
      project,
      fixture.workspace,
    )
    const { child, url } = await fixture.start(project, {
      PICKLE_CACHE_ROOT: seeded.cacheRoot,
      PICKLE_HOME: seeded.pickleHome,
    })
    const page = await fixture.browser.newPage()
    try {
      await page.goto(url)
      await waitForStudio(page, 'eng04-failed-plan')
      await page.getByRole('button', { name: 'Runs', exact: true }).click()
      const history = page.getByRole('table', { name: 'Test run history' })
      await history
        .getByRole('row')
        .nth(1)
        .getByRole('button', { name: /^Open run / })
        .click()
      await showDetails(page)
      await page.getByRole('tab', { name: 'Plan', exact: true }).click()
      const plan = page
        .getByRole('region', { name: 'Execution plan editor' })
        .last()
      await plan
        .getByRole('heading', { name: 'Execution plan', exact: true })
        .waitFor()
      const focused = plan.locator('[data-state="selected"]')
      expect(await focused.textContent()).toContain('I see the account')
      expect(await focused.textContent()).toContain('Recorded failed step')
      await expect
        .poll(() => focused.evaluate((element) => element.matches(':focus')))
        .toBe(true)
      await plan.getByRole('button', { name: 'List', exact: true }).click()
      await plan
        .getByRole('button', { name: /^Edit locator:/ })
        .first()
        .click()
      await plan.getByLabel('Locator', { exact: true }).fill('#help-repaired')
      await plan.getByRole('button', { name: 'Cancel', exact: true }).click()
      await plan
        .getByRole('button', { name: /^Edit locator:/ })
        .first()
        .click()
      await plan.getByLabel('Locator', { exact: true }).fill('#help-repaired')
      await plan
        .getByRole('button', { name: 'Save change', exact: true })
        .click()
      await plan.getByRole('status').filter({ hasText: 'Plan saved' }).waitFor()
      await plan
        .getByRole('button', { name: 'Reload plan', exact: true })
        .click()
      await expect
        .poll(() =>
          plan
            .locator('[data-state="selected"]')
            .evaluate((element) => element.matches(':focus')),
        )
        .toBe(true)
      await page.screenshot({
        path: resolve(evidenceDirectory, 'failed-step-focus.png'),
        fullPage: true,
      })
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)
})
