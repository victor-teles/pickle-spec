import { join } from 'node:path'
import type { Browser, Locator, Page } from 'playwright'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { StudioBrowserFixture } from '../support/studio-browser-fixture'

function workbenchRail(page: Page): Locator {
  return page
    .getByRole('tablist', { name: 'Specifications workbench rail' })
    .locator('xpath=ancestor::aside')
}

async function openSpecificationsRail(page: Page): Promise<Locator> {
  const rail = workbenchRail(page)
  await rail.getByRole('tab', { name: 'Specifications' }).click()
  return rail
}

async function showWorkbenchDetails(page: Page): Promise<void> {
  const hideDetails = page.getByRole('button', { name: 'Hide Right sidebar' })
  if (await hideDetails.isVisible()) return
  const showDetails = page.getByRole('button', { name: 'Show Right sidebar' })
  await showDetails.waitFor()
  await showDetails.click()
  await hideDetails.waitFor()
}

async function runSpecification(page: Page): Promise<void> {
  await showWorkbenchDetails(page)
  const runSelected = page.getByRole('button', { name: 'Run Specification' })
  if (await runSelected.isVisible()) {
    await runSelected.click()
    return
  }
  await page.getByRole('button', { name: 'Run all Specifications' }).click()
}

function scenarioResult(page: Page, name: RegExp): Locator {
  return workbenchRail(page).getByRole('button', { name })
}

