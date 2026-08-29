import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import type { Browser } from 'playwright'
import { StudioBrowserFixture } from './studio-browser-fixture'

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

      await page.getByRole('button', { name: 'Search', exact: true }).click()
      expect(new URL(page.url()).pathname).toBe(
        '/specifications/specsearchaaaaaaa',
      )
      await page.reload()
      await page.getByRole('heading', { name: 'Search' }).waitFor()

      await page.keyboard.press('Meta+k')
      await page
        .locator('[data-slot="command-input"]')
        .fill('Query the catalog')
      await page
        .getByRole('dialog', { name: 'Studio commands' })
        .getByRole('option')
        .filter({ hasText: 'Query the catalog' })
        .click()
      expect(new URL(page.url()).pathname).toBe(
        '/specifications/specsearchaaaaaaa/scenarios/scnquerybbbbbbbb',
      )
      await page.reload()
      const queryScenario = page
        .getByRole('table', { name: 'Scenarios' })
        .getByRole('row')
        .filter({ hasText: 'Query the catalog' })
      await queryScenario.waitFor()
      expect(await queryScenario.getAttribute('data-state')).toBe('selected')

      await page
        .getByRole('button', { name: 'Specifications', exact: true })
        .click()
      await page.getByRole('button', { name: 'Checkout', exact: true }).click()
      await page.getByRole('button', { name: 'Run Specification' }).click()
      await page
        .getByRole('button', {
          name: 'Pay for the order chrome failed',
          exact: true,
        })
        .waitFor({ timeout: 20_000 })
      await page.getByRole('button', { name: 'Run Specification' }).waitFor({
        timeout: 20_000,
      })

      await page.getByRole('button', { name: 'Runs', exact: true }).click()
      const history = page.getByRole('table', { name: 'Test run history' })
      await history
        .getByRole('row')
        .nth(1)
        .getByRole('button', { name: 'Review run' })
        .click()
      const runPath = new URL(page.url()).pathname
      expect(runPath).toMatch(/^\/runs\/[^/]+$/)
      await page.reload()
      const results = page.getByRole('table', { name: 'Test run results' })
      await results.waitFor()

      await results
        .getByRole('row')
        .filter({ hasText: 'Pay for the order' })
        .filter({ hasText: 'chrome' })
        .first()
        .getByRole('button', { name: 'Inspect result' })
        .click()
      expect(new URL(page.url()).pathname).toMatch(
        /^\/runs\/[^/]+\/results\/features%2Fcheckout\.feature\/scenarios\/scnpaybbbbbbbbbb\/profiles\/chrome\/attempts\/1$/,
      )
      await page.reload()
      await page
        .getByRole('heading', { name: 'Pay for the order · chrome' })
        .waitFor()

      await page.getByRole('tab', { name: 'Artifacts' }).click()
      await page.getByRole('link', { name: 'Open artifact page' }).click()
      expect(new URL(page.url()).pathname).toMatch(/\/artifacts\/0$/)
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

      const resultUrl = new URL(page.url())
      await page.goto(
        `${resultUrl.origin}${resultUrl.pathname}/artifacts/99?tab=artifacts`,
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
})
