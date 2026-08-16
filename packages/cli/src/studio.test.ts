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
              resolvedActions: [{ description: \`Adapt basket on \${profile}\` }],
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
      expect(
        await page.getByRole('link', { name: 'Plans', disabled: true }).count(),
      ).toBe(1)
      expect(
        await page
          .getByRole('link', { name: 'Settings', disabled: true })
          .count(),
      ).toBe(1)
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
        const lineNumber = model.getLineCount()
        editor.setPosition({
          lineNumber,
          column: model.getLineMaxColumn(lineNumber),
        })
        editor.focus()
      })
      await page.keyboard.press('Enter')
      await page.keyboard.type('    Gi')
      await page.evaluate(() => {
        const editor = (
          globalThis as MonacoEditorHost
        ).monaco?.editor.getEditors()[0]
        editor?.trigger('test', 'editor.action.triggerSuggest', {})
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
