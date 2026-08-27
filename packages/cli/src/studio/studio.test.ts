import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  type ExecutionCacheEnvelope,
  type ExecutionCachePayloadValidator,
  openLocalExecutionCache,
  resolveLocalProjectStorage,
  serializeExecutionCacheEnvelope,
} from '@pickle-spec/runner'
import type { Browser, Page } from 'playwright'
import { StudioBrowserFixture } from '../../test/studio-browser-fixture'
import { registerStudioHardeningTests } from '../../test/studio-hardening-suite'

type TestRunManifestFile = {
  finishedAt?: string
}

type HistoryIndexPayload = {
  runs: Array<{ specificationUris: string[] }>
  activeRunIds: string[]
}

type RunRequestPayload = {
  paths?: string[]
  profiles?: string[]
  scenarioId?: string
}

type BrowserViewportHost = {
  document: {
    documentElement: { clientWidth: number; scrollWidth: number }
    querySelector: (
      selector: string,
    ) => { clientWidth: number; scrollWidth: number } | null
  }
  innerWidth: number
}

type MonacoEditorHost = {
  monaco?: {
    editor: {
      getEditors: () => Array<{
        getValue: () => string
        setValue: (value: string) => void
        focus: () => void
        setPosition: (position: { lineNumber: number; column: number }) => void
        getModel: () => {
          getLineCount: () => number
          getLineMaxColumn: (lineNumber: number) => number
        } | null
        trigger: (source: string, handlerId: string, payload: unknown) => void
      }>
    }
  }
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 20_000
  while (!(await Bun.file(path).exists())) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`)
    await Bun.sleep(25)
  }
}

async function expectBusyRunControl(page: Page, name: string) {
  const control = page.getByRole('button', { name, exact: true })
  await control.locator('[data-slot="spinner"]').waitFor()
  expect(await control.getAttribute('aria-busy')).toBe('true')
}

async function startCacheRefresh(page: Page) {
  await page.keyboard.press('Meta+k')
  const palette = page.getByRole('dialog', { name: 'Studio commands' })
  await palette.waitFor()
  await palette
    .getByRole('option')
    .filter({ hasText: 'Refresh cache for Checkout' })
    .click()
}

async function waitForScenarioResult(page: Page, name: string) {
  await page
    .getByRole('table', { name: 'Scenarios' })
    .getByRole('button', { name, exact: true })
    .first()
    .waitFor({ timeout: 20_000 })
}

async function expectRunningStatusCleared(page: Page) {
  const running = page.getByRole('status').filter({ hasText: 'running' })
  await running.waitFor({ state: 'hidden', timeout: 20_000 })
  expect(await running.count()).toBe(0)
}

async function saveExecutionTargetProfile(
  page: Page,
  profileId: string,
): Promise<void> {
  const responsePromise = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === '/api/config' &&
      response.request().method() === 'PUT',
  )
  await page
    .getByRole('button', { name: 'Save execution target profile' })
    .click()
  const response = await responsePromise
  await response.finished()
  if (!response.ok()) {
    throw new Error(`Profile update failed with status ${response.status()}`)
  }
  await page
    .getByRole('dialog')
    .filter({ hasText: 'Execution target profile saved' })
    .filter({ hasText: `${profileId} is ready for Test runs.` })
    .last()
    .waitFor({ timeout: 10_000 })
}

describe('Studio browser seam', () => {
  const fixture = new StudioBrowserFixture()
  const createStudioProject = fixture.createProject.bind(fixture)
  const startStudio = fixture.start.bind(fixture)
  let browser: Browser

  beforeAll(async () => {
    await fixture.setup()
    browser = fixture.browser
  }, 120_000)

  afterAll(async () => {
    await fixture.teardown()
  }, 15_000)

  registerStudioHardeningTests(fixture)

  test('pickle studio starts a local application and opens the configured project', async () => {
    const project = await createStudioProject('opened-project')
    await Bun.write(
      join(project, 'features', 'search.feature'),
      `@pickle:id:specsearchaaaaaaa @pickle:state:active
Feature: Search
  @pickle:id:scnquerybbbbbbbb
  Scenario: Query the catalog
    Then results are shown`,
    )
    const { child, url } = await startStudio(project)
    const page = await browser.newPage()
    try {
      await page.route('**/api/project', async (route) => {
        await Bun.sleep(500)
        await route.continue()
      })
      await page.goto(url)
      await page.getByRole('status', { name: 'Opening project' }).waitFor()
      expect(
        await page.evaluate(async () => (await fetch('/api/plans')).status),
      ).toBe(404)
      expect(
        await page.getByText('opened-project', { exact: true }).textContent(),
      ).toBe('opened-project')
      expect(
        await page
          .getByRole('button', { name: 'Specifications', exact: true })
          .count(),
      ).toBe(1)
      expect(
        await page.getByRole('button', { name: 'Runs', exact: true }).count(),
      ).toBe(1)
      expect(await page.getByRole('button', { name: 'History' }).count()).toBe(
        0,
      )
      expect(
        await page.getByRole('button', { name: 'View runs' }).count(),
      ).toBe(0)
      expect(await page.getByRole('button', { name: 'Settings' }).count()).toBe(
        1,
      )
      expect(
        await page
          .getByRole('button', { name: 'Settings', disabled: true })
          .count(),
      ).toBe(0)
      expect(
        await page.getByRole('status').filter({ hasText: 'Ready' }).count(),
      ).toBe(0)
      const catalog = page.getByRole('navigation', { name: 'Specifications' })
      expect(
        await catalog.getByRole('button', { name: 'Checkout' }).count(),
      ).toBe(1)
      expect(
        await catalog.getByRole('button', { name: 'Search' }).count(),
      ).toBe(1)
      expect(
        await page.getByRole('heading', { name: 'Checkout' }).count(),
      ).toBe(1)
      expect(
        await page.getByRole('button', { name: 'Run Specification' }).count(),
      ).toBe(1)
      expect(
        await page.getByRole('button', { name: 'Refresh cache' }).count(),
      ).toBe(0)
      expect(
        await page.getByRole('button', { name: 'Start test run' }).count(),
      ).toBe(0)
      expect(
        await page.getByRole('heading', { name: 'Needs attention' }).count(),
      ).toBe(0)
      const scenarios = page.getByRole('table', { name: 'Scenarios' })
      expect(
        await scenarios.getByRole('columnheader', { name: 'chrome' }).count(),
      ).toBe(1)
      expect(
        await scenarios.getByRole('columnheader', { name: 'firefox' }).count(),
      ).toBe(1)
      expect(
        await scenarios
          .getByRole('rowheader', { name: 'Pay for the order' })
          .count(),
      ).toBe(1)
      expect(
        await page
          .getByRole('button', { name: 'Run Scenario Pay for the order' })
          .count(),
      ).toBe(1)
      expect(new URL(url).hostname).toBe('127.0.0.1')
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Studio command palette navigates, selects a run target, and starts contextual work', async () => {
    const project = await createStudioProject('command-palette')
    await Bun.write(
      join(project, 'features', 'search.feature'),
      `@pickle:id:specsearchaaaaaaa @pickle:state:active
Feature: Search
  @pickle:id:scnquerybbbbbbbb
  Scenario: Query the catalog
    Then results are shown`,
    )
    const { child, url } = await startStudio(project)
    const page = await browser.newPage()
    try {
      await page.goto(url)
      await page.getByRole('heading', { name: 'Checkout' }).waitFor()

      await page.keyboard.press('Meta+k')
      const palette = page.getByRole('dialog', { name: 'Studio commands' })
      const search = page.locator('[data-slot="command-input"]')
      await palette.waitFor()
      await search.fill('query catalog')
      await palette
        .getByRole('option')
        .filter({ hasText: 'Query the catalog' })
        .click()

      await page.getByRole('heading', { name: 'Search' }).waitFor()
      const scenarioRow = page
        .getByRole('table', { name: 'Scenarios' })
        .getByRole('row')
        .filter({ hasText: 'Query the catalog' })
      expect(
        await scenarioRow.evaluate((element) => element.matches(':focus')),
      ).toBe(true)
      expect(await scenarioRow.getAttribute('data-state')).toBe('selected')
      expect(new URL(page.url()).pathname).toBe('/')

      const trigger = page.getByRole('button', {
        name: 'Open Studio commands',
      })
      await trigger.click()
      expect(await search.inputValue()).toBe('')
      await page.keyboard.press('Escape')
      expect(
        await trigger.evaluate((element) => element.matches(':focus')),
      ).toBe(true)

      await page.keyboard.press('Control+k')
      await search.fill('profile firefox')
      await page.keyboard.press('ArrowDown')
      await page.keyboard.press('Enter')
      await page.getByText('Target: firefox', { exact: true }).waitFor()

      await page.keyboard.press('Meta+k')
      await search.fill('run scenario query')
      const runRequestPromise = page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname === '/api/runs' &&
          request.method() === 'POST',
      )
      const runResponsePromise = page.waitForResponse(
        (response) =>
          new URL(response.url()).pathname === '/api/runs' &&
          response.request().method() === 'POST',
      )
      await palette
        .getByRole('option')
        .filter({ hasText: 'Run Scenario Query the catalog' })
        .click()
      const runRequest = await runRequestPromise
      expect(runRequest.postDataJSON() as RunRequestPayload).toEqual({
        paths: ['features/search.feature'],
        profiles: ['firefox'],
        scenarioId: 'scnquerybbbbbbbb',
      })
      const runResponse = await runResponsePromise
      const started = (await runResponse.json()) as { id: string }

      await page.keyboard.press('Meta+k')
      await search.fill('all profiles')
      await palette.getByRole('option', { name: 'All profiles' }).click()
      await page.getByText('Target: All profiles', { exact: true }).waitFor()

      await page.keyboard.press('Meta+k')
      await search.fill(started.id)
      await palette
        .getByRole('option', { name: new RegExp(started.id) })
        .click()
      expect(new URL(page.url()).pathname).toBe(
        `/runs/${encodeURIComponent(started.id)}`,
      )

      await page.keyboard.press('Meta+k')
      await search.fill('Specification Checkout')
      await palette
        .getByRole('option')
        .filter({ hasText: 'features/checkout.feature' })
        .click()
      const checkoutHeading = page.getByRole('heading', { name: 'Checkout' })
      await checkoutHeading.waitFor()
      expect(
        await checkoutHeading.evaluate((element) => element.matches(':focus')),
      ).toBe(true)
      expect(new URL(page.url()).pathname).toBe('/')
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Studio submits an explicit contextual cache refresh request through Cmd+K', async () => {
    const project = await createStudioProject('refresh-cache')
    const { child, url } = await startStudio(project)
    const page = await browser.newPage()
    try {
      await page.goto(url)
      await page.getByRole('heading', { name: 'Checkout' }).waitFor()
      expect(
        await page.getByRole('button', { name: 'Refresh cache' }).count(),
      ).toBe(0)
      const requestPromise = page.waitForRequest(
        (request) =>
          new URL(request.url()).pathname === '/api/runs' &&
          request.method() === 'POST',
      )
      await startCacheRefresh(page)
      const request = await requestPromise

      expect(request.postDataJSON()).toEqual({
        paths: ['features/checkout.feature'],
        refreshCache: true,
      })
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 30_000)

  test('Studio refreshes adaptively and atomically publishes a replacement cache revision', async () => {
    const project = await createStudioProject('refresh-cache-lifecycle')
    const cacheRoot = join(fixture.workspace, 'refresh-cache-root')
    const blockRefresh = join(project, 'block-refresh')
    const refreshStarted = join(project, 'refresh-started')
    const releaseRefresh = join(project, 'release-refresh')
    const payloadVersion = join(project, 'payload-version')
    const configPath = join(project, 'pickle.config.jsonc')
    const config = await Bun.file(configPath).json()
    await Bun.write(
      configPath,
      JSON.stringify({
        ...config,
        applicationRevision: 'app-1',
        executionTargetProfiles: {
          deterministic: { adapter: 'custom' },
        },
      }),
    )
    await Bun.write(payloadVersion, 'v1')
    await Bun.write(
      join(project, 'pickle.extensions.ts'),
      `
export default {
  adapter: {
    executionCache: {
      adapterKind: 'studio-refresh-test',
      adapterCacheSchemaVersion: '1',
      targetConfigurationFingerprint: 'target-1',
      parse(payload) {
        if (!payload || typeof payload !== 'object') return undefined
        if (!Array.isArray(payload.operations)) return undefined
        return payload
      },
      prefixStepCount(payload) {
        return payload.operations.length
      },
    },
    async openSession(input) {
      return {
        async executeStep(_step, signal) {
          if (
            input.mode === 'adaptive' &&
            await Bun.file(${JSON.stringify(blockRefresh)}).exists()
          ) {
            await Bun.write(${JSON.stringify(refreshStarted)}, 'started')
            while (!(await Bun.file(${JSON.stringify(releaseRefresh)}).exists())) {
              if (signal?.aborted) {
                throw new DOMException('Scenario cancelled', 'AbortError')
              }
              await Bun.sleep(10)
            }
          }
          return { state: 'passed', resolvedActions: [] }
        },
        async complete() {
          return {
            inferenceCount: input.mode === 'adaptive' ? 1 : 0,
            replayRepresentation: {
              cacheable: true,
              adapterPayload: {
                operations: [await Bun.file(${JSON.stringify(payloadVersion)}).text()],
              },
              requiredVariables: [],
            },
          }
        },
        async close() {},
      }
    },
  },
}
`,
    )
    const cache = await openLocalExecutionCache({
      projectRoot: project,
      cacheRoot,
    })
    const { child, url } = await startStudio(project, {
      PICKLE_CACHE_ROOT: cacheRoot,
    })
    const page = await browser.newPage()
    try {
      let readinessRequestCount = 0
      await page.route('**/api/run-readiness', async (route) => {
        readinessRequestCount += 1
        if (readinessRequestCount === 2) await Bun.sleep(200)
        await route.continue()
      })
      await page.goto(url)
      const running = page.getByRole('status').filter({ hasText: 'running' })
      await page.getByRole('button', { name: 'Run Specification' }).click()
      await running.waitFor()
      await waitForScenarioResult(
        page,
        'Complete a purchase deterministic passed',
      )
      await expectRunningStatusCleared(page)
      const before = (await cache.inspect())[0]
      expect(before).toBeDefined()
      if (!before) throw new Error('Initial cache revision was not published')
      const beforeSource = await cache.read(before.key)
      expect(beforeSource).toContain('v1')

      await Bun.write(payloadVersion, 'v2')
      await Bun.write(blockRefresh, 'block')
      await startCacheRefresh(page)
      await running.waitFor()
      await waitForScenarioResult(
        page,
        'Pay for the order deterministic running',
      )
      await waitForFile(refreshStarted)
      const during = (await cache.inspect()).find(
        (entry) => entry.payloadDigest === before.payloadDigest,
      )
      expect(during?.sourceRunId).toBe(before.sourceRunId)
      expect(await cache.read(before.key)).toBe(beforeSource)

      await Bun.write(releaseRefresh, 'release')
      await waitForScenarioResult(
        page,
        'Pay for the order deterministic passed',
      )
      await expectRunningStatusCleared(page)
      const after = (await cache.inspect()).find(
        (entry) => entry.key.scenarioId === before.key.scenarioId,
      )
      expect(after?.sourceRunId).not.toBe(before.sourceRunId)
      expect(await cache.read(before.key)).toContain('v2')

      await page.getByRole('button', { name: 'Runs', exact: true }).click()
      await page
        .getByRole('table', { name: 'Test run history' })
        .getByRole('row')
        .nth(1)
        .getByRole('button', { name: 'Review run' })
        .click()
      await page.getByRole('table', { name: 'Test run results' }).waitFor()
      expect(await page.getByText('adaptive').count()).toBeGreaterThan(0)
      expect(await page.getByText('refresh').count()).toBeGreaterThan(0)
      expect(await page.getByText('3 inferences').count()).toBeGreaterThan(0)
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Settings inspects metadata and confirms clearing the local Execution cache', async () => {
    const project = await createStudioProject('execution-cache-settings')
    const cacheRoot = join(fixture.workspace, 'execution-cache-root')
    const configPath = join(project, 'pickle.config.jsonc')
    const config = await Bun.file(configPath).json()
    await Bun.write(
      configPath,
      JSON.stringify({ ...config, cache: { maxBytes: 4_096 } }),
    )
    const cache = await openLocalExecutionCache({
      projectRoot: project,
      cacheRoot,
    })
    type CachePayload = { operation: 'fill'; variable: string }
    const validator: ExecutionCachePayloadValidator<CachePayload> = {
      adapterKind: 'test',
      adapterCacheSchemaVersion: 'test.1',
      parse(payload) {
        return payload as CachePayload
      },
      prefixStepCount() {
        return 1
      },
    }
    const envelope: ExecutionCacheEnvelope<CachePayload> = {
      schemaVersion: 1,
      key: {
        projectKey: cache.projectKey,
        scenarioId: 'scenario-checkout',
        scenarioRevision: 'scenario-v1',
        executionTargetProfileId: 'chrome',
        targetConfigurationFingerprint: 'target-v1',
        applicationRevision: 'application-v1',
        adapterKind: 'test',
        adapterCacheSchemaVersion: 'test.1',
      },
      requiredVariables: ['runtime_password'],
      adapterPayload: { operation: 'fill', variable: 'runtime_password' },
    }
    await cache.write(serializeExecutionCacheEnvelope(envelope, validator), {
      sourceRunId: 'run-1',
      evaluationInferenceCount: 1,
    })

    const { child, url } = await startStudio(project, {
      PICKLE_CACHE_ROOT: cacheRoot,
    })
    const page = await browser.newPage()
    try {
      await page.goto(url)
      await page.getByRole('button', { name: 'Settings' }).click()
      const revisions = page.getByRole('table', {
        name: 'Execution cache revisions',
      })
      await revisions.waitFor()
      const text = await revisions.textContent()
      expect(text).toContain('scenario-checkout')
      expect(text).toContain('scenario-v1')
      expect(text).toContain('application-v1')
      expect(text).toContain('test.1')
      expect(text).toContain('chrome')
      expect(text).toContain('0')
      expect(await page.textContent('body')).not.toContain('runtime_password')
      expect(await page.textContent('body')).not.toContain('adapterPayload')

      await page.route('**/api/execution-cache', async (route) => {
        if (route.request().method() === 'DELETE') {
          await route.fulfill({ status: 500, body: 'Cache clear failed' })
          return
        }
        await route.continue()
      })
      await page.getByRole('button', { name: 'Clear Execution cache' }).click()
      const confirmation = page.getByRole('dialog', {
        name: 'Clear Execution cache?',
      })
      await confirmation.waitFor()
      await confirmation.getByRole('button', { name: 'Clear cache' }).click()
      await confirmation
        .getByRole('alert')
        .filter({ hasText: 'Cache clear failed' })
        .waitFor()
      expect(await confirmation.isVisible()).toBe(true)

      await page.unroute('**/api/execution-cache')
      await confirmation.getByRole('button', { name: 'Clear cache' }).click()
      await page
        .getByRole('status')
        .filter({ hasText: 'No cached replay revisions' })
        .waitFor()
      await page
        .getByRole('dialog')
        .filter({ hasText: 'Execution cache cleared' })
        .filter({ hasText: 'Cleared 1 cache revision.' })
        .waitFor()
      expect(await cache.inspect()).toEqual([])
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 30_000)

  test('Settings exposes accessible cache loading, error, retry, and empty states', async () => {
    const project = await createStudioProject('execution-cache-states')
    const { child, url } = await startStudio(project, {
      PICKLE_CACHE_ROOT: join(fixture.workspace, 'empty-cache-root'),
    })
    const page = await browser.newPage()
    let releaseRequest = () => {}
    const requestGate = new Promise<void>((resolve) => {
      releaseRequest = resolve
    })
    try {
      await page.route('**/api/execution-cache', async (route) => {
        await requestGate
        await route.fulfill({ status: 500, body: 'Cache inspection failed' })
      })
      await page.goto(url)
      await page.getByRole('button', { name: 'Settings' }).click()
      await page
        .getByRole('status')
        .filter({ hasText: 'Loading Execution cache' })
        .waitFor()
      releaseRequest()
      await page
        .getByRole('alert')
        .filter({ hasText: 'Cache inspection failed' })
        .waitFor()

      await page.unroute('**/api/execution-cache')
      await page.getByRole('button', { name: 'Retry' }).click()
      await page
        .getByRole('status')
        .filter({ hasText: 'No cached replay revisions' })
        .waitFor()
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 30_000)

  test('Studio starts a web test run and diagnoses live results', async () => {
    const project = await createStudioProject('live-diagnosis')
    const marker = join(project, 'step-started.txt')
    const gate = join(project, 'continue.txt')
    const { child, url } = await startStudio(project, {
      PICKLE_STUDIO_STEP_MARKER: marker,
      PICKLE_STUDIO_CONTINUE: gate,
    })
    const page = await browser.newPage()
    try {
      await page.goto(url)
      await page.getByRole('button', { name: 'Run Specification' }).click()
      const running = page.getByRole('status').filter({ hasText: 'running' })
      await running.waitFor()
      expect(await running.locator('[data-slot="spinner"]').count()).toBe(0)
      await expectBusyRunControl(page, 'Run Specification')
      await page.getByRole('button', { name: 'Cancel test run' }).waitFor()
      await page
        .getByRole('button', { name: 'Pay for the order chrome running' })
        .waitFor()
      expect(
        await page
          .getByRole('button', { name: 'Pay for the order chrome running' })
          .locator('[data-slot="spinner"]')
          .count(),
      ).toBe(0)
      expect(await finishedManifestCount(project)).toBe(0)
      await Bun.write(gate, 'continue')
      await waitForScenarioResult(page, 'Pay for the order chrome failed')
      await expectRunningStatusCleared(page)
      const failedResult = page.getByRole('button', {
        name: 'Pay for the order chrome failed',
      })
      expect(await failedResult.locator('svg').count()).toBe(1)
      const attention = page.getByRole('list', { name: 'Needs attention' })
      const items = attention.getByRole('listitem')
      expect(await items.count()).toBe(1)
      expect(await items.nth(0).textContent()).toContain('Pay for the order')
      expect(await items.nth(0).textContent()).toContain('failed')
      expect(await items.nth(0).textContent()).toContain('Inspect result')
      await page
        .getByRole('heading', {
          name: 'Pay for the order · chrome',
        })
        .waitFor()
      expect(
        await page
          .getByRole('tab', { name: 'Timeline' })
          .getAttribute('aria-selected'),
      ).toBe('true')
      const timeline = page.getByRole('list', { name: 'Execution timeline' })
      expect(await timeline.textContent()).toContain('Then payment is captured')
      expect(await timeline.textContent()).toContain('Payment was declined')
      expect(await timeline.textContent()).not.toContain('Run event')
      expect(
        await page.getByRole('list', { name: 'Timeline legend' }).count(),
      ).toBe(1)
      expect(
        await page.getByRole('img', { name: 'Execution time ruler' }).count(),
      ).toBe(1)
      const selectedEvidence = page.getByRole('region', {
        name: 'Selected timeline evidence',
      })
      const selectedStep = timeline.getByRole('button', {
        name: /Step Then payment is captured/,
      })
      await page.getByRole('tab', { name: 'Timeline' }).focus()
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      await page.keyboard.press('Tab')
      expect(
        await selectedStep.evaluate((element) =>
          element.matches(':focus-visible'),
        ),
      ).toBe(true)
      const diagnosticEntry = timeline.getByRole('button', {
        name: /Diagnostic entry Payment was declined/,
      })
      await diagnosticEntry.focus()
      await page.keyboard.press('Enter')
      expect(await diagnosticEntry.getAttribute('aria-pressed')).toBe('true')
      expect(await selectedEvidence.textContent()).toContain(
        'Payment was declined',
      )
      const artifactEntry = timeline.getByRole('button', {
        name: /Test artifact screenshot/,
      })
      await artifactEntry.click()
      expect(await artifactEntry.getAttribute('aria-pressed')).toBe('true')
      expect(await selectedEvidence.textContent()).toContain(
        'Recorded at step completion',
      )
      await page.getByRole('button', { name: 'Resume following' }).click()
      expect(
        await timeline
          .getByRole('button', { name: /Step Then payment is captured/ })
          .getAttribute('aria-pressed'),
      ).toBe('true')
      await timeline.dispatchEvent('wheel')
      expect(
        await timeline
          .getByRole('button', { name: /Step Then payment is captured/ })
          .getAttribute('aria-pressed'),
      ).toBe('true')
      expect(
        await page.getByRole('button', { name: 'Resume following' }).count(),
      ).toBe(1)
      await page.getByRole('switch', { name: 'Verbose timeline' }).click()
      expect(await timeline.textContent()).toContain('Run event')
      await page.setViewportSize({ width: 390, height: 844 })
      const timelineChart = page.getByRole('region', {
        name: 'Execution timeline chart',
      })
      const chartBox = await timelineChart.boundingBox()
      const detailBox = await selectedEvidence.boundingBox()
      expect(chartBox).not.toBeNull()
      expect(detailBox).not.toBeNull()
      expect(detailBox!.y).toBeGreaterThanOrEqual(
        chartBox!.y + chartBox!.height - 1,
      )
      const timelineContainment = await page.evaluate(() => {
        const browser = globalThis as unknown as BrowserViewportHost
        const viewport = browser.document.querySelector(
          '[data-slot="scroll-area-viewport"]',
        )
        return {
          pageClientWidth: browser.document.documentElement.clientWidth,
          pageScrollWidth: browser.document.documentElement.scrollWidth,
          timelineClientWidth: viewport?.clientWidth ?? 0,
          timelineScrollWidth: viewport?.scrollWidth ?? 0,
        }
      })
      expect(timelineContainment.pageScrollWidth).toBeLessThanOrEqual(
        timelineContainment.pageClientWidth,
      )
      expect(timelineContainment.timelineScrollWidth).toBeGreaterThan(
        timelineContainment.timelineClientWidth,
      )
      const timeRulerViewport = page.getByRole('region', {
        name: 'Scrollable execution time ruler',
      })
      const horizontalScrollbar = timelineChart.locator(
        '[data-slot="scroll-area-scrollbar"][data-orientation="horizontal"]',
      )
      const scrollbarBox = await horizontalScrollbar.boundingBox()
      expect(scrollbarBox).not.toBeNull()
      expect(scrollbarBox!.height).toBeGreaterThanOrEqual(8)
      await timeRulerViewport.focus()
      await page.keyboard.press('End')
      await page.waitForTimeout(100)
      expect(
        await timeRulerViewport.evaluate((element) => element.scrollLeft),
      ).toBeGreaterThan(0)
      const scenarios = page.getByRole('table', { name: 'Scenarios' })
      expect(
        await scenarios.getByRole('columnheader', { name: 'chrome' }).count(),
      ).toBe(1)
      expect(
        await scenarios.getByRole('columnheader', { name: 'firefox' }).count(),
      ).toBe(1)
      expect(
        await scenarios
          .getByRole('rowheader', { name: 'Pay for the order' })
          .count(),
      ).toBe(1)
      expect(
        await scenarios
          .getByRole('rowheader', { name: 'Review the purchase' })
          .count(),
      ).toBe(1)
      expect(
        await scenarios
          .getByRole('rowheader', { name: 'Complete a purchase' })
          .count(),
      ).toBe(1)
      await page
        .getByRole('button', { name: 'Pay for the order chrome failed' })
        .click()
      expect(await timeline.textContent()).toContain('Then payment is captured')
      expect(await timeline.textContent()).toContain('Payment was declined')
      await page.getByRole('tab', { name: 'Artifacts' }).click()
      expect(await page.getByRole('img', { name: /screenshot/ }).count()).toBe(
        1,
      )
      await page.getByRole('tab', { name: 'Diagnostics' }).click()
      expect(
        await page.getByText('Payment was declined').count(),
      ).toBeGreaterThan(0)
      await page.getByRole('tab', { name: 'Overview' }).click()
      expect(await page.getByText('Scenario attempt').count()).toBeGreaterThan(
        0,
      )
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Studio discovers mobile targets and runs a deterministic web, Android, and iOS matrix', async () => {
    const project = await createStudioProject('mobile-target-matrix')
    const screenshot = join(project, 'failure.png')
    const sessionMarker = join(project, 'mobile-session-opened')
    await Bun.write(
      join(project, 'pickle.config.jsonc'),
      JSON.stringify({
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        concurrency: 3,
        artifacts: { capture: 'always' },
        executionTargetProfiles: {
          web: { adapter: 'custom', capabilities: ['screenshots'] },
          android: {
            adapter: 'mobile',
            capabilities: ['android', 'screenshots', 'device-logs'],
            mobile: {
              executionTarget: 'android-emulator',
              application: {
                id: 'com.example.checkout',
                binaryPath: '/apps/checkout.apk',
              },
            },
          },
          ios: {
            adapter: 'mobile',
            capabilities: ['ios', 'screenshots'],
            mobile: {
              executionTarget: 'ios-simulator',
              application: {
                id: 'com.example.checkout',
                binaryPath: '/apps/Checkout.app',
              },
            },
          },
        },
      }),
    )
    await Bun.write(
      join(project, 'pickle.extensions.ts'),
      `
const adapter = (configuredProfile) => ({
  capabilities: ['android', 'ios', 'screenshots'],
  async discoverTargets() {
    return [{
      id: configuredProfile === 'android'
        ? 'emulator-5554'
        : 'simulator-iphone-16',
      name: configuredProfile === 'android'
        ? 'Pixel 9 API 35'
        : 'iPhone 16 Pro',
      state: 'booted',
      capabilities: [configuredProfile, 'screenshots'],
    }]
  },
  async openSession(input) {
    await Bun.write(${JSON.stringify(sessionMarker)}, 'opened')
    return {
      async executeStep(step) {
        const profile = input.executionTargetProfile.id
        return {
          state: 'passed',
          resolvedActions: [{
            description: profile === 'web'
              ? 'Click checkout in the browser'
              : \`Tap checkout on \${profile}\`,
          }],
          artifacts: profile === 'web' ? undefined : [{
            kind: 'screenshot',
            path: ${JSON.stringify(screenshot)},
            mediaType: 'image/png',
          }],
        }
      },
      async close() {},
    }
  },
})

export default {
  adapters: {
    web: adapter('web'),
    android: adapter('android'),
    ios: adapter('ios'),
  },
}
`,
    )
    const { child, url } = await startStudio(project)
    const page = await browser.newPage()
    try {
      await page.route('**/api/mobile-targets', async (route) => {
        await route.fulfill({
          contentType: 'application/json',
          body: JSON.stringify([
            {
              profileId: 'android',
              executionTarget: 'android-emulator',
              targets: [
                {
                  id: 'emulator-5554',
                  name: 'Pixel 9 API 35',
                  state: 'booted',
                  capabilities: ['android', 'screenshots'],
                },
              ],
            },
            {
              profileId: 'ios',
              executionTarget: 'ios-simulator',
              targets: [
                {
                  id: 'simulator-iphone-16',
                  name: 'iPhone 16 Pro',
                  state: 'booted',
                  capabilities: ['ios', 'screenshots'],
                },
              ],
            },
          ]),
        })
      })
      await page.goto(url)
      await page.getByRole('button', { name: 'Run Specification' }).click()
      await page
        .getByRole('alert')
        .filter({ hasText: 'lacks configured capabilities: device-logs' })
        .waitFor()
      expect(await Bun.file(sessionMarker).exists()).toBe(false)
      await page.getByRole('button', { name: 'Settings' }).click()
      await page.getByRole('button', { name: 'android' }).click()
      expect(await page.getByLabel('Mobile application id').inputValue()).toBe(
        'com.example.checkout',
      )
      expect(
        await page.getByLabel('Mobile application binary path').inputValue(),
      ).toBe('/apps/checkout.apk')
      await page.getByLabel('Profile capabilities').fill('android, screenshots')
      await page
        .getByRole('button', { name: 'Discover mobile targets' })
        .click()
      await page
        .getByRole('button', { name: 'Pixel 9 API 35 · booted' })
        .click()
      expect(await page.getByLabel('Mobile target id').inputValue()).toBe(
        'emulator-5554',
      )
      await page.getByRole('button', { name: 'Android Emulator' }).click()
      expect(await page.getByLabel('Mobile target id').inputValue()).toBe(
        'emulator-5554',
      )
      await page.getByRole('button', { name: 'iOS Simulator' }).click()
      expect(await page.getByLabel('Mobile target id').inputValue()).toBe('')
      await page.getByRole('button', { name: 'Android Emulator' }).click()
      await page.getByLabel('Mobile target id').fill('emulator-5554')
      await page.getByLabel('Mobile target id').fill('')
      await saveExecutionTargetProfile(page, 'android')
      expect(
        await Bun.file(join(project, 'pickle.config.jsonc')).text(),
      ).not.toContain('targetId')
      await page
        .getByRole('button', { name: 'Discover mobile targets' })
        .click()
      await page
        .getByRole('button', { name: 'Pixel 9 API 35 · booted' })
        .click()
      await saveExecutionTargetProfile(page, 'android')
      const savedConfig = await Bun.file(
        join(project, 'pickle.config.jsonc'),
      ).text()
      expect(savedConfig).toContain('emulator-5554')
      expect(savedConfig).not.toContain('secret')

      await page.getByRole('button', { name: 'Specifications' }).click()
      await page.getByRole('button', { name: 'Run Specification' }).click()
      const scenarios = page.getByRole('table', { name: 'Scenarios' })
      for (const profile of ['web', 'android', 'ios']) {
        await scenarios
          .getByRole('button', {
            name: `Pay for the order ${profile} passed`,
          })
          .waitFor({ timeout: 20_000 })
      }
      await scenarios
        .getByRole('button', { name: 'Pay for the order android passed' })
        .click()
      await page.getByRole('tab', { name: 'Timeline' }).click()
      const timeline = page.getByRole('list', {
        name: 'Execution timeline',
      })
      expect(await timeline.textContent()).toContain('Then payment is captured')
      await page.getByRole('tab', { name: 'Artifacts' }).click()
      expect(await page.getByRole('img', { name: /screenshot/ }).count()).toBe(
        1,
      )
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Studio manages immutable history and portable runs', async () => {
    const project = await createStudioProject('run-history')
    await Bun.write(
      join(project, 'features', 'search.feature'),
      `@pickle:id:specsearchaaaaaaa @pickle:state:active
Feature: Search
  @pickle:id:scnquerybbbbbbbb
  Scenario: Query the catalog
    Then results are shown`,
    )
    const configPath = join(project, 'pickle.config.jsonc')
    const config = await Bun.file(configPath).json()
    await Bun.write(
      configPath,
      JSON.stringify({
        ...config,
        applicationRevision: 'app-42',
        retention: { days: 14, maxBytes: 1 },
      }),
    )
    const { child, url } = await startStudio(project)
    const page = await browser.newPage()
    const pageErrors: string[] = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    try {
      await page.goto(url)
      await page.getByRole('button', { name: 'Run Specification' }).click()
      await waitForScenarioResult(page, 'Pay for the order chrome failed')
      await page.getByRole('button', { name: 'Run Specification' }).waitFor({
        timeout: 20_000,
      })
      const indexedHistory = await page.evaluate(async () => {
        const response = await fetch('/api/runs')
        return response.json() as Promise<HistoryIndexPayload>
      })
      expect(indexedHistory.runs[0]?.specificationUris).toEqual([
        'features/checkout.feature',
      ])
      await page.getByRole('button', { name: 'Runs', exact: true }).click()

      const history = page.getByRole('table', { name: 'Test run history' })
      await history.waitFor()
      expect(await history.getByRole('row').count()).toBe(2)
      const run = history.getByRole('row').nth(1)
      expect(await run.textContent()).toContain('Ad hoc selection')
      expect(await run.textContent()).toContain('chrome, firefox')
      expect(await run.textContent()).toContain('failed')
      expect(await run.textContent()).toContain('6 results')

      await page
        .getByRole('button', { name: 'Specifications', exact: true })
        .click()
      await page.getByRole('button', { name: 'Search' }).click()
      await page.getByRole('button', { name: 'Runs', exact: true }).click()
      await page.getByRole('button', { name: 'Specification: All' }).click()
      await page.getByRole('menuitemradio', { name: 'Search' }).click()
      await page.getByText('No Test runs match these filters.').waitFor()
      expect(
        await page.getByRole('table', { name: 'Test run history' }).count(),
      ).toBe(0)
      expect(new URL(page.url()).pathname).toBe('/runs')
      expect(new URL(page.url()).searchParams.get('specification')).toBe(
        'features/search.feature',
      )
      await page
        .getByRole('button', { name: 'Specifications', exact: true })
        .click()
      await page.getByRole('button', { name: 'Checkout' }).click()
      await page.getByRole('button', { name: 'Runs', exact: true }).click()
      await page.getByRole('button', { name: 'Specification: All' }).click()
      await page.getByRole('menuitemradio', { name: 'Checkout' }).click()
      await history.waitFor()

      await run.getByRole('button', { name: 'Rerun failures' }).click()
      await history.getByRole('row').nth(2).waitFor({ timeout: 20_000 })
      expect(await history.getByRole('row').count()).toBe(3)
      expect(await history.getByRole('row').nth(1).textContent()).toContain(
        'Rerun of',
      )

      const comparisonSelection = history.getByRole('checkbox')
      await comparisonSelection.nth(0).click()
      await comparisonSelection.nth(1).click()
      await page.getByRole('button', { name: 'Compare selected runs' }).click()
      const comparison = page.getByRole('table', { name: 'Run comparison' })
      expect(await comparison.textContent()).toContain('Pay for the order')
      expect(await comparison.textContent()).toContain('chrome')

      await history
        .getByRole('row')
        .nth(2)
        .getByRole('button', { name: 'Review run' })
        .click()
      const results = page.getByRole('table', { name: 'Test run results' })
      await page.getByText('app-42').waitFor()
      expect(await results.textContent()).toContain('Pay for the order')
      expect(await results.textContent()).toContain('adaptive')
      expect(await results.textContent()).toContain('uncacheable')
      expect(await results.textContent()).toContain('0 inferences')
      expect(
        await results
          .getByRole('columnheader', { name: 'Uncacheable reason' })
          .count(),
      ).toBe(1)
      expect(
        await results.getByRole('button', { name: 'Rerun Scenario' }).count(),
      ).toBeGreaterThan(0)
      expect(
        await results.getByRole('button', { name: 'Rerun target' }).count(),
      ).toBeGreaterThan(0)
      const failedResult = results
        .getByRole('row')
        .filter({ hasText: 'Pay for the order' })
        .filter({ hasText: 'chrome' })
        .first()
      await failedResult.getByRole('button', { name: 'Inspect result' }).click()
      await page
        .getByRole('heading', {
          name: 'Pay for the order · chrome',
        })
        .waitFor()
      expect(new URL(page.url()).pathname).toMatch(
        /^\/runs\/[^/]+\/results\/scnpaybbbbbbbbbb\/chrome\/1$/,
      )
      expect(
        await page
          .getByRole('tab', { name: 'Timeline' })
          .getAttribute('aria-selected'),
      ).toBe('true')
      const evidenceTimeline = page.getByRole('list', {
        name: 'Execution timeline',
      })
      const timelineText = await evidenceTimeline.textContent()
      expect(timelineText).toContain('Step')
      expect(timelineText).not.toContain('Run event')
      expect(timelineText).toContain('Diagnostic entry')
      expect(timelineText).toContain('Test artifact')
      expect(timelineText).toContain('Failure context')
      await page.getByRole('switch', { name: 'Verbose timeline' }).click()
      expect(await evidenceTimeline.textContent()).toContain('Run event')
      await page.getByRole('tab', { name: 'Artifacts' }).click()
      expect(
        await page
          .getByRole('img', {
            name: 'screenshot from failed result for Pay for the order: Then payment is captured',
          })
          .count(),
      ).toBe(1)
      expect(
        await page.getByRole('link', { name: 'Download screenshot' }).count(),
      ).toBe(1)
      expect(await page.getByText('image/png').count()).toBeGreaterThan(0)
      const deepLink = page.url()
      await page.route('**/api/runs/*', async (route) => {
        if (route.request().method() === 'GET') await Bun.sleep(500)
        await route.continue()
      })
      await page.reload()
      await page.getByRole('status', { name: 'Opening Test result' }).waitFor()
      await page
        .getByRole('heading', {
          name: 'Pay for the order · chrome',
        })
        .waitFor()
      await page.unroute('**/api/runs/*')
      expect(page.url()).toBe(deepLink)
      await page.getByRole('button', { name: 'Back to run' }).click()
      await results.waitFor()
      const passedResult = results
        .getByRole('row')
        .filter({ hasText: 'Complete a purchase' })
        .filter({ hasText: 'chrome' })
        .first()
      await passedResult.getByRole('button', { name: 'Inspect result' }).click()
      expect(
        await page
          .getByRole('tab', { name: 'Overview' })
          .getAttribute('aria-selected'),
      ).toBe('true')
      await page.getByRole('button', { name: 'Back to run' }).click()
      await results.waitFor()
      await results
        .getByRole('button', { name: 'Rerun Scenario' })
        .first()
        .click()
      await history.getByRole('row').nth(3).waitFor({ timeout: 20_000 })
      await history.getByText('2 results').first().waitFor({ timeout: 20_000 })
      expect(await history.getByRole('row').nth(1).textContent()).toContain(
        '2 results',
      )
      await history
        .getByRole('row')
        .filter({ hasText: '6 results' })
        .first()
        .getByRole('button', { name: 'Review run' })
        .click()
      const targetResults = page.getByRole('table', {
        name: 'Test run results',
      })
      await targetResults
        .getByRole('button', { name: 'Rerun target' })
        .first()
        .click()
      await history.getByRole('row').nth(4).waitFor({ timeout: 20_000 })
      await history.getByText('3 results').first().waitFor({ timeout: 20_000 })
      expect(await history.getByRole('row').nth(1).textContent()).toContain(
        '3 results',
      )

      expect(await page.getByText('14 days · 1 B').count()).toBe(1)
      await history
        .getByRole('row')
        .filter({ hasText: '6 results' })
        .first()
        .getByRole('button', { name: 'Review run' })
        .click()
      const exportButton = page.locator('[data-slot="dropdown-menu-trigger"]')
      await exportButton.click()
      await Bun.sleep(100)
      expect(pageErrors).toEqual([])
      const exportMenu = page.locator('[data-slot="dropdown-menu-content"]')
      await exportMenu.waitFor()
      expect(await exportMenu.getAttribute('role')).toBe('menu')
      const defaultHtmlHref = await exportMenu
        .getByRole('menuitem', { name: 'HTML report' })
        .getAttribute('href')
      const allureHref = await page
        .getByRole('menuitem', { name: 'Allure results' })
        .getAttribute('href')
      const archiveHref = await page
        .getByRole('menuitem', { name: 'Run archive' })
        .getAttribute('href')
      await page.keyboard.press('Home')
      expect(
        await exportMenu
          .getByRole('menuitem', { name: 'Run archive' })
          .getAttribute('data-highlighted'),
      ).not.toBeNull()
      await page.keyboard.press('ArrowDown')
      expect(
        await exportMenu
          .getByRole('menuitem', { name: 'HTML report' })
          .getAttribute('data-highlighted'),
      ).not.toBeNull()
      const allureResponse = await page.evaluate(async (href) => {
        const response = await fetch(href!)
        return {
          contentType: response.headers.get('content-type'),
          signature: [
            ...new Uint8Array(await response.arrayBuffer()).slice(0, 4),
          ],
        }
      }, allureHref)
      expect(allureResponse).toEqual({
        contentType: 'application/zip',
        signature: [0x50, 0x4b, 0x03, 0x04],
      })
      const defaultHtml = await page.evaluate(
        async (href) => (await fetch(href!)).text(),
        defaultHtmlHref,
      )
      expect(defaultHtml).toContain('<!DOCTYPE html>')
      expect(defaultHtml).toContain('data:image/png;base64,')
      await page.keyboard.press('Escape')
      await page
        .getByRole('checkbox', { name: 'Include all artifacts' })
        .click()
      await exportButton.click()
      expect(
        await page
          .getByRole('menuitem', { name: 'HTML report' })
          .getAttribute('href'),
      ).toContain('artifacts=all')
      await page.keyboard.press('Escape')

      const archivePath = join(project, 'importable-run.json')
      const archive = JSON.parse(
        await page.evaluate(
          async (href) => (await fetch(href!)).text(),
          archiveHref,
        ),
      )
      archive.manifest.id = 'run-imported'
      for (const event of archive.events) {
        if (event.type === 'run-started') event.run.id = 'run-imported'
      }
      const importBytes = `${JSON.stringify(archive, null, 2)}\n`
      await Bun.write(archivePath, importBytes)
      await page.getByRole('button', { name: 'Back to Runs' }).click()
      await page.getByLabel('Import run archive').setInputFiles(archivePath)
      await history.getByText('run-imported').waitFor({ timeout: 20_000 })
      await page
        .getByRole('dialog')
        .filter({ hasText: 'Test run imported' })
        .filter({ hasText: 'run-imported is now available in Runs.' })
        .waitFor()
      expect(
        await Bun.file(
          join(
            resolveLocalProjectStorage(project).archivesDirectory,
            'run-imported.json',
          ),
        ).text(),
      ).toBe(importBytes)

      const pin = history.getByRole('button', { name: 'Pin' }).first()
      await pin.hover()
      await page
        .getByRole('tooltip')
        .filter({ hasText: 'Protect this Test run from retention deletion.' })
        .waitFor()
      await pin.focus()
      await page.keyboard.press('Space')
      await history.getByRole('button', { name: 'Unpin' }).waitFor()
      const pinnedToast = page
        .getByRole('dialog')
        .filter({ hasText: 'Test run pinned' })
        .filter({ hasText: 'protected from retention deletion.' })
      await pinnedToast.waitFor()
      await pinnedToast.waitFor({ state: 'detached' })

      await page.getByRole('button', { name: 'Delete eligible runs' }).click()
      await page.getByText(/Deleted \d+ local Test runs/).waitFor()
      expect(
        await Bun.file(
          join(
            resolveLocalProjectStorage(project).archivesDirectory,
            'run-imported.json',
          ),
        ).text(),
      ).toBe(importBytes)
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Studio reruns one durable Scenario when names repeat', async () => {
    const project = await createStudioProject('scenario-rerun-identity')
    await Bun.write(
      join(project, 'features', 'checkout.feature'),
      `@pickle:id:speccheckaaaaaaaa @pickle:state:active
Feature: Checkout
  @pickle:id:scnfirstbbbbbbbbb
  Scenario: Complete a purchase
    Then the first purchase succeeds
  @pickle:id:scnsecondcccccccc
  Scenario: Complete a purchase
    Then the second purchase succeeds
`,
    )
    const { child, url } = await startStudio(project)
    const page = await browser.newPage()
    try {
      await page.goto(url)
      await page.getByRole('button', { name: 'Run Specification' }).click()
      await waitForScenarioResult(page, 'Complete a purchase chrome passed')
      await page.getByRole('button', { name: 'Runs', exact: true }).click()
      const history = page.getByRole('table', { name: 'Test run history' })
      await history
        .getByRole('row')
        .nth(1)
        .getByRole('button', { name: 'Review run' })
        .click()
      const results = page.getByRole('table', { name: 'Test run results' })
      await results.waitFor()
      expect(await results.getByRole('row').count()).toBe(5)

      await results
        .getByRole('button', { name: 'Rerun Scenario' })
        .first()
        .click()
      await history.getByRole('row').nth(2).waitFor({ timeout: 20_000 })
      await history.getByText('2 results').waitFor({ timeout: 20_000 })
      expect(await history.getByRole('row').nth(1).textContent()).toContain(
        'Rerun of',
      )
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Studio cancels a live test run without starting another', async () => {
    const project = await createStudioProject('cancel-run')
    const marker = join(project, 'step-started.txt')
    const gate = join(project, 'continue.txt')
    const { child, url } = await startStudio(project, {
      PICKLE_STUDIO_STEP_MARKER: marker,
      PICKLE_STUDIO_CONTINUE: gate,
    })
    const page = await browser.newPage()
    try {
      await page.goto(url)
      await page.getByRole('button', { name: 'Run Specification' }).click()
      await page.getByRole('button', { name: 'Cancel test run' }).waitFor()
      await expectBusyRunControl(page, 'Run Specification')
      await waitForFile(marker)
      await page.getByRole('button', { name: 'Runs', exact: true }).click()
      const activeRuns = page.getByRole('heading', { name: 'Active Runs' })
      await activeRuns.waitFor()
      const activeRunId = await page.evaluate(async () => {
        const response = await fetch('/api/runs')
        const index = (await response.json()) as HistoryIndexPayload
        return index.activeRunIds[0]
      })
      expect(activeRunId).toBeDefined()
      if (!activeRunId) throw new Error('Expected an active Test run')
      expect(
        await page
          .getByRole('table', { name: 'Test run history' })
          .textContent(),
      ).not.toContain(activeRunId)
      await page.getByRole('button', { name: 'State: All' }).click()
      await page
        .getByRole('menuitemradio', { name: 'running', exact: true })
        .click()
      expect(new URL(page.url()).searchParams.get('state')).toBe('running')
      await page.reload()
      await activeRuns.waitFor()
      await page.keyboard.press('Meta+k')
      const palette = page.getByRole('dialog', { name: 'Studio commands' })
      await page.locator('[data-slot="command-input"]').fill(activeRunId)
      await palette
        .getByRole('option')
        .filter({ hasText: `Cancel Test run ${activeRunId}` })
        .click()
      await activeRuns.waitFor({ state: 'detached', timeout: 20_000 })
      await page
        .getByRole('button', { name: 'Specifications', exact: true })
        .click()
      await page.getByRole('button', { name: 'Run Specification' }).waitFor({
        timeout: 20_000,
      })
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Studio runs a single Scenario without the rest of the Specification', async () => {
    const project = await createStudioProject('single-scenario')
    const marker = join(project, 'step-started.txt')
    const gate = join(project, 'continue.txt')
    const { child, url } = await startStudio(project, {
      PICKLE_STUDIO_STEP_MARKER: marker,
      PICKLE_STUDIO_CONTINUE: gate,
    })
    const page = await browser.newPage()
    try {
      await page.goto(url)
      await page
        .getByRole('button', { name: 'Run Scenario Pay for the order' })
        .click()
      const running = page.getByRole('status').filter({ hasText: 'running' })
      await running.waitFor()
      await page
        .getByRole('button', { name: 'Pay for the order chrome running' })
        .waitFor()
      await Bun.write(gate, 'continue')
      await waitForScenarioResult(page, 'Pay for the order chrome failed')
      await expectRunningStatusCleared(page)
      const attention = page.getByRole('list', { name: 'Needs attention' })
      expect(await attention.getByRole('listitem').count()).toBe(1)
      expect(await attention.textContent()).toContain('Pay for the order')
      expect(await attention.textContent()).not.toContain('Review the purchase')
      const scenarios = page.getByRole('table', { name: 'Scenarios' })
      expect(await scenarios.textContent()).toContain('pending')
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Studio keeps view mode focused on Scenarios until Edit opens Gherkin with autocomplete', async () => {
    const project = await createStudioProject('author-specification')
    const { child, url } = await startStudio(project)
    const page = await browser.newPage()
    try {
      await page.goto(url)
      await page.getByRole('table', { name: 'Scenarios' }).waitFor()
      expect(
        await page
          .getByRole('region', { name: 'Specification outline' })
          .count(),
      ).toBe(0)
      expect(await page.getByLabel('Active model').count()).toBe(0)
      expect(
        await page.getByRole('button', { name: 'Show structure' }).count(),
      ).toBe(0)
      expect(
        await page
          .getByRole('region', { name: 'Specification metadata' })
          .count(),
      ).toBe(0)
      expect(await page.locator('.monaco-editor').count()).toBe(0)
      const runBox = await page
        .getByRole('button', { name: 'Run Specification' })
        .boundingBox()
      const editBox = await page
        .getByRole('button', { name: 'Edit Specification' })
        .boundingBox()
      expect(runBox).not.toBeNull()
      expect(editBox).not.toBeNull()
      expect(Math.abs((runBox?.y ?? 0) - (editBox?.y ?? 1))).toBeLessThan(1)
      const desktopViewport = page.viewportSize() ?? {
        width: 1280,
        height: 720,
      }
      await page.setViewportSize({ width: 390, height: 844 })
      const mobileRunBox = await page
        .getByRole('button', { name: 'Run Specification' })
        .boundingBox()
      const mobileEditBox = await page
        .getByRole('button', { name: 'Edit Specification' })
        .boundingBox()
      expect(mobileRunBox).not.toBeNull()
      expect(mobileEditBox).not.toBeNull()
      expect(mobileEditBox!.y).toBeGreaterThanOrEqual(mobileRunBox!.y)
      expect(mobileEditBox!.y - mobileRunBox!.y).toBeLessThanOrEqual(40)
      expect(
        await page.evaluate(() => {
          const browser = globalThis as unknown as BrowserViewportHost
          return (
            browser.document.documentElement.scrollWidth <= browser.innerWidth
          )
        }),
      ).toBe(true)
      await page.setViewportSize(desktopViewport)
      await page.getByRole('button', { name: 'Edit Specification' }).click()
      expect(
        await page.getByRole('navigation', { name: 'Specifications' }).count(),
      ).toBe(0)
      expect(await page.getByRole('button', { name: 'History' }).count()).toBe(
        0,
      )
      await page
        .getByRole('region', { name: 'Specification metadata' })
        .waitFor()
      await page.locator('.monaco-editor').waitFor()
      const current = await gherkinValue(page)
      expect(current).toContain('# keep this comment')
      expect(current).toContain('Feature: Checkout')
      await page.evaluate(() => {
        const editor = (
          globalThis as MonacoEditorHost
        ).monaco?.editor.getEditors()[0]
        const model = editor?.getModel()
        if (!editor || !model) return
        editor.setValue(`${editor.getValue()}\n    Gi`)
        const lineNumber = model.getLineCount()
        editor.setPosition({
          lineNumber,
          column: model.getLineMaxColumn(lineNumber),
        })
        editor.focus()
        editor.trigger('test', 'editor.action.triggerSuggest', {})
      })
      await page
        .locator('.suggest-widget.visible')
        .filter({ hasText: 'Given' })
        .waitFor()
      await setGherkinValue(
        page,
        current
          .replace('Feature: Checkout', 'Feature: Basket')
          .replace(
            'Then payment is captured',
            'Then payment is captured\n    And a receipt is shown',
          ),
      )
      await page.getByRole('button', { name: 'Save Specification' }).click()
      let written = ''
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        written = await Bun.file(
          join(project, 'features', 'checkout.feature'),
        ).text()
        if (written.includes('Feature: Basket')) break
        await Bun.sleep(50)
      }
      expect(written).toContain('# keep this comment')
      expect(written).toContain('Feature: Basket')
      expect(written).toContain('And a receipt is shown')
      await page.getByRole('button', { name: 'View Specification' }).click()
      await page.getByRole('navigation', { name: 'Specifications' }).waitFor()
      await page.getByRole('heading', { name: 'Basket', exact: true }).waitFor()
      expect(
        await page
          .getByRole('region', { name: 'Specification outline' })
          .count(),
      ).toBe(0)
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Studio reloads clean Specification buffers and reviews conflicts for edited buffers', async () => {
    const project = await createStudioProject('author-conflicts')
    const { child, url } = await startStudio(project)
    const page = await browser.newPage()
    try {
      await page.goto(url)
      await page.getByRole('button', { name: 'Edit Specification' }).waitFor()
      await Bun.write(
        join(project, 'features', 'checkout.feature'),
        `# keep this comment
@pickle:id:speccheckaaaaaaaa @pickle:state:active
Feature: Reloaded
  @pickle:id:scnpaybbbbbbbbbb
  Scenario: Pay for the order
    Then payment is captured
`,
      )
      await page.getByRole('button', { name: 'Edit Specification' }).click()
      await page.locator('.monaco-editor').waitFor()
      await waitForGherkinValue(page, 'Feature: Reloaded')
      expect(await gherkinValue(page)).toContain('Feature: Reloaded')
      await setGherkinValue(
        page,
        (await gherkinValue(page)).replace(
          'Feature: Reloaded',
          'Feature: Local edit',
        ),
      )
      await Bun.write(
        join(project, 'features', 'checkout.feature'),
        `# keep this comment
@pickle:id:speccheckaaaaaaaa @pickle:state:active
Feature: Disk edit
  @pickle:id:scnpaybbbbbbbbbb
  Scenario: Pay for the order
    Then payment is captured
`,
      )
      await page
        .getByRole('dialog', { name: 'Specification changed on disk' })
        .waitFor({
          timeout: 10_000,
        })
      expect(await gherkinValue(page)).toContain('Feature: Local edit')
      await page.getByRole('button', { name: 'Load from disk' }).click()
      await page
        .getByRole('dialog', { name: 'Specification changed on disk' })
        .waitFor({ state: 'hidden' })
      await waitForGherkinValue(page, 'Feature: Disk edit')
      expect(await gherkinValue(page)).toContain('Feature: Disk edit')
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Studio proposes AI Gherkin as a diff and writes accepted Specifications as drafts', async () => {
    const project = await createStudioProject('author-ai')
    const { child, url } = await startStudio(project)
    const page = await browser.newPage()
    try {
      await page.goto(url)
      expect(await page.getByLabel('Active model').count()).toBe(0)
      await page.getByRole('button', { name: 'Edit Specification' }).click()
      await page
        .getByRole('textbox', { name: 'AI prompt' })
        .fill('Search the catalog')
      await page
        .getByRole('textbox', { name: 'New Specification path' })
        .fill('features/search.feature')
      await page.getByRole('button', { name: 'Propose Specification' }).click()
      const dialog = page.getByRole('dialog', { name: 'Review AI proposal' })
      await dialog.waitFor()
      expect(
        await page.getByRole('region', { name: 'Source diff' }).textContent(),
      ).toContain('+Feature: Search')
      expect(
        await Bun.file(join(project, 'features', 'search.feature')).exists(),
      ).toBe(false)
      await page.getByRole('button', { name: 'Accept proposal' }).click()
      const createdDeadline = Date.now() + 10_000
      let created = false
      while (Date.now() < createdDeadline) {
        created = await Bun.file(
          join(project, 'features', 'search.feature'),
        ).exists()
        if (created) break
        await Bun.sleep(50)
      }
      expect(created).toBe(true)
      const written = await Bun.file(
        join(project, 'features', 'search.feature'),
      ).text()
      expect(written).toContain('@pickle:state:draft')
      expect(written).not.toContain('@pickle:state:active')
      await page.getByRole('button', { name: 'Search' }).click()
      await page.getByRole('heading', { name: 'Search', exact: true }).waitFor()
      expect(
        await page
          .getByRole('region', { name: 'Specification outline' })
          .count(),
      ).toBe(0)
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Studio edits Specification state, tags, and external links', async () => {
    const project = await createStudioProject('manage-metadata')
    const { child, url } = await startStudio(project)
    const page = await browser.newPage()
    try {
      await page.goto(url)
      expect(
        await page
          .getByRole('region', { name: 'Specification metadata' })
          .count(),
      ).toBe(0)
      expect(
        await page.getByRole('button', { name: 'Edit metadata' }).count(),
      ).toBe(0)
      await page.getByRole('button', { name: 'Edit Specification' }).click()
      await page
        .getByRole('region', { name: 'Specification metadata' })
        .waitFor()
      await setGherkinValue(
        page,
        (await gherkinValue(page)).replace(
          'Feature: Checkout',
          'Feature: Basket',
        ),
      )
      await page.getByRole('button', { name: 'Edit metadata' }).click()
      await page.getByRole('button', { name: 'draft', exact: true }).click()
      await page.getByLabel('Specification tags').fill('@checkout @regression')
      await page.getByLabel('Link namespace').fill('jira')
      await page.getByLabel('Link id').fill('PROJ-12')
      await page.getByRole('button', { name: 'Add link' }).click()
      await page.getByRole('button', { name: 'Apply metadata' }).click()
      expect(
        await page
          .getByRole('dialog', { name: 'Review Specification metadata' })
          .count(),
      ).toBe(0)
      expect(
        await Bun.file(join(project, 'features', 'checkout.feature')).text(),
      ).toContain('@pickle:state:active')
      await page.getByRole('button', { name: 'Save Specification' }).click()
      const deadline = Date.now() + 10_000
      let written = ''
      while (Date.now() < deadline) {
        written = await Bun.file(
          join(project, 'features', 'checkout.feature'),
        ).text()
        if (written.includes('@pickle:state:draft')) break
        await Bun.sleep(50)
      }
      expect(written).toContain('# keep this comment')
      expect(written).toContain('@pickle:state:draft')
      expect(written).not.toContain('@pickle:state:active')
      expect(written).toContain('@checkout')
      expect(written).toContain('@regression')
      expect(written).toContain('@jira:PROJ-12')
      expect(written).toContain('Feature: Basket')
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Studio creates named test suites and execution target profiles', async () => {
    const project = await createStudioProject('manage-config')
    const { child, url } = await startStudio(project)
    const page = await browser.newPage()
    try {
      await page.goto(url)
      await page.getByRole('button', { name: 'Settings' }).click()
      await page.getByRole('heading', { name: 'Test suites' }).waitFor()
      await page.getByLabel('Suite name').fill('smoke')
      await page.getByLabel('Suite paths').fill('features/**/*.feature')
      await page.getByLabel('Suite tag expression').fill('@smoke')
      await page.getByLabel('Suite states').fill('active, draft')
      await page.getByRole('button', { name: 'Save test suite' }).click()
      await page.getByRole('button', { name: 'New test suite' }).click()
      await page.getByLabel('Suite name').fill('checkout')
      await page.getByLabel('Suite paths').fill('features/checkout.feature')
      await page.getByRole('button', { name: 'Save test suite' }).click()
      await page.getByLabel('Profile id').fill('safari')
      await page.getByLabel('Profile adapter').fill('custom')
      await page.getByLabel('Profile capabilities').fill('geolocation')
      await page
        .getByRole('button', { name: 'Save execution target profile' })
        .click()
      const deadline = Date.now() + 10_000
      let config = ''
      while (Date.now() < deadline) {
        config = await Bun.file(join(project, 'pickle.config.jsonc')).text()
        if (
          config.includes('"smoke"') &&
          config.includes('"checkout"') &&
          config.includes('"safari"')
        )
          break
        await Bun.sleep(50)
      }
      expect(config).toContain('"smoke"')
      expect(config).toContain('"checkout"')
      expect(config).toContain('"tagExpression": "@smoke"')
      expect(config).toContain('"safari"')
      expect(config).toContain('"geolocation"')
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Studio withholds the test-run action until the selection is valid', async () => {
    const project = await createStudioProject('validate-run')
    await Bun.write(
      join(project, 'features', 'checkout.feature'),
      `# keep this comment
@pickle:id:speccheckaaaaaaaa @pickle:state:active
Feature: Checkout
  @pickle:id:scnpaybbbbbbbbbb @pickle:requires:geolocation
  Scenario: Pay for the order
    Then payment is captured
`,
    )
    const { child, url } = await startStudio(project)
    const page = await browser.newPage()
    try {
      let configUpdateCount = 0
      await page.route('**/api/config', async (route) => {
        if (route.request().method() === 'PUT' && configUpdateCount++ === 0) {
          await Bun.sleep(500)
        }
        await route.continue()
      })
      await page.goto(url)
      await page.getByRole('heading', { name: 'Checkout' }).waitFor()
      expect(
        await page.getByRole('button', { name: 'Run Specification' }).count(),
      ).toBe(0)
      expect(
        await page
          .getByRole('status')
          .filter({ hasText: 'geolocation' })
          .count(),
      ).toBeGreaterThan(0)
      await page.keyboard.press('Meta+k')
      const palette = page.getByRole('dialog', { name: 'Studio commands' })
      const search = page.locator('[data-slot="command-input"]')
      await search.fill('run checkout')
      expect(
        await palette
          .getByRole('option')
          .filter({ hasText: 'Run Checkout' })
          .getAttribute('aria-disabled'),
      ).toBe('true')
      await page.keyboard.press('Escape')
      await page.getByRole('button', { name: 'Settings' }).click()
      await page.getByRole('button', { name: 'chrome' }).click()
      await page.getByLabel('Profile capabilities').fill('geolocation')
      await saveExecutionTargetProfile(page, 'chrome')
      await page.getByRole('button', { name: 'firefox' }).click()
      await page.getByLabel('Profile capabilities').fill('geolocation')
      await saveExecutionTargetProfile(page, 'firefox')
      await page.getByRole('button', { name: 'Specifications' }).click()
      await page.getByRole('button', { name: 'Run Specification' }).waitFor({
        timeout: 20_000,
      })
      await page.keyboard.press('Meta+k')
      await search.fill('run checkout')
      expect(
        await palette
          .getByRole('option')
          .filter({ hasText: 'Run Checkout' })
          .getAttribute('aria-disabled'),
      ).toBe('false')
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Studio stores credentials in a keychain store and keeps references in project configuration', async () => {
    const project = await createStudioProject('manage-secrets')
    const keychain = join(project, 'keychain')
    const { child, url } = await startStudio(project, {
      PICKLE_KEYCHAIN_DIR: keychain,
    })
    const page = await browser.newPage()
    try {
      await page.goto(url)
      await page.getByRole('button', { name: 'Settings' }).click()
      await page.getByLabel('Credential name').fill('ANTHROPIC_API_KEY')
      await page.getByLabel('Credential secret').fill('sk-test-secret')
      await page.getByRole('button', { name: 'Save credential' }).click()
      await page.getByText('ANTHROPIC_API_KEY (present)').waitFor({
        timeout: 10_000,
      })
      const config = await Bun.file(join(project, 'pickle.config.jsonc')).text()
      expect(config).toContain('ANTHROPIC_API_KEY')
      expect(config).toContain('keychain')
      expect(config).not.toContain('sk-test-secret')
      expect(await Bun.file(join(keychain, 'ANTHROPIC_API_KEY')).text()).toBe(
        'sk-test-secret',
      )
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Studio shows Git diffs, commits after confirmation, and never pushes', async () => {
    const project = await createStudioProject('manage-git')
    const remote = join(fixture.workspace, 'manage-git-remote.git')
    await Bun.spawnSync({ cmd: ['git', 'init', '--bare', remote] })
    await Bun.spawnSync({
      cmd: ['git', 'init'],
      cwd: project,
    })
    await Bun.spawnSync({
      cmd: ['git', 'config', 'user.email', 'studio@example.test'],
      cwd: project,
    })
    await Bun.spawnSync({
      cmd: ['git', 'config', 'user.name', 'Studio Test'],
      cwd: project,
    })
    await Bun.spawnSync({
      cmd: ['git', 'add', 'features/checkout.feature', 'pickle.config.jsonc'],
      cwd: project,
    })
    await Bun.spawnSync({
      cmd: ['git', 'commit', '-m', 'initial'],
      cwd: project,
    })
    await Bun.spawnSync({
      cmd: ['git', 'remote', 'add', 'origin', remote],
      cwd: project,
    })
    await Bun.spawnSync({
      cmd: [
        'git',
        'remote',
        'add',
        'github',
        'git@github.com:example/pickle-spec.git',
      ],
      cwd: project,
    })
    const branch = currentGitBranch(project)
    await Bun.spawnSync({
      cmd: ['git', 'update-ref', `refs/remotes/github/${branch}`, 'HEAD'],
      cwd: project,
    })
    await Bun.spawnSync({
      cmd: ['git', 'branch', `--set-upstream-to=github/${branch}`],
      cwd: project,
    })
    await Bun.write(
      join(project, 'features', 'checkout.feature'),
      `# keep this comment
@pickle:id:speccheckaaaaaaaa @pickle:state:active
Feature: Basket
  @pickle:id:scnpaybbbbbbbbbb
  Scenario: Pay for the order
    Then payment is captured
`,
    )
    const ghLog = join(project, 'gh.log')
    const gh = join(project, 'bin', 'gh')
    await mkdir(join(project, 'bin'), { recursive: true })
    await Bun.write(
      gh,
      `#!/bin/sh
echo "$@" >> "$GH_LOG"
if echo " $* " | grep -q " push "; then exit 1; fi
if [ "$1" = "pr" ]; then
  echo "https://github.com/example/pickle-spec/pull/1"
  exit 0
fi
exit 0
`,
    )
    await Bun.spawnSync({ cmd: ['chmod', '+x', gh] })
    const { child, url } = await startStudio(project, {
      PATH: `${join(project, 'bin')}:${Bun.env.PATH ?? ''}`,
      GH_LOG: ghLog,
    })
    const page = await browser.newPage()
    try {
      await page.goto(url)
      await page.getByRole('button', { name: 'Settings' }).click()
      await page.getByRole('heading', { name: 'Repository' }).waitFor()
      const changed = page
        .getByRole('listitem')
        .filter({ hasText: 'features/checkout.feature' })
      await changed.waitFor()
      await changed.getByRole('button', { name: 'Show diff' }).click()
      expect(
        await changed
          .getByRole('region', { name: 'features/checkout.feature diff' })
          .textContent(),
      ).toContain('Basket')
      await changed
        .getByRole('checkbox', { name: 'features/checkout.feature' })
        .click()
      await page.getByRole('button', { name: 'Stage selected' }).click()
      await changed.getByText('staged').waitFor()
      await page.getByLabel('Commit message').fill('Update Checkout')
      await page
        .getByRole('button', { name: 'Commit selected changes' })
        .click()
      await page
        .getByRole('dialog', { name: 'Commit selected changes?' })
        .waitFor()
      await page.getByRole('button', { name: 'Confirm commit' }).click()
      const log = await waitForCommitMessage(project, 'Update Checkout')
      expect(log).toBe('Update Checkout')
      const remoteHeads = Bun.spawnSync({
        cmd: ['git', 'ls-remote', remote, 'HEAD'],
      })
      expect(remoteHeads.stdout.toString().trim()).toBe('')
      await page.getByRole('button', { name: 'Create pull request' }).click()
      const ghInvoked = await waitForFileContent(ghLog, 'pr create --web')
      expect(ghInvoked).toContain('pr create --web')
      expect(ghInvoked).not.toContain('push')
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)
})

async function gherkinValue(page: Page): Promise<string> {
  return page.evaluate(() => {
    const editor = (
      globalThis as MonacoEditorHost
    ).monaco?.editor.getEditors()[0]
    return editor?.getValue() ?? ''
  })
}

async function waitForGherkinValue(
  page: Page,
  expected: string,
): Promise<void> {
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    if ((await gherkinValue(page)).includes(expected)) return
    await Bun.sleep(50)
  }
}

function currentGitBranch(project: string): string {
  return (
    Bun.spawnSync({
      cmd: ['git', 'branch', '--show-current'],
      cwd: project,
    })
      .stdout.toString()
      .trim() || 'main'
  )
}

async function waitForCommitMessage(
  project: string,
  expected: string,
): Promise<string> {
  const deadline = Date.now() + 10_000
  let message = ''
  while (Date.now() < deadline) {
    message = Bun.spawnSync({
      cmd: ['git', 'log', '-1', '--pretty=%s'],
      cwd: project,
    })
      .stdout.toString()
      .trim()
    if (message === expected) return message
    await Bun.sleep(50)
  }
  return message
}

async function waitForFileContent(
  path: string,
  expected: string,
): Promise<string> {
  const deadline = Date.now() + 10_000
  let content = ''
  while (Date.now() < deadline) {
    if (await Bun.file(path).exists()) content = await Bun.file(path).text()
    if (content.includes(expected)) return content
    await Bun.sleep(50)
  }
  return content
}

async function setGherkinValue(page: Page, source: string) {
  await page.locator('.monaco-editor').waitFor()
  await page.evaluate((next) => {
    const editor = (
      globalThis as MonacoEditorHost
    ).monaco?.editor.getEditors()[0]
    editor?.setValue(next)
  }, source)
  await page.waitForFunction((expected) => {
    const editor = (
      globalThis as MonacoEditorHost
    ).monaco?.editor.getEditors()[0]
    return editor?.getValue() === expected
  }, source)
  await Bun.sleep(32)
}

async function finishedManifestCount(project: string): Promise<number> {
  const manifests = new Bun.Glob('*/manifest.json').scan({
    cwd: resolveLocalProjectStorage(project).runsDirectory,
    onlyFiles: true,
  })
  let finished = 0
  for await (const relativePath of manifests) {
    const manifest = (await Bun.file(
      join(resolveLocalProjectStorage(project).runsDirectory, relativePath),
    ).json()) as TestRunManifestFile
    if (manifest.finishedAt) finished++
  }
  return finished
}
