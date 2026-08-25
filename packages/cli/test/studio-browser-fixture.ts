import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { type Browser, chromium } from 'playwright'

type CliPackageManifest = {
  bin: { pickle: string }
}

export class StudioBrowserFixture {
  workspace = ''
  pickleCommand = ''
  browser!: Browser

  async setup(): Promise<void> {
    this.workspace = await mkdtemp(join(tmpdir(), 'pickle-spec-studio-'))
    const packageDirectory = resolve(import.meta.dir, '..')
    const packageManifest = (await Bun.file(
      join(packageDirectory, 'package.json'),
    ).json()) as CliPackageManifest
    this.pickleCommand = join(this.workspace, 'node_modules', '.bin', 'pickle')
    await mkdir(join(this.workspace, 'node_modules', '.bin'), {
      recursive: true,
    })
    await symlink(
      resolve(packageDirectory, packageManifest.bin.pickle),
      this.pickleCommand,
    )
    this.browser = await chromium.launch({
      headless: true,
      channel: 'chrome',
      timeout: 60_000,
    })
  }

  async teardown(): Promise<void> {
    await this.browser?.close()
    if (this.workspace) {
      await rm(this.workspace, { recursive: true, force: true })
    }
  }

  async createProject(name: string): Promise<string> {
    const project = join(this.workspace, name)
    const screenshot = join(project, 'failure.png')
    await mkdir(join(project, 'features'), { recursive: true })
    await Bun.write(
      screenshot,
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    )
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
  @pickle:id:scnreviewccccccc
  Scenario: Review the purchase
    Then the basket is reviewed
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
          const releaseFailure = process.env.PICKLE_STUDIO_RELEASE_FAILURE
          if (releaseFailure && scenario === 'Pay for the order') {
            while (!(await Bun.file(releaseFailure).exists())) {
              if (signal?.aborted) {
                throw new DOMException('Scenario cancelled', 'AbortError')
              }
              await Bun.sleep(10)
            }
          }
          if (scenario === 'Pay for the order' && profile === 'chrome') {
            return {
              state: 'failed',
              message: 'Payment was declined',
              resolvedActions: [{ description: \`Click pay on \${profile}\` }],
              artifacts: [{
                kind: 'screenshot',
                path: ${JSON.stringify('/placeholder')},
                mediaType: 'image/png',
              }],
            }
          }
          if (scenario === 'Review the purchase' && profile === 'chrome') {
            const initialFailure = process.env.PICKLE_STUDIO_INITIAL_FAILURE
            return {
              state: initialFailure ? 'failed' : 'passed',
              message: initialFailure ? 'Basket review failed' : undefined,
              resolvedActions: [{
                description: \`Review basket on \${profile}\`,
                replay: { operation: 'review', target: 'current-basket' },
              }],
              artifacts: [{
                kind: 'screenshot',
                path: ${JSON.stringify('/placeholder')},
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
`.replaceAll('/placeholder', screenshot),
    )
    return project
  }

  async start(
    project: string,
    env: Record<string, string> = {},
    args: string[] = [],
  ) {
    const child = Bun.spawn({
      cmd: [this.pickleCommand, 'studio', '--no-open', ...args],
      cwd: project,
      env: { ...Bun.env, ...env },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const stdout = collectStream(child.stdout)
    const stderr = collectStream(child.stderr)
    let url: string
    try {
      url = await Promise.race([
        stdout.waitFor(/Studio (http:\/\/127\.0\.0\.1:\d+\S*)/, 45_000),
        child.exited.then(async (code) => {
          await Bun.sleep(25)
          throw new Error(`Studio exited with code ${code}`)
        }),
      ])
    } catch (error) {
      throw new Error(`${String(error)}\n${stderr.text()}`)
    }
    return { child, url, stdout, stderr }
  }
}

export function collectStream(stream: ReadableStream<Uint8Array>) {
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
