import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { type Browser, chromium } from 'playwright'

type CliPackageManifest = {
  bin: { pickle: string }
}

type TestRunManifestFile = {
  finishedAt?: string
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
      `@pickle:id:speccheckaaaaaaaa @pickle:state:active
Feature: Checkout
  @pickle:id:scnpaybbbbbbbbbb
  Scenario: Pay for the order
    Then payment is captured
  @pickle:id:scnadaptcccccccc
  Scenario: Adapt the purchase
    Then the basket adapts
  @pickle:id:scnpassdddddddd
  Scenario: Complete a purchase
    Then the purchase succeeds`,
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
      15_000,
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
    })
  })

  afterAll(async () => {
    await browser?.close()
    await rm(workspace, { recursive: true, force: true })
  })

  test('pickle studio starts a local application and opens the configured project', async () => {
    const project = await createStudioProject('opened-project')
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
      expect(await page.getByRole('link', { name: 'Runs' }).count()).toBe(1)
      expect(await page.getByRole('link', { name: 'Plans' }).count()).toBe(1)
      expect(await page.getByRole('link', { name: 'Settings' }).count()).toBe(1)
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
      await page.getByRole('button', { name: 'Start test run' }).click()
      await page.getByRole('status').filter({ hasText: 'running' }).waitFor()
      await page
        .getByRole('button', { name: 'Pay for the order chrome running' })
        .waitFor()
      expect(await finishedManifestCount(project)).toBe(0)
      await page
        .getByRole('button', { name: 'Pay for the order chrome running' })
        .click()
      expect(
        await page.getByRole('list', { name: 'Step timeline' }).textContent(),
      ).toContain('Then payment is captured')
      await Bun.write(gate, 'continue')
      await page.getByRole('status').filter({ hasText: 'failed' }).waitFor({
        timeout: 20_000,
      })
      const attention = page.getByRole('list', { name: 'Needs attention' })
      const items = attention.getByRole('listitem')
      expect(await items.count()).toBe(2)
      expect(await items.nth(0).textContent()).toContain('Pay for the order')
      expect(await items.nth(0).textContent()).toContain('failed')
      expect(await items.nth(1).textContent()).toContain('Adapt the purchase')
      expect(await items.nth(1).textContent()).toContain(
        'passed-with-adaptation',
      )
      const matrix = page.getByRole('table', { name: 'Target matrix' })
      expect(
        await matrix.getByRole('columnheader', { name: 'chrome' }).count(),
      ).toBe(1)
      expect(
        await matrix.getByRole('columnheader', { name: 'firefox' }).count(),
      ).toBe(1)
      expect(
        await matrix
          .getByRole('rowheader', { name: 'Pay for the order' })
          .count(),
      ).toBe(1)
      expect(
        await matrix
          .getByRole('rowheader', { name: 'Adapt the purchase' })
          .count(),
      ).toBe(1)
      expect(
        await matrix
          .getByRole('rowheader', { name: 'Complete a purchase' })
          .count(),
      ).toBe(1)
      await page
        .getByRole('button', { name: 'Pay for the order chrome failed' })
        .click()
      const timeline = page.getByRole('list', { name: 'Step timeline' })
      expect(await timeline.textContent()).toContain('Then payment is captured')
      expect(await timeline.textContent()).toContain('Click pay on chrome')
      expect(await timeline.textContent()).toContain('Payment was declined')
      expect(await page.getByRole('img', { name: 'screenshot' }).count()).toBe(
        1,
      )
    } finally {
      await page.close()
      child.kill()
      await child.exited
    }
  }, 60_000)
})

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
