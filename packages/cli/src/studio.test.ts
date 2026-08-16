import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { type Browser, chromium, type Page } from 'playwright'

type CliPackageManifest = {
  bin: { pickle: string }
}

type TestRunManifestFile = {
  finishedAt?: string
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

describe('Studio browser seam', () => {
  let workspace: string
  let pickleCommand: string
  let browser: Browser

  async function createStudioProject(name: string): Promise<string> {
    const project = join(workspace, name)
    const screenshot = join(project, 'failure.png')
    await mkdir(join(project, 'features'), { recursive: true })
    await Bun.write(screenshot, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    await Bun.write(
      join(project, 'pickle.config.jsonc'),
      JSON.stringify({
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        links: {
          jira: 'https://example.test/browse/{id}',
        },
        executionTargetProfiles: {
          chrome: { adapter: 'custom' },
          firefox: { adapter: 'custom' },
        },
      }),
    )
    await Bun.write(
      join(project, 'features', 'checkout.feature'),
      `# keep this comment
@pickle:id:speccheckaaaaaaaa @pickle:state:active
Feature: Checkout
  @pickle:id:scnpaybbbbbbbbbb
  Scenario: Pay for the order
    Then payment is captured
  @pickle:id:scnadaptcccccccc
  Scenario: Adapt the purchase
    Then the basket adapts
  @pickle:id:scnpassdddddddd
  Scenario: Complete a purchase
    Then the purchase succeeds
`,
    )
    await Bun.write(
      join(project, 'pickle.extensions.ts'),
      `
export default {
  adapter: {
    async openSession(input) {
      return {
        async executeStep(step, signal) {
          const marker = process.env.PICKLE_STUDIO_STEP_MARKER
          const gate = process.env.PICKLE_STUDIO_CONTINUE
          if (marker && !(await Bun.file(marker).exists())) {
            await Bun.write(marker, 'started')
          }
          if (gate) {
            while (!(await Bun.file(gate).exists())) {
              if (signal?.aborted) {
                throw new DOMException('Scenario cancelled', 'AbortError')
              }
              await Bun.sleep(10)
            }
          }
          const profile = input.executionTargetProfile.id
          const scenario = input.scenario.name
          if (scenario === 'Pay for the order' && profile === 'chrome') {
            return {
              state: 'failed',
              message: 'Payment was declined',
              resolvedActions: [{ description: \`Click pay on \${profile}\` }],
              artifacts: [{
                kind: 'screenshot',
                path: ${JSON.stringify(screenshot)},
                mediaType: 'image/png',
              }],
            }
          }
          if (scenario === 'Adapt the purchase' && profile === 'chrome') {
            return {
              state: 'passed-with-adaptation',
              resolvedActions: [{
                description: \`Adapt basket on \${profile}\`,
                replay: { operation: 'adapt', target: 'current-basket' },
              }],
              artifacts: [{
                kind: 'screenshot',
                path: ${JSON.stringify(screenshot)},
                mediaType: 'image/png',
              }],
            }
          }
          return {
            state: 'passed',
            resolvedActions: [{ description: \`Complete \${scenario} on \${profile}\` }],
          }
        },
        async close() {},
      }
    },
  },
  async authorSpecification({ prompt }) {
    if (!String(prompt).includes('Search')) {
      throw new Error('AI assistance is unavailable')
    }
    return {
      source: \`@pickle:id:specsearchaaaaaaa @pickle:state:active
Feature: Search
  @pickle:id:scnquerybbbbbbbb
  Scenario: Query the catalog
    Then results are shown
\`,
    }
  },
}
`,
    )
    return project
  }

  async function startStudio(
    project: string,
    env: Record<string, string> = {},
  ) {
    const child = Bun.spawn({
      cmd: [pickleCommand, 'studio', '--no-open'],
      cwd: project,
      env: { ...Bun.env, ...env },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = collectStream(child.stdout)
    const stderr = collectStream(child.stderr)
    const url = await stdout.waitFor(
      /Studio (http:\/\/127\.0\.0\.1:\d+\S*)/,
      45_000,
    )
    return { child, url, stdout, stderr }
  }

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'pickle-spec-studio-'))
    const packageDirectory = resolve(import.meta.dir, '..')
    const packageManifest = (await Bun.file(
      join(packageDirectory, 'package.json'),
    ).json()) as CliPackageManifest
    pickleCommand = join(workspace, 'node_modules', '.bin', 'pickle')
    await mkdir(join(workspace, 'node_modules', '.bin'), { recursive: true })
    await symlink(
      resolve(packageDirectory, packageManifest.bin.pickle),
      pickleCommand,
    )
    browser = await chromium.launch({
      headless: true,
      channel: 'chrome',
      timeout: 60_000,
    })
  }, 60_000)

  afterAll(async () => {
    await browser?.close()
    await rm(workspace, { recursive: true, force: true })
  }, 15_000)

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
      await page.goto(url)
      expect(
        await page
          .getByRole('heading', { name: 'opened-project' })
          .textContent(),
      ).toBe('opened-project')
      expect(
        await page.getByRole('link', { name: 'Specifications' }).count(),
      ).toBe(1)
      expect(
        await page.getByRole('link', { name: 'Runs', disabled: true }).count(),
      ).toBe(1)
      expect(await page.getByRole('link', { name: 'Plans' }).count()).toBe(1)
      expect(
        await page.getByRole('link', { name: 'Plans', disabled: true }).count(),
      ).toBe(0)
      expect(await page.getByRole('link', { name: 'Settings' }).count()).toBe(1)
      expect(
        await page
          .getByRole('link', { name: 'Settings', disabled: true })
          .count(),
      ).toBe(0)
      expect(
        await page.getByRole('status').filter({ hasText: 'Ready' }).count(),
      ).toBe(1)
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
      expect(await running.locator('[data-slot="spinner"]').count()).toBe(1)
      await page.getByRole('button', { name: 'Cancel test run' }).waitFor()
      await page
        .getByRole('button', { name: 'Pay for the order chrome running' })
        .waitFor()
      expect(
        await page
          .getByRole('button', { name: 'Pay for the order chrome running' })
          .locator('[data-slot="spinner"]')
          .count(),
      ).toBe(1)
      expect(await finishedManifestCount(project)).toBe(0)
      await Bun.write(gate, 'continue')
      const failed = page.getByRole('status').filter({ hasText: 'failed' })
      await failed.waitFor({
        timeout: 20_000,
      })
      expect(await failed.locator('svg').count()).toBe(1)
      expect(
        await page
          .getByRole('button', { name: 'Pay for the order chrome failed' })
          .locator('svg')
          .count(),
      ).toBe(1)
      const attention = page.getByRole('list', { name: 'Needs attention' })
      const items = attention.getByRole('listitem')
      expect(await items.count()).toBe(2)
      expect(await items.nth(0).textContent()).toContain('Pay for the order')
      expect(await items.nth(0).textContent()).toContain('failed')
      expect(await items.nth(0).textContent()).toContain('Open step timeline')
      expect(await items.nth(1).textContent()).toContain('Adapt the purchase')
      expect(await items.nth(1).textContent()).toContain(
        'passed-with-adaptation',
      )
      const timeline = page.getByRole('list', { name: 'Step timeline' })
      expect(await timeline.textContent()).toContain('Then payment is captured')
      expect(await timeline.textContent()).toContain('Payment was declined')
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
          .getByRole('rowheader', { name: 'Adapt the purchase' })
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
      expect(await timeline.textContent()).toContain('Click pay on chrome')
      expect(await timeline.textContent()).toContain('Payment was declined')
      expect(await page.getByRole('img', { name: /screenshot/ }).count()).toBe(
        1,
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
      await page.getByRole('button', { name: 'Run Specification' }).waitFor({
        state: 'hidden',
      })
      await page.getByRole('button', { name: 'Cancel test run' }).click()
      await page.getByRole('button', { name: 'Run Specification' }).waitFor({
        timeout: 20_000,
      })
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Studio reviews evidence and explicitly promotes a candidate plan', async () => {
    const project = await createStudioProject('review-plans')
    const configPath = join(project, 'pickle.config.jsonc')
    const config = JSON.parse(await Bun.file(configPath).text())
    await Bun.write(
      configPath,
      JSON.stringify({
        ...config,
        applicationRevision: 'app-1',
        policy: { adaptedResults: 'reject' },
        executionTargetProfiles: { chrome: { adapter: 'custom' } },
      }),
    )
    const approvedPath = join(
      project,
      '.pickle',
      'plans',
      'chrome',
      'scnadaptcccccccc.json',
    )
    const candidatePath = join(
      project,
      '.pickle',
      'candidates',
      'chrome',
      'scnadaptcccccccc.json',
    )
    const approved = {
      schemaVersion: 1,
      scenarioId: 'scnadaptcccccccc',
      scenarioRevision: 'previous-revision',
      executionTargetProfileId: 'chrome',
      planFormatVersion: '1',
      applicationRevision: 'app-1',
      steps: [
        {
          resolvedActions: [
            {
              description: 'Adapt basket on chrome',
              replay: { operation: 'adapt', target: 'previous-basket' },
            },
          ],
        },
      ],
    }
    await Bun.write(approvedPath, `${JSON.stringify(approved, null, 2)}\n`)
    for (const cmd of [
      ['git', 'init'],
      ['git', 'config', 'user.email', 'studio@example.test'],
      ['git', 'config', 'user.name', 'Studio Test'],
      ['git', 'add', '.'],
      ['git', 'commit', '-m', 'initial'],
    ]) {
      const result = Bun.spawnSync({ cmd, cwd: project })
      expect(result.exitCode).toBe(0)
    }
    const gate = join(project, 'continue.txt')
    await Bun.write(gate, 'continue')
    const { child, url } = await startStudio(project, {
      PICKLE_STUDIO_CONTINUE: gate,
    })
    const page = await browser.newPage()
    try {
      await page.goto(url)
      await page
        .getByRole('button', { name: 'Run Scenario Adapt the purchase' })
        .click()
      await page.getByRole('button', { name: 'Cancel test run' }).waitFor()
      await page.getByRole('button', { name: 'Run Specification' }).waitFor({
        timeout: 20_000,
      })

      await page.getByRole('link', { name: 'Plans' }).click()
      await page.getByRole('heading', { name: 'Plans', exact: true }).waitFor()
      expect(await page.getByText('CI adapted results: reject').count()).toBe(1)
      await page
        .getByRole('button', { name: 'Adapt the purchase · chrome' })
        .click()
      const comparison = page.getByRole('table', { name: 'Plan comparison' })
      expect(await comparison.textContent()).toContain('previous-revision')
      expect(await comparison.textContent()).toContain('Adapt basket on chrome')
      expect(await comparison.textContent()).toContain('previous-basket')
      expect(await comparison.textContent()).toContain('current-basket')

      await page
        .getByRole('button', { name: 'View originating test result' })
        .click()
      const evidence = page.getByRole('dialog', {
        name: 'Originating test result',
      })
      expect(await evidence.textContent()).toContain('passed-with-adaptation')
      expect(await evidence.textContent()).toContain('Then the basket adapts')
      expect(await evidence.textContent()).toContain('Adapt basket on chrome')
      expect(
        await evidence.getByRole('img', { name: /screenshot/ }).count(),
      ).toBe(1)
      await evidence.getByRole('button', { name: 'Close' }).click()

      await rm(gate)
      await page.getByRole('link', { name: 'Specifications' }).click()
      await page
        .getByRole('button', { name: 'Run Scenario Pay for the order' })
        .click()
      await page.getByRole('status').filter({ hasText: 'running' }).waitFor()
      await page.getByRole('link', { name: 'Plans' }).click()
      expect(
        await page
          .getByRole('button', { name: 'Promote candidate' })
          .isDisabled(),
      ).toBe(true)
      const otherPage = await browser.newPage()
      try {
        await otherPage.goto(url)
        await otherPage.getByRole('link', { name: 'Plans' }).click()
        await otherPage
          .getByRole('button', { name: 'Adapt the purchase · chrome' })
          .click()
        await otherPage
          .getByRole('button', { name: 'Promote candidate' })
          .click()
        await otherPage
          .getByRole('button', { name: 'Confirm promotion' })
          .click()
        await otherPage
          .getByRole('alert')
          .filter({ hasText: 'cannot be promoted during a test run' })
          .waitFor()
      } finally {
        await otherPage.close()
      }
      await Bun.write(gate, 'continue')
      await page.getByRole('status').filter({ hasText: 'failed' }).waitFor({
        timeout: 20_000,
      })
      const promote = page.getByRole('button', { name: 'Promote candidate' })
      await promote.waitFor()
      const enabledDeadline = Date.now() + 10_000
      while (await promote.isDisabled()) {
        if (Date.now() >= enabledDeadline) {
          throw new Error('Promotion remained disabled after the test run')
        }
        await Bun.sleep(25)
      }

      await promote.click()
      const confirmation = page.getByRole('dialog', {
        name: 'Promote candidate plan?',
      })
      await confirmation.waitFor()
      expect(JSON.parse(await Bun.file(approvedPath).text())).toEqual(approved)
      await confirmation
        .getByRole('button', { name: 'Confirm promotion' })
        .click()
      await page.getByText('No candidate plan').waitFor()
      expect(await Bun.file(candidatePath).exists()).toBe(false)

      await page.getByRole('link', { name: 'Settings' }).click()
      const changed = page
        .getByRole('listitem')
        .filter({ hasText: '.pickle/plans/chrome/scnadaptcccccccc.json' })
      await changed.waitFor()
      await changed.getByRole('button', { name: 'Show diff' }).click()
      expect(await changed.textContent()).toContain('Adapt basket on chrome')
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
      await page.getByRole('status').filter({ hasText: 'running' }).waitFor()
      await page
        .getByRole('button', { name: 'Pay for the order chrome running' })
        .waitFor()
      await Bun.write(gate, 'continue')
      await page.getByRole('status').filter({ hasText: 'failed' }).waitFor({
        timeout: 20_000,
      })
      const attention = page.getByRole('list', { name: 'Needs attention' })
      expect(await attention.getByRole('listitem').count()).toBe(1)
      expect(await attention.textContent()).toContain('Pay for the order')
      expect(await attention.textContent()).not.toContain('Adapt the purchase')
      const scenarios = page.getByRole('table', { name: 'Scenarios' })
      expect(await scenarios.textContent()).toContain('pending')
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)

  test('Studio shows a Specification outline until Edit opens Gherkin with autocomplete', async () => {
    const project = await createStudioProject('author-specification')
    const { child, url } = await startStudio(project)
    const page = await browser.newPage()
    try {
      await page.goto(url)
      const outline = page.getByRole('region', {
        name: 'Specification outline',
      })
      await outline.waitFor()
      expect(await outline.textContent()).toContain('Checkout')
      expect(await outline.textContent()).toContain('Pay for the order')
      expect(await page.locator('.monaco-editor').count()).toBe(0)
      await page.getByRole('button', { name: 'Edit Specification' }).click()
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
      await outline.waitFor()
      expect(await outline.textContent()).toContain('Basket')
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
      const outline = page.getByRole('region', {
        name: 'Specification outline',
      })
      await outline.waitFor()
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
      await outline.getByText('Reloaded', { exact: true }).waitFor({
        timeout: 10_000,
      })
      await page.getByRole('button', { name: 'Edit Specification' }).click()
      await page.locator('.monaco-editor').waitFor()
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
      const deadline = Date.now() + 10_000
      while (Date.now() < deadline) {
        if ((await gherkinValue(page)).includes('Feature: Disk edit')) break
        await Bun.sleep(50)
      }
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
      expect(await page.getByLabel('Active model').textContent()).toContain(
        'anthropic / claude-sonnet-4-6',
      )
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
      const outline = page.getByRole('region', {
        name: 'Specification outline',
      })
      await outline.waitFor()
      expect(await outline.textContent()).toContain('Search')
      expect(await outline.textContent()).toContain('@pickle:state:draft')
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
      await page
        .getByRole('region', { name: 'Specification metadata' })
        .waitFor()
      await page.getByRole('button', { name: 'Edit metadata' }).click()
      await page.getByRole('button', { name: 'draft', exact: true }).click()
      await page.getByLabel('Specification tags').fill('@checkout @regression')
      await page.getByLabel('Link namespace').fill('jira')
      await page.getByLabel('Link id').fill('PROJ-12')
      await page.getByRole('button', { name: 'Add link' }).click()
      await page.getByRole('button', { name: 'Save metadata' }).click()
      const dialog = page.getByRole('dialog', {
        name: 'Review Specification metadata',
      })
      await dialog.waitFor()
      expect(
        await page.getByRole('region', { name: 'Source diff' }).textContent(),
      ).toContain('@pickle:state:draft')
      await dialog.getByRole('button', { name: 'Save metadata' }).click()
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
      await page.getByRole('link', { name: 'Settings' }).click()
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
      await page.getByRole('link', { name: 'Settings' }).click()
      await page.getByRole('button', { name: 'chrome' }).click()
      await page.getByLabel('Profile capabilities').fill('geolocation')
      await page
        .getByRole('button', { name: 'Save execution target profile' })
        .click()
      await page.getByRole('button', { name: 'firefox' }).click()
      await page.getByLabel('Profile capabilities').fill('geolocation')
      await page
        .getByRole('button', { name: 'Save execution target profile' })
        .click()
      await page.getByRole('link', { name: 'Specifications' }).click()
      await page.getByRole('button', { name: 'Run Specification' }).waitFor({
        timeout: 10_000,
      })
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
      await page.getByRole('link', { name: 'Settings' }).click()
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
    const remote = join(workspace, 'manage-git-remote.git')
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
    const branch =
      Bun.spawnSync({
        cmd: ['git', 'branch', '--show-current'],
        cwd: project,
      })
        .stdout.toString()
        .trim() || 'main'
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
      await page.getByRole('link', { name: 'Settings' }).click()
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
      const deadline = Date.now() + 10_000
      let log = ''
      while (Date.now() < deadline) {
        const result = Bun.spawnSync({
          cmd: ['git', 'log', '-1', '--pretty=%s'],
          cwd: project,
        })
        log = result.stdout.toString().trim()
        if (log === 'Update Checkout') break
        await Bun.sleep(50)
      }
      expect(log).toBe('Update Checkout')
      const remoteHeads = Bun.spawnSync({
        cmd: ['git', 'ls-remote', remote, 'HEAD'],
      })
      expect(remoteHeads.stdout.toString().trim()).toBe('')
      await page.getByRole('button', { name: 'Create pull request' }).click()
      const ghDeadline = Date.now() + 10_000
      let ghInvoked = ''
      while (Date.now() < ghDeadline) {
        if (await Bun.file(ghLog).exists()) {
          ghInvoked = await Bun.file(ghLog).text()
          if (ghInvoked.includes('pr create --web')) break
        }
        await Bun.sleep(50)
      }
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

function collectStream(stream: ReadableStream<Uint8Array>) {
  const chunks: string[] = []
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  void (async () => {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      chunks.push(decoder.decode(value, { stream: true }))
    }
  })()
  return {
    text() {
      return chunks.join('')
    },
    async waitFor(pattern: RegExp, timeoutMs: number) {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        const match = chunks.join('').match(pattern)
        if (match?.[1]) return match[1]
        await Bun.sleep(25)
      }
      throw new Error(
        `Studio did not print a loopback URL.\n${chunks.join('')}`,
      )
    },
  }
}

async function finishedManifestCount(project: string): Promise<number> {
  const manifests = new Bun.Glob('*/manifest.json').scan({
    cwd: join(project, '.pickle', 'runs'),
    onlyFiles: true,
  })
  let finished = 0
  for await (const relativePath of manifests) {
    const manifest = (await Bun.file(
      join(project, '.pickle', 'runs', relativePath),
    ).json()) as TestRunManifestFile
    if (manifest.finishedAt) finished++
  }
  return finished
}