describe('Studio route restoration', () => {
  const fixture = new StudioBrowserFixture()
  let browser: Browser

  beforeAll(async () => {
    await fixture.setup()
    browser = fixture.browser
  }, 120_000)

  afterAll(async () => {
    await fixture.teardown()
  }, 15_000)

  test('restores Specification, scenario, run, result, and artifact pages after refresh', async () => {
    const project = await fixture.createProject('route-restoration')
    await Bun.write(
      join(project, 'features', 'search.feature'),
      `@pickle:id:specsearchaaaaaaa @pickle:state:active
Feature: Search
  @pickle:id:scnquerybbbbbbbb
  Scenario: Query the catalog
    Then results are shown`,
    )
    const { child, url } = await fixture.start(project)
    const page = await browser.newPage()
    try {
      await page.goto(url)

      const rail = await openSpecificationsRail(page)
      await rail.getByRole('button', { name: /Search/ }).click()
      expect(new URL(page.url()).pathname).toBe(
        '/specifications/specsearchaaaaaaa',
      )
      await page.reload()
      await rail.getByRole('button', { name: /Search/ }).waitFor()

      await page.keyboard.press('Meta+k')
      await page
        .locator('[data-slot="command-input"]')
        .fill('Query the catalog')
      await page
        .getByRole('dialog', { name: 'Studio commands' })
        .getByRole('option')
        .filter({ hasText: 'Query the catalog' })
        .click()
      await page.waitForURL(
        (current) =>
          current.pathname ===
          '/specifications/specsearchaaaaaaa/scenarios/scnquerybbbbbbbb',
      )
      await page.reload()
      const queryScenario = workbenchRail(page).getByRole('button', {
        name: 'Query the catalog',
        exact: true,
      })
      await queryScenario.waitFor()
      expect(await queryScenario.getAttribute('aria-pressed')).toBe('true')

      await page
        .getByRole('button', { name: 'Specifications', exact: true })
        .click()
      await (await openSpecificationsRail(page))
        .getByRole('button', { name: /Checkout/ })
        .click()
      await runSpecification(page)
      await scenarioResult(page, /Pay for the order.*chrome.*failed/).waitFor({
        timeout: 20_000,
      })

      await page.getByRole('button', { name: 'Runs', exact: true }).click()
      const history = page.getByRole('table', { name: 'Test run history' })
      await history
        .getByRole('row')
        .nth(1)
        .getByRole('button', { name: /^Open run / })
        .click()
      expect(new URL(page.url()).pathname).toMatch(/^\/runs\/[^/]+$/)
      await page
        .getByRole('heading', { name: 'Pay for the order · chrome' })
        .waitFor()
      await page.getByRole('combobox', { name: 'Attempt' }).waitFor()
      await page.reload()
      await page
        .getByRole('heading', { name: 'Pay for the order · chrome' })
        .waitFor()
      expect(new URL(page.url()).pathname).toMatch(/^\/runs\/[^/]+$/)

      await page.getByRole('tab', { name: 'Artifacts' }).click()
      await page.getByRole('link', { name: 'Open artifact page' }).click()
      expect(new URL(page.url()).pathname).toMatch(/\/artifacts\/0$/)
      const artifactUrl = new URL(page.url())
      await page.reload()
      await page
        .getByRole('heading', { name: 'screenshot · Pay for the order' })
        .waitFor()
      expect(page.url()).not.toContain('failure.png')

      await page.goBack()
      await page
        .getByRole('heading', { name: 'Pay for the order · chrome' })
        .waitFor()
      expect(new URL(page.url()).searchParams.get('tab')).toBe('artifacts')

      await page.goto(
        `${artifactUrl.origin}${artifactUrl.pathname.replace(/\/artifacts\/0$/, '/artifacts/99')}?tab=artifacts`,
      )
      await page
        .getByRole('alert')
        .filter({ hasText: 'Test artifact 99 is not available' })
        .waitFor()
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('reconnects to an active Test run after refresh', async () => {
    const project = await fixture.createProject('active-run-restoration')
    const gate = join(project, 'continue.txt')
    const { child, url } = await fixture.start(project, {
      PICKLE_STUDIO_CONTINUE: gate,
    })
    const page = await browser.newPage()
    try {
      await page.goto(url)
      await runSpecification(page)
      await scenarioResult(page, /Pay for the order.*chrome.*running/).waitFor({
        timeout: 20_000,
      })

      await page.reload()

      await scenarioResult(page, /Pay for the order.*chrome.*running/).waitFor({
        timeout: 20_000,
      })
      expect(new URL(page.url()).pathname).toBe('/')
      await page.getByRole('button', { name: 'Cancel run' }).waitFor()

      await scenarioResult(page, /Pay for the order.*chrome.*running/).click()
      expect(new URL(page.url()).pathname).toBe('/')
      await showWorkbenchDetails(page)
      const resultHeading = page.getByRole('heading', { name: 'Checkout' })
      await resultHeading.waitFor()
      const resultDetails = resultHeading.locator('xpath=ancestor::aside')
      await resultDetails
        .getByText('Pay for the order', { exact: true })
        .waitFor()
      await page.reload()
      await scenarioResult(page, /Pay for the order.*chrome.*running/).click()
      await showWorkbenchDetails(page)
      await resultHeading.waitFor()
      await resultDetails.getByText('running', { exact: true }).waitFor()

      await Bun.write(gate, 'continue')
      await resultDetails.getByText('failed', { exact: true }).waitFor({
        timeout: 20_000,
      })
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 45_000)

  test('returns home when the Studio brand is clicked', async () => {
    const project = await fixture.createProject('brand-home-navigation')
    const { child, url } = await fixture.start(project)
    const page = await browser.newPage()
    try {
      await page.goto(url)
      await page.getByRole('button', { name: 'Runs', exact: true }).click()
      await page.getByRole('heading', { name: 'Runs' }).waitFor()

      await page.getByRole('button', { name: 'Pickle Spec' }).click()

      expect(new URL(page.url()).pathname).toBe('/')
      await page.getByRole('heading', { name: 'Checkout' }).waitFor()
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  })

  test('keeps the live queue available while browsing Specifications', async () => {
    const project = await fixture.createProject('live-result-specification')
    const gate = join(project, 'continue.txt')
    await Bun.write(
      join(project, 'features', 'search.feature'),
      `@pickle:id:specsearchaaaaaaa @pickle:state:active
Feature: Search
  @pickle:id:scnquerybbbbbbbb
  Scenario: Query the catalog
    Then results are shown`,
    )
    const { child, url } = await fixture.start(project, {
      PICKLE_STUDIO_CONTINUE: gate,
    })
    const page = await browser.newPage()
    try {
      await page.goto(url)
      await page
        .getByRole('button', { name: 'Run Scenario Pay for the order' })
        .click()
      const liveResult = scenarioResult(
        page,
        /Pay for the order.*chrome.*running/,
      )
      await liveResult.waitFor({ timeout: 20_000 })

      await (await openSpecificationsRail(page))
        .getByRole('button', { name: /Search/ })
        .click()

      await workbenchRail(page)
        .getByRole('button', { name: 'Query the catalog' })
        .first()
        .waitFor()
      expect(new URL(page.url()).pathname).toBe(
        '/specifications/specsearchaaaaaaa',
      )
      await workbenchRail(page).getByRole('tab', { name: 'Queue' }).click()
      await liveResult.waitFor()

      await (await openSpecificationsRail(page))
        .getByRole('button', { name: /^Checkout\s+\d+$/ })
        .click()
      await Bun.write(gate, 'continue')
      await workbenchRail(page).getByRole('tab', { name: 'Queue' }).click()
      await scenarioResult(page, /Pay for the order.*chrome.*failed/).waitFor({
        timeout: 20_000,
      })
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 45_000)
})
