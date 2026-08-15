import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

describe('public CLI workspace seam', () => {
  let workspace: string
  let pickleCommand: string

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'pickle-spec-workspace-'))
    const packageDirectory = resolve(import.meta.dir, '..')
    const packageManifest = await Bun.file(join(packageDirectory, 'package.json')).json() as {
      bin: { pickle: string }
    }
    pickleCommand = join(workspace, 'node_modules', '.bin', 'pickle')
    await mkdir(join(workspace, 'node_modules', '.bin'), { recursive: true })
    await symlink(resolve(packageDirectory, packageManifest.bin.pickle), pickleCommand)
    await Bun.write(join(workspace, 'purchase.feature'), `Feature: Purchase
  Scenario: Complete a purchase
    Given a product is in the basket
    Then the purchase succeeds`)
    await Bun.write(join(workspace, 'pickle.extensions.ts'), `
const state = process.env.PICKLE_TEST_OUTCOME ?? 'passed'

export default {
  executionTargetProfile: { id: 'deterministic' },
  adapter: {
    async openSession() {
      return {
        async executeStep(step, signal) {
          if (process.env.PICKLE_TEST_STEP_MARKER) {
            await Bun.write(process.env.PICKLE_TEST_STEP_MARKER, 'started')
          }
          if (process.env.PICKLE_TEST_WAIT_FOR_ABORT === 'true') {
            await new Promise((resolve, reject) => {
              const onAbort = () => {
                signal?.removeEventListener('abort', onAbort)
                reject(new DOMException('Scenario cancelled', 'AbortError'))
              }
              signal?.addEventListener('abort', onAbort, { once: true })
            })
          }
          return {
            state,
            resolvedActions: [{ description: \`Deterministic action: \${step.text}\` }],
          }
        },
        async close() {
          if (process.env.PICKLE_TEST_CLOSE_MARKER) {
            await Bun.write(process.env.PICKLE_TEST_CLOSE_MARKER, 'closed')
          }
        },
      }
    },
  },
}
`)
  })

  afterAll(async () => {
    await rm(workspace, { recursive: true, force: true })
  })

  test('runs one Specification and Scenario through public CLI and runner interfaces', async () => {
    const process = Bun.spawn({
      cmd: [
        pickleCommand,
        'run',
        'purchase.feature',
        '--extensions',
        'pickle.extensions.ts',
      ],
      cwd: workspace,
      env: { ...Bun.env, PICKLE_TEST_OUTCOME: 'passed' },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ])

    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    const records = stdout.trim().split('\n').map(line => JSON.parse(line))
    expect(records.filter(record => record.kind === 'run-event').map(record => record.event.type)).toEqual([
      'scenario-started',
      'step-started',
      'step-finished',
      'step-started',
      'step-finished',
      'scenario-finished',
    ])
    expect(records.at(-1)).toMatchObject({
      kind: 'test-result',
      result: {
        schemaVersion: 1,
        specification: { name: 'Purchase' },
        scenario: { name: 'Complete a purchase' },
        executionTargetProfile: { id: 'deterministic' },
        state: 'passed',
      },
    })
    expect(stdout).not.toContain('gherkinDocument')
    expect(stdout).not.toContain('Stagehand')
  })

  test('initializes a project without overwriting files and checks it without opening a session', async () => {
    const project = join(workspace, 'initialized-project')
    await mkdir(join(project, 'features'), { recursive: true })
    await Bun.write(join(project, 'features', 'example.feature'), `Feature: Example\n  Scenario: Safe check\n    Then validation is offline`)

    const first = Bun.spawnSync({ cmd: [pickleCommand, 'init'], cwd: project, env: { ...Bun.env } })
    expect(first.exitCode).toBe(0)
    expect(first.stdout.toString()).toContain('Created pickle.config.jsonc')
    expect(first.stdout.toString()).toContain('Created pickle.extensions.ts')

    const originalExtensions = await Bun.file(join(project, 'pickle.extensions.ts')).text()
    const second = Bun.spawnSync({ cmd: [pickleCommand, 'init'], cwd: project, env: { ...Bun.env } })
    expect(second.exitCode).toBe(0)
    expect(second.stdout.toString()).toContain('Skipped pickle.config.jsonc: file already exists')
    expect(second.stdout.toString()).toContain('Skipped pickle.extensions.ts: file already exists')
    expect(await Bun.file(join(project, 'pickle.extensions.ts')).text()).toBe(originalExtensions)

    const checked = Bun.spawnSync({ cmd: [pickleCommand, 'check'], cwd: project, env: { ...Bun.env } })
    expect(checked.exitCode).toBe(0)
    expect(checked.stdout.toString()).toContain('Project is valid')
    expect(checked.stderr.toString()).toBe('')
  })

  test('check reports the reason and corrective action for validation failures', async () => {
    const project = join(workspace, 'invalid-project')
    await mkdir(project, { recursive: true })
    await Bun.write(join(project, 'pickle.config.jsonc'), '{ "schemaVersion": 99 }')
    await Bun.write(join(project, 'pickle.extensions.ts'), 'export default {}')

    const checked = Bun.spawnSync({ cmd: [pickleCommand, 'check'], cwd: project, env: { ...Bun.env } })
    expect(checked.exitCode).toBe(2)
    expect(checked.stderr.toString()).toContain('Unsupported configuration schemaVersion: 99')
    expect(checked.stderr.toString()).toContain('Correct the value and run pickle check again')
  })

  test('the deterministic adapter models every kernel outcome', async () => {
    const cases = [
      { outcome: 'passed', exitCode: 0 },
      { outcome: 'passed-with-adaptation', exitCode: 0 },
      { outcome: 'failed', exitCode: 1 },
      { outcome: 'cancelled', exitCode: 130 },
      { outcome: 'infrastructure-error', exitCode: 1 },
    ] as const

    for (const expected of cases) {
      const process = Bun.spawn({
        cmd: [
          pickleCommand,
          'run',
          'purchase.feature',
          '--extensions',
          'pickle.extensions.ts',
        ],
        cwd: workspace,
        env: { ...Bun.env, PICKLE_TEST_OUTCOME: expected.outcome },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [exitCode, stdout, stderr] = await Promise.all([
        process.exited,
        new Response(process.stdout).text(),
        new Response(process.stderr).text(),
      ])
      const records = stdout.trim().split('\n').map(line => JSON.parse(line))

      expect(stderr).toBe('')
      expect(exitCode).toBe(expected.exitCode)
      expect(records.at(-1)).toMatchObject({
        kind: 'test-result',
        result: {
          schemaVersion: 1,
          state: expected.outcome,
        },
      })
    }
  })

  test('SIGINT emits a cancelled result and closes the logical session', async () => {
    const stepMarker = join(workspace, 'step-started.txt')
    const closeMarker = join(workspace, 'session-closed.txt')
    const child = Bun.spawn({
      cmd: [
        pickleCommand,
        'run',
        'purchase.feature',
        '--extensions',
        'pickle.extensions.ts',
      ],
      cwd: workspace,
      env: {
        ...Bun.env,
        PICKLE_TEST_OUTCOME: 'passed',
        PICKLE_TEST_WAIT_FOR_ABORT: 'true',
        PICKLE_TEST_STEP_MARKER: stepMarker,
        PICKLE_TEST_CLOSE_MARKER: closeMarker,
      },
      stdout: 'pipe',
      stderr: 'pipe',
    })

    for (let attempt = 0; attempt < 200 && !(await Bun.file(stepMarker).exists()); attempt++) {
      await Bun.sleep(5)
    }
    expect(await Bun.file(stepMarker).exists()).toBe(true)

    child.kill('SIGINT')
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    const records = stdout.trim().split('\n').map(line => JSON.parse(line))

    expect(stderr).toBe('')
    expect(exitCode).toBe(130)
    expect(records.at(-1)).toMatchObject({
      kind: 'test-result',
      result: { state: 'cancelled' },
    })
    expect(await Bun.file(closeMarker).text()).toBe('closed')
  })

  test('runs a real web Scenario through the public web adapter composition', async () => {
    const artifactDirectory = join(workspace, 'web-artifacts')
    const applicationUrl = 'data:text/html,<button id="search">Search</button><div id="results"></div>'
    await Bun.write(join(workspace, 'web.feature'), `Feature: Web search
  Scenario: Search from the application
    Given I navigate to the main page
    When I search for pickles
    Then pickle results are visible`)
    await Bun.write(join(workspace, 'pickle.config.jsonc'), `{
  // The CLI owns this declarative target configuration.
  "schemaVersion": 1,
  "executionTargetProfile": { "id": "web" },
  "server": {
    "command": "exit 9",
    "url": ${JSON.stringify(applicationUrl)},
    "reuseExisting": true
  },
  "web": {
    "baseUrl": ${JSON.stringify(applicationUrl)},
    "screenshots": {
      "mode": "on-step",
      "outputDir": ${JSON.stringify(artifactDirectory)}
    }
  }
}`)
    await Bun.write(join(workspace, 'web.extensions.ts'), `
export default {
  webAutomationFactory: {
    async open() {
      let page = ''
      return {
        async navigate(url) { page = await (await fetch(url)).text() },
        async observe() {
          return [{ description: 'Search for pickles', handle: 'search' }]
        },
        async act() {
          page += '<div>Pickle results</div>'
          return { success: true }
        },
        async verify() {
          return {
            meetsExpectation: page.includes('Pickle results'),
            actualState: page,
          }
        },
        async screenshot() { return new Uint8Array([137, 80, 78, 71]) },
        async close() {},
      }
    },
  },
}
`)

    const process = Bun.spawn({
      cmd: [
        pickleCommand,
        'run',
        'web.feature',
        '--config',
        'pickle.config.jsonc',
        '--extensions',
        'web.extensions.ts',
      ],
      cwd: workspace,
      env: { ...Bun.env },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      process.exited,
      new Response(process.stdout).text(),
      new Response(process.stderr).text(),
    ])
    const records = stdout.trim().split('\n').map(line => JSON.parse(line))

    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    expect(records.at(-1)).toMatchObject({
      kind: 'test-result',
      result: {
        schemaVersion: 1,
        specification: { name: 'Web search' },
        scenario: { name: 'Search from the application' },
        executionTargetProfile: { id: 'web' },
        state: 'passed',
        steps: [
          { artifacts: [{ kind: 'screenshot', mediaType: 'image/png' }] },
          { resolvedActions: [{ description: 'Search for pickles' }] },
          { state: 'passed' },
        ],
      },
    })
    const screenshots = new Bun.Glob('**/*.png').scanSync({ cwd: artifactDirectory })
    expect([...screenshots]).toHaveLength(3)
    expect(stdout).not.toContain('Stagehand')
    expect(stdout).not.toContain('gherkinDocument')
  })
})
