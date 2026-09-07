import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import type { Locator, Page, Response } from 'playwright'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { createExecutionPlanBrowserProject } from '../support/execution-plan-fixture'
import { StudioBrowserFixture } from '../support/studio-browser-fixture'

const fixture = new StudioBrowserFixture()
const evidenceDirectory = resolve(
  import.meta.dir,
  '../../../../../.audit/eng04/browser-screenshots',
)

function workbenchRail(page: Page): Locator {
  return page
    .getByRole('tablist', { name: 'Specifications workbench rail' })
    .locator('xpath=ancestor::aside')
}

async function showDetails(page: Page): Promise<void> {
  const hidden = page.getByRole('button', { name: 'Show Right sidebar' })
  if (await hidden.isVisible()) await hidden.click()
}

async function inspectScenario(
  page: Page,
  scenarioName: string,
  profile = 'browser',
): Promise<Locator> {
  await page
    .getByRole('button', { name: 'Specifications', exact: true })
    .click()
  const showLeft = page.getByRole('button', { name: 'Show Left sidebar' })
  if (await showLeft.isVisible()) await showLeft.click()
  await workbenchRail(page)
    .getByRole('button', { name: scenarioName, exact: true })
    .click()
  await showDetails(page)
  await page.getByText('Readable execution plan', { exact: true }).waitFor()
  const inspect = page.getByRole('button', {
    name: `Inspect ${profile}`,
    exact: true,
  })
  if ((await inspect.count()) === 0) {
    const labels = await page.locator('button').allTextContents()
    throw new Error(
      `Missing Inspect ${profile}. Buttons: ${labels.join(' | ')}`,
    )
  }
  await inspect.click()
  return page.getByRole('region', { name: 'Readable execution plan' }).last()
}

async function responseText(response: Response): Promise<string> {
  return response.text().catch(() => '')
}

async function tabTo(page: Page, target: Locator): Promise<void> {
  for (let index = 0; index < 100; index += 1) {
    await page.keyboard.press('Tab')
    if (await target.evaluate((element) => element.matches(':focus'))) return
  }
  throw new Error('Keyboard focus did not reach the requested control')
}

async function waitForStudio(
  page: Page,
  projectName: string,
  browserErrors: readonly string[] = [],
): Promise<void> {
  try {
    await page
      .getByRole('button', { name: 'Specifications', exact: true })
      .waitFor({ timeout: 10_000 })
  } catch {
    throw new Error(
      `Studio did not render ${projectName} at ${page.url()}. ${browserErrors.join(' | ')} ${await page.content()}`,
    )
  }
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
      await complete.getByText('Current cached plan').waitFor()
      expect(planRequestCount).toBe(2)
      await page.unroute('**/_serverFn/**')
      expect(await complete.textContent()).toContain('Fill')
      expect(await complete.textContent()).toContain('Check visible')
      expect(await complete.textContent()).toContain('Value <redacted>')
      expect(await complete.textContent()).toContain(
        'https://example.test/account?access_token=%3Credacted%3E',
      )
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
      await partial.getByText('Uncached tail').waitFor()
      expect(await partial.textContent()).toContain('Then I see the account')
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

      const absent = await inspectScenario(page, 'No cached plan yet')
      await absent.getByText('No cached plan', { exact: true }).waitFor()
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

  test('supports keyboard review and accessible 320px reflow before a run', async () => {
    const project = await fixture.createProject('eng04-plan-mobile')
    const seeded = await createExecutionPlanBrowserProject(
      project,
      fixture.workspace,
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
      const showRight = page.getByRole('button', { name: 'Show Right sidebar' })
      await tabTo(page, showRight)
      await page.keyboard.press('Enter')
      const inspect = page.getByRole('button', {
        name: 'Inspect browser',
        exact: true,
      })
      await tabTo(page, inspect)
      await page.keyboard.press('Enter')
      const complete = page
        .getByRole('region', { name: 'Readable execution plan' })
        .last()
      await complete.getByText('Current cached plan').waitFor()
      const detailsBounds = await complete.boundingBox()
      expect(detailsBounds?.height).toBeGreaterThan(200)
      const details = complete.getByText('Applicability details')
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
        .getByRole('region', { name: 'Readable execution plan' })
        .last()
      await plan.getByText('Current cached plan').waitFor()
      const focused = plan.locator('[data-state="selected"]')
      expect(await focused.textContent()).toContain('Then I see the account')
      expect(await focused.textContent()).toContain('Recorded failed step')
      expect(
        await focused.evaluate((element) => element.matches(':focus')),
      ).toBe(true)
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
