import { expect, test } from 'bun:test'
import { join } from 'node:path'
import AxeBuilder from '@axe-core/playwright'
import { openTestRunStore, type RunEventPayload } from '@pickle-spec/runner'
import type { Browser, Page } from 'playwright'
import {
  collectStream,
  type StudioBrowserFixture,
} from './studio-browser-fixture'

type BrowserDocument = {
  document: {
    activeElement?: {
      textContent?: string | null
      matches: (selector: string) => boolean
    } | null
  }
}

export function registerStudioHardeningTests(
  fixture: StudioBrowserFixture,
): void {
  const createStudioProject = fixture.createProject.bind(fixture)
  const startStudio = fixture.start.bind(fixture)
  const browser = {
    newPage: () => fixture.browser.newPage(),
    newContext: (options?: Parameters<Browser['newContext']>[0]) =>
      fixture.browser.newContext(options),
  }

  test('Studio protects the local session token and rejects untrusted origins', async () => {
    const project = await createStudioProject('secure-local-session')
    const { child, url } = await startStudio(project)
    const page = await browser.newPage()
    try {
      const studioUrl = new URL(url)
      const token = studioUrl.searchParams.get('token')
      expect(token).toBeTruthy()

      const apiUrl = new URL('/api/project', studioUrl)
      const unauthorized = await fetch(apiUrl)
      expect(unauthorized.status).toBe(401)
      expect(unauthorized.headers.get('content-security-policy')).toContain(
        "default-src 'none'",
      )
      expect(
        (
          await fetch(apiUrl, {
            headers: {
              Authorization: `Bearer ${token}`,
              Origin: 'https://attacker.example',
            },
          })
        ).status,
      ).toBe(401)

      const response = await fetch(apiUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Origin: studioUrl.origin,
        },
      })
      expect(response.status).toBe(200)
      expect(response.headers.get('content-security-policy')).toContain(
        "default-src 'none'",
      )
      expect(response.headers.get('referrer-policy')).toBe('no-referrer')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')

      await page.goto(url)
      await page.waitForURL((current) => !current.searchParams.has('token'))
      expect(new URL(page.url()).searchParams.has('token')).toBe(false)
      await page.reload()
      await page.getByText('secure-local-session', { exact: true }).waitFor()
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 30_000)

  test('Studio requires an explicit remote host and prints a security warning', async () => {
    const project = await createStudioProject('explicit-remote-access')
    const child = Bun.spawn({
      cmd: [
        fixture.pickleCommand,
        'studio',
        '--no-open',
        '--remote',
        '0.0.0.0',
      ],
      cwd: project,
      env: Bun.env,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = collectStream(child.stdout)
    const stderr = collectStream(child.stderr)
    try {
      const url = await stdout.waitFor(
        /Studio (http:\/\/0\.0\.0\.0:\d+\S*)/,
        10_000,
      )
      expect(new URL(url).hostname).toBe('0.0.0.0')
      expect(
        await stderr.waitFor(/(Remote Studio access is enabled[^\n]+)/, 10_000),
      ).toContain('session token')
    } finally {
      child.kill()
      await child.exited
    }
  }, 20_000)

  test('Studio workflows have no automated WCAG 2.2 AA violations', async () => {
    const project = await createStudioProject('accessible-workflows')
    const { child, url } = await startStudio(project)
    const context = await browser.newContext()
    const page = await context.newPage()
    const consoleErrors: string[] = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    try {
      await page.goto(url)
      await page.getByText('accessible-workflows', { exact: true }).waitFor()

      for (const [areaIndex, area] of [
        'Specifications',
        'Runs',
        'Settings',
      ].entries()) {
        await page.goto(url)
        await page.getByText('accessible-workflows', { exact: true }).waitFor()
        for (let tabIndex = 0; tabIndex <= areaIndex; tabIndex++) {
          await page.keyboard.press('Tab')
        }
        const activeLink = await page.evaluate(() => {
          const browser = globalThis as unknown as BrowserDocument
          return {
            label: browser.document.activeElement?.textContent?.trim(),
            focusVisible:
              browser.document.activeElement?.matches(':focus-visible'),
          }
        })
        expect(activeLink).toEqual({ label: area, focusVisible: true })
        await page.keyboard.press('Enter')
        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
          .analyze()
        expect(results.violations).toEqual([])
      }
      await page.goto(url)
      await page.getByRole('button', { name: 'Runs', exact: true }).click()
      const historyResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(historyResults.violations).toEqual([])
      await page.keyboard.press('Meta+k')
      await page.getByRole('dialog', { name: 'Studio commands' }).waitFor()
      const paletteResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(paletteResults.violations).toEqual([])
      expect(consoleErrors).toEqual([])
    } finally {
      await context.close()
      child.kill()
      await child.exited
    }
  }, 45_000)

  test('keyboard focus stays visible and live results do not reorder under interaction', async () => {
    const project = await createStudioProject('stable-live-focus')
    const releaseFailure = join(project, 'release-failure.txt')
    await Bun.write(
      join(project, 'features', 'checkout.feature'),
      `@pickle:id:speccheckaaaaaaaa @pickle:state:active
Feature: Checkout
  @pickle:id:scnreviewccccccc
  Scenario: Review the purchase
    Then the basket is reviewed
  @pickle:id:scnpaybbbbbbbbbb
  Scenario: Pay for the order
    Then payment is captured
  @pickle:id:scnpassdddddddd
  Scenario: Complete a purchase
    Then the purchase succeeds
`,
    )
    const { child, url } = await startStudio(project, {
      PICKLE_STUDIO_RELEASE_FAILURE: releaseFailure,
      PICKLE_STUDIO_INITIAL_FAILURE: 'true',
    })
    const page = await browser.newPage()
    try {
      await page.goto(url)
      const run = page.getByRole('button', { name: 'Run Specification' })
      await tabTo(page, run)
      expect(
        await run.evaluate((element) => element.matches(':focus-visible')),
      ).toBe(true)
      await page.keyboard.press('Enter')

      const attention = page.getByRole('list', { name: 'Needs attention' })
      const focusedFailure = attention.getByRole('button', {
        name: /Review the purchase.*failed/,
      })
      await focusedFailure.waitFor()
      await tabTo(page, focusedFailure)
      expect(
        await attention.getByRole('listitem').first().textContent(),
      ).toContain('Review the purchase')

      await Bun.write(releaseFailure, 'continue')
      await attention
        .getByRole('button', { name: /Pay for the order.*failed/ })
        .waitFor()
      expect(
        await focusedFailure.evaluate((element) => element.matches(':focus')),
      ).toBe(true)
      expect(
        await attention.getByRole('listitem').first().textContent(),
      ).toContain('Review the purchase')
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 45_000)

  test('reduced-motion users can review core results on a smaller screen', async () => {
    const project = await createStudioProject('responsive-result-review')
    const gate = join(project, 'continue.txt')
    const { child, url } = await startStudio(project, {
      PICKLE_STUDIO_CONTINUE: gate,
    })
    const context = await browser.newContext({
      reducedMotion: 'reduce',
      viewport: { width: 390, height: 844 },
    })
    const page = await context.newPage()
    try {
      await page.goto(url)
      await page.keyboard.press('Meta+k')
      const palette = page.getByRole('dialog', { name: 'Studio commands' })
      await palette.waitFor()
      const paletteBounds = await palette.boundingBox()
      expect(paletteBounds).not.toBeNull()
      if (!paletteBounds) throw new Error('Expected command palette bounds')
      expect(paletteBounds.width).toBeLessThanOrEqual(390)
      expect(
        await palette.evaluate(
          (element) => element.getAnimations({ subtree: true }).length,
        ),
      ).toBe(0)
      await page.keyboard.press('Escape')
      const run = page.getByRole('button', { name: 'Run Specification' })
      await tabTo(page, run)
      await page.keyboard.press('Enter')
      await page.getByRole('status').filter({ hasText: 'running' }).waitFor()
      expect(
        await page
          .locator('html')
          .evaluate(
            (element) => element.getAnimations({ subtree: true }).length,
          ),
      ).toBe(0)

      await Bun.write(gate, 'continue')
      await page
        .getByRole('status')
        .filter({ hasText: 'failed' })
        .waitFor({ timeout: 20_000 })
      const timeline = page.getByRole('list', {
        name: 'Execution timeline',
      })
      expect(await timeline.textContent()).toContain('Payment was declined')
      const timelineResults = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze()
      expect(timelineResults.violations).toEqual([])
      const scenarioLayout = await page
        .getByRole('table', { name: 'Scenarios' })
        .locator('..')
        .evaluate((element) => ({
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
          parentClientWidth: element.parentElement?.clientWidth,
          parentScrollWidth: element.parentElement?.scrollWidth,
        }))
      expect(scenarioLayout.scrollWidth).toBeLessThanOrEqual(
        scenarioLayout.clientWidth,
      )
      expect(scenarioLayout.parentScrollWidth).toBe(
        scenarioLayout.parentClientWidth,
      )
    } finally {
      await context.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Studio virtualizes large Specification collections', async () => {
    const project = await createStudioProject('large-specifications')
    await Promise.all(
      Array.from({ length: 250 }, (_, index) => {
        const suffix = String(index).padStart(3, '0')
        return Bun.write(
          join(project, 'features', `fixture-${suffix}.feature`),
          `@pickle:state:active
Feature: Fixture ${suffix}
  Scenario: Review fixture ${suffix}
    Then fixture ${suffix} is available
`,
        )
      }),
    )
    const { child, url } = await startStudio(project)
    const page = await browser.newPage()
    try {
      await page.goto(url)
      const catalog = page.getByRole('navigation', {
        name: 'Specifications',
      })
      const collection = catalog.getByRole('list')
      await collection.getByRole('button', { name: 'Checkout' }).waitFor()
      expect(await collection.getByRole('button').count()).toBeLessThan(60)
      expect(
        await collection.getByRole('button', { name: 'Fixture 249' }).count(),
      ).toBe(0)

      await collection.getByRole('button', { name: 'Checkout' }).focus()
      await page.keyboard.press('End')
      const finalSpecification = collection.getByRole('button', {
        name: 'Fixture 249',
      })
      await finalSpecification.waitFor()
      expect(
        await finalSpecification.evaluate((element) =>
          element.matches(':focus'),
        ),
      ).toBe(true)
      expect(await collection.getByRole('button').count()).toBeLessThan(60)
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 45_000)

  test('Studio virtualizes large run and reviewed-result collections', async () => {
    const project = await createStudioProject('large-run-history')
    await createLargeHistory(project)
    const configPath = join(project, 'pickle.config.jsonc')
    const config = await Bun.file(configPath).json()
    await Bun.write(
      configPath,
      JSON.stringify({ ...config, retention: { days: 1 } }),
    )
    const { child, url } = await startStudio(project)
    const page = await browser.newPage()
    try {
      const response = await page.goto(url)
      expect(response?.status()).toBe(200)
      await page.getByText('large-run-history', { exact: true }).waitFor()
      await page.getByRole('button', { name: 'Runs', exact: true }).click()
      const history = page.getByRole('table', { name: 'Test run history' })
      const largeRun = history.getByRole('row').filter({
        hasText: 'run-large-results',
      })
      await largeRun.waitFor()
      expect(await history.getByRole('row').count()).toBeLessThan(60)

      const filterMenu = page.locator('[data-slot="dropdown-menu-content"]')
      await history.getByRole('checkbox').first().check()
      await page.getByRole('button', { name: 'State: All' }).focus()
      await page.keyboard.press('Enter')
      await filterMenu.getByText('passed', { exact: true }).click()
      expect(new URL(page.url()).searchParams.get('state')).toBe('passed')
      expect(
        await page
          .getByRole('button', { name: 'Compare selected runs' })
          .isDisabled(),
      ).toBe(true)

      await page.getByRole('button', { name: 'Specification: All' }).click()
      await filterMenu.getByText('Checkout', { exact: true }).click()
      expect(new URL(page.url()).searchParams.get('specification')).toBe(
        'features/checkout.feature',
      )
      await page.getByRole('button', { name: 'Target: All' }).click()
      await filterMenu.getByText('chrome', { exact: true }).click()
      expect(new URL(page.url()).searchParams.get('profile')).toBe('chrome')
      await page.getByRole('button', { name: 'Suite: All' }).click()
      await filterMenu.getByText('large-results', { exact: true }).click()
      expect(new URL(page.url()).searchParams.get('suite')).toBe(
        'large-results',
      )

      const searchRuns = page.getByRole('searchbox', { name: 'Search Runs' })
      await searchRuns.fill('run-large-results')
      expect(new URL(page.url()).searchParams.get('q')).toBe(
        'run-large-results',
      )
      expect(await history.getByRole('row').count()).toBe(2)
      await page.reload()
      await searchRuns.waitFor()
      expect(await searchRuns.inputValue()).toBe('run-large-results')
      await largeRun.waitFor()
      await page.goBack()
      expect(new URL(page.url()).pathname).toBe('/')
      await page.goForward()
      await largeRun.waitFor()
      await page.getByRole('button', { name: 'Clear filters' }).click()
      expect(new URL(page.url()).pathname).toBe('/runs')
      expect(new URL(page.url()).search).toBe('')

      const historyScroller = page.getByRole('region', {
        name: 'Scrollable test run history',
      })
      await tabTo(page, historyScroller)
      await page.keyboard.press('End')
      await history.getByText('run-000').waitFor()
      expect(await history.getByRole('row').count()).toBeLessThan(60)
      await page.keyboard.press('Home')
      await largeRun.waitFor()

      const reviewRun = largeRun.getByRole('button', { name: 'Review run' })
      await tabTo(page, reviewRun)
      await page.keyboard.press('Enter')
      const results = page.getByRole('table', { name: 'Test run results' })
      await results.getByText('Scenario 000').waitFor()
      expect(await results.getByRole('row').count()).toBeLessThan(60)

      const resultScroller = page.getByRole('region', {
        name: 'Scrollable test run results',
      })
      await tabTo(page, resultScroller)
      await page.keyboard.press('End')
      await results.getByText('Scenario 249').waitFor()
      expect(await results.getByRole('row').count()).toBeLessThan(60)

      const backToRuns = page.getByRole('button', { name: 'Back to Runs' })
      await tabTo(page, backToRuns)
      await page.keyboard.press('Enter')
      const deleteEligible = page.getByRole('button', {
        name: 'Delete eligible runs',
      })
      await tabTo(page, deleteEligible)
      await page.keyboard.press('Enter')
      await page.getByText('No Test runs have been recorded yet.').waitFor()
      expect(await history.count()).toBe(0)
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)
}

async function tabTo(page: Page, target: ReturnType<Page['locator']>) {
  for (let index = 0; index < 500; index++) {
    await page.keyboard.press('Tab')
    if (await target.evaluate((element) => element.matches(':focus'))) {
      return
    }
  }
  throw new Error('Keyboard focus did not reach the target')
}

async function createLargeHistory(project: string) {
  const historySize = 150
  let nextRun = 0
  const store = openTestRunStore({
    root: project,
    createId() {
      const index = nextRun++
      return index === historySize
        ? 'run-large-results'
        : `run-${String(index).padStart(3, '0')}`
    },
    now() {
      return new Date(Date.UTC(2026, 0, 1, 0, 0, nextRun))
    },
  })

  for (let index = 0; index < historySize; index++) {
    const run = await store.create({ suite: 'large-history' })
    await run.append(largeScenarioFinished(index))
    await run.materialize()
  }

  const largeRun = await store.create({ suite: 'large-results' })
  for (let index = 0; index < 250; index++) {
    await largeRun.append({
      ...largeScenarioFinished(index),
      scheduleIndex: index,
    })
  }
  await largeRun.materialize()
}

function largeScenarioFinished(index: number) {
  const suffix = String(index).padStart(3, '0')
  const scenario = { id: `scenario-${suffix}`, name: `Scenario ${suffix}` }
  const executionTargetProfile = { id: 'chrome', adapter: 'custom' }
  const startedAt = '2026-01-01T00:00:00.000Z'
  const durationMs = index + 1
  const finishedAt = new Date(Date.parse(startedAt) + durationMs).toISOString()
  return {
    type: 'scenario-finished' as const,
    specification: {
      name: 'Checkout',
      uri: 'features/checkout.feature',
    },
    scenario,
    executionTargetProfile,
    scope: {
      scenarioId: scenario.id,
      executionTargetProfileId: executionTargetProfile.id,
      attempt: 1,
    },
    attempt: {
      attempt: 1,
      startedAt,
      finishedAt,
      durationMs,
      state: 'passed' as const,
      steps: [],
      executionMode: 'adaptive' as const,
      cacheOutcome: 'uncacheable' as const,
      inferenceCount: 0,
      evidenceAvailability: [
        { kind: 'screenshot', state: 'not-supported' },
        { kind: 'trace', state: 'not-supported' },
        { kind: 'recording', state: 'not-supported' },
        { kind: 'device-log', state: 'not-supported' },
        { kind: 'diagnostics', state: 'not-supported' },
      ],
    },
  } satisfies RunEventPayload
}
