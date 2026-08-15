import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

describe('public CLI workspace seam', () => {
  let workspace: string
  let pickleCommand: string

  interface CheckProjectFixture {
    config: unknown
    extensions?: string
    specification?: { path: string; source: string }
  }

  const defaultCheckConfig = {
    schemaVersion: 1,
    specifications: 'features/**/*.feature',
    web: { baseUrl: 'https://example.com' },
  }
  const validSpecification = {
    path: 'features/example.feature',
    source: `@pickle:id:specaaaaaaaaaaaa @pickle:state:active
Feature: Example
  @pickle:id:scnbbbbbbbbbbbb
  Scenario: Validate project
    Then validation succeeds`,
  }

  async function createCheckProject(
    name: string,
    fixture: CheckProjectFixture,
  ): Promise<string> {
    const project = join(workspace, name)
    await mkdir(project, { recursive: true })
    if (fixture.specification) {
      const path = join(project, fixture.specification.path)
      await mkdir(dirname(path), { recursive: true })
      await Bun.write(path, fixture.specification.source)
    }
    await Bun.write(
      join(project, 'pickle.config.jsonc'),
      JSON.stringify(fixture.config),
    )
    await Bun.write(
      join(project, 'pickle.extensions.ts'),
      fixture.extensions ?? 'export default {}',
    )
    return project
  }

  function runCheck(project: string) {
    return Bun.spawnSync({
      cmd: [pickleCommand, 'check'],
      cwd: project,
      env: { ...Bun.env },
    })
  }

  beforeAll(async () => {
    workspace = await mkdtemp(join(tmpdir(), 'pickle-spec-workspace-'))
    const packageDirectory = resolve(import.meta.dir, '..')
    const packageManifest = (await Bun.file(
      join(packageDirectory, 'package.json'),
    ).json()) as {
      bin: { pickle: string }
    }
    pickleCommand = join(workspace, 'node_modules', '.bin', 'pickle')
    await mkdir(join(workspace, 'node_modules', '.bin'), { recursive: true })
    await symlink(
      resolve(packageDirectory, packageManifest.bin.pickle),
      pickleCommand,
    )
    await Bun.write(
      join(workspace, 'purchase.feature'),
      `@pickle:id:specpurchaseaaaaaa @pickle:state:active
Feature: Purchase
  @pickle:id:scnpurchasebbbbbb
  Scenario: Complete a purchase
    Given a product is in the basket
    Then the purchase succeeds`,
    )
    await Bun.write(
      join(workspace, 'deterministic.config.jsonc'),
      JSON.stringify({
        schemaVersion: 1,
        executionTargetProfile: { id: 'deterministic' },
      }),
    )
    await Bun.write(
      join(workspace, 'pickle.extensions.ts'),
      `
const state = process.env.PICKLE_TEST_OUTCOME ?? 'passed'

export default {
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
`,
    )
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
        '--config',
        'deterministic.config.jsonc',
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
    const records = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(
      records
        .filter((record) => record.kind === 'run-event')
        .map((record) => record.event.type),
    ).toEqual([
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
    await Bun.write(
      join(project, 'features', 'example.feature'),
      `@pickle:id:specaaaaaaaaaaaa @pickle:state:active
Feature: Example
  @pickle:id:scnbbbbbbbbbbbb
  Scenario: Safe check
    Then validation is offline`,
    )

    const first = Bun.spawnSync({
      cmd: [pickleCommand, 'init'],
      cwd: project,
      env: { ...Bun.env },
    })
    expect(first.exitCode).toBe(0)
    expect(first.stdout.toString()).toContain('Created pickle.config.jsonc')
    expect(first.stdout.toString()).toContain('Created pickle.extensions.ts')

    const originalExtensions = await Bun.file(
      join(project, 'pickle.extensions.ts'),
    ).text()
    const second = Bun.spawnSync({
      cmd: [pickleCommand, 'init'],
      cwd: project,
      env: { ...Bun.env },
    })
    expect(second.exitCode).toBe(0)
    expect(second.stdout.toString()).toContain(
      'Skipped pickle.config.jsonc: file already exists',
    )
    expect(second.stdout.toString()).toContain(
      'Skipped pickle.extensions.ts: file already exists',
    )
    expect(await Bun.file(join(project, 'pickle.extensions.ts')).text()).toBe(
      originalExtensions,
    )

    const checked = Bun.spawnSync({
      cmd: [pickleCommand, 'check'],
      cwd: project,
      env: { ...Bun.env },
    })
    expect(checked.exitCode).toBe(0)
    expect(checked.stdout.toString()).toContain('Project is valid')
    expect(checked.stderr.toString()).toBe('')
  })

  test('check validates extension imports without evaluating extension code', async () => {
    const projectName = 'side-effect-free-check'
    const projectPath = join(workspace, projectName)
    const marker = join(projectPath, 'extension-evaluated.txt')
    const project = await createCheckProject(projectName, {
      config: defaultCheckConfig,
      specification: validSpecification,
      extensions: `
await Bun.write(${JSON.stringify(marker)}, 'executed')
await import('./missing-adapter.ts')
export default {}
`,
    })

    const checked = runCheck(project)

    expect(checked.exitCode).toBe(2)
    expect(checked.stderr.toString()).toContain(
      'Cannot validate pickle.extensions.ts',
    )
    expect(checked.stderr.toString()).toContain('missing-adapter.ts')
    expect(checked.stderr.toString()).toContain(
      'Fix its imports or syntax and run pickle check again',
    )
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  test('check rejects invalid imported bindings without evaluating extension code', async () => {
    const projectName = 'invalid-extension-binding'
    const projectPath = join(workspace, projectName)
    const marker = join(projectPath, 'extension-evaluated.txt')
    const project = await createCheckProject(projectName, {
      config: defaultCheckConfig,
      specification: validSpecification,
      extensions: `
import { missingAdapter } from './adapter.ts'
await Bun.write(${JSON.stringify(marker)}, 'executed')
export default { adapter: missingAdapter }
`,
    })
    await Bun.write(join(project, 'adapter.ts'), 'export const adapter = {}')

    const checked = runCheck(project)

    expect(checked.exitCode).toBe(2)
    expect(checked.stderr.toString()).toContain(
      "has no exported member 'missingAdapter'",
    )
    expect(checked.stderr.toString()).toContain(
      'Fix its imports or syntax and run pickle check again',
    )
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  test('runner rejects a project without an extension or configured fallback adapter', async () => {
    const project = await createCheckProject('missing-project-adapter', {
      config: {
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
      },
      specification: validSpecification,
    })

    const checked = runCheck(project)

    expect(checked.exitCode).toBe(2)
    expect(checked.stderr.toString()).toContain(
      'Configure web.baseUrl or export an adapter from pickle.extensions.ts',
    )
  })

  test('check requires an extension default export without evaluating it', async () => {
    const project = await createCheckProject('missing-extension-export', {
      config: defaultCheckConfig,
      specification: validSpecification,
      extensions: 'export const hooks = {}',
    })

    const checked = runCheck(project)

    expect(checked.exitCode).toBe(2)
    expect(checked.stderr.toString()).toContain(
      'pickle.extensions.ts must provide a default export',
    )
    expect(checked.stderr.toString()).toContain(
      'Export the extension object as default and run pickle check again',
    )
  })

  test('check rejects an invalid extension adapter without evaluating it', async () => {
    const project = await createCheckProject('invalid-extension-adapter', {
      config: defaultCheckConfig,
      specification: validSpecification,
      extensions: `export default {
  adapter: {},
  executionTargetProfile: { id: '' },
}`,
    })

    const checked = runCheck(project)

    expect(checked.exitCode).toBe(2)
    expect(checked.stderr.toString()).toContain(
      "Property 'openSession' is missing",
    )
    expect(checked.stderr.toString()).toContain('executionTargetProfile')
    expect(checked.stderr.toString()).toContain(
      'Correct the extension default export and run pickle check again',
    )
  })

  test('check rejects invalid selection policies', async () => {
    const project = await createCheckProject('invalid-selection-policy', {
      config: {
        ...defaultCheckConfig,
        selection: { shard: { index: 2, total: 1 } },
      },
      specification: validSpecification,
    })

    const checked = runCheck(project)

    expect(checked.exitCode).toBe(2)
    expect(checked.stderr.toString()).toContain(
      'selection.shard.index must be less than or equal to selection.shard.total',
    )
    expect(checked.stderr.toString()).toContain(
      'Correct the value and run pickle check again',
    )
  })

  test('check rejects invalid web adapter policies', async () => {
    const project = await createCheckProject('invalid-web-policy', {
      config: {
        ...defaultCheckConfig,
        web: {
          baseUrl: 'https://example.com',
          browser: { environment: 'invalid' },
        },
      },
      specification: validSpecification,
    })

    const checked = runCheck(project)

    expect(checked.exitCode).toBe(2)
    expect(checked.stderr.toString()).toContain(
      'web.browser.environment must be local or browserbase',
    )
    expect(checked.stderr.toString()).toContain(
      'Correct the value and run pickle check again',
    )
  })

  test('check rejects an unsupported Stagehand model before execution resources start', async () => {
    const project = await createCheckProject('invalid-model-name', {
      config: {
        ...defaultCheckConfig,
        web: {
          baseUrl: 'https://example.com',
          browser: { modelName: 'google/gemini-3.7-flash' },
        },
      },
      specification: validSpecification,
    })

    const checked = runCheck(project)

    expect(checked.exitCode).toBe(2)
    expect(checked.stderr.toString()).toContain(
      'web.browser.modelName "google/gemini-3.7-flash" is not a Stagehand-supported model',
    )
    expect(checked.stderr.toString()).toContain(
      'Correct the value and run pickle check again',
    )
  })

  test('check rejects invalid Specifications before execution resources start', async () => {
    const project = await createCheckProject('invalid-specification', {
      config: defaultCheckConfig,
      specification: {
        path: 'features/invalid.feature',
        source: 'this is not a valid Specification',
      },
    })

    const checked = runCheck(project)

    expect(checked.exitCode).toBe(2)
    expect(checked.stderr.toString()).toContain(
      'Invalid Specification features/invalid.feature',
    )
    expect(checked.stderr.toString()).toContain(
      'Correct the Specification and run pickle check again',
    )
  })

  test('run validates Specifications before starting the configured application server', async () => {
    const projectName = 'run-validates-before-server'
    const projectPath = join(workspace, projectName)
    const marker = join(projectPath, 'server-started.txt')
    const extensionMarker = join(projectPath, 'extension-evaluated.txt')
    const project = await createCheckProject(projectName, {
      config: {
        ...defaultCheckConfig,
        server: {
          command: `bun -e "await Bun.write('${marker}', 'started')"`,
          url: 'http://127.0.0.1:1',
          startupTimeoutMs: 50,
          pollIntervalMs: 10,
        },
      },
      specification: {
        path: 'features/invalid.feature',
        source: 'this is not a valid Specification',
      },
      extensions: `
await Bun.write(${JSON.stringify(extensionMarker)}, 'evaluated')
export default {}
`,
    })

    const run = Bun.spawnSync({
      cmd: [pickleCommand, 'run'],
      cwd: project,
      env: { ...Bun.env },
    })

    expect(run.exitCode).toBe(2)
    expect(run.stderr.toString()).toContain('Parser errors')
    expect(await Bun.file(marker).exists()).toBe(false)
    expect(await Bun.file(extensionMarker).exists()).toBe(false)
  })

  test('check rejects an empty Specification path set', async () => {
    const project = await createCheckProject('empty-specification-paths', {
      config: { ...defaultCheckConfig, specifications: [] },
    })

    const checked = runCheck(project)

    expect(checked.exitCode).toBe(2)
    expect(checked.stderr.toString()).toContain(
      'specifications must contain at least one path',
    )
    expect(checked.stderr.toString()).toContain(
      'Correct the value and run pickle check again',
    )
  })

  test('check reports the reason and corrective action for validation failures', async () => {
    const project = await createCheckProject('invalid-project', {
      config: { schemaVersion: 99 },
    })

    const checked = runCheck(project)
    expect(checked.exitCode).toBe(2)
    expect(checked.stderr.toString()).toContain(
      'Unsupported configuration schemaVersion: 99',
    )
    expect(checked.stderr.toString()).toContain(
      'Correct the value and run pickle check again',
    )
  })

  test('migrate previews missing Specification state and writes only after confirmation', async () => {
    const source = `# keep this comment

@smoke
Feature: Checkout
  Scenario: Complete a purchase
    Then the purchase succeeds
`
    const project = await createCheckProject('migrate-preview', {
      config: defaultCheckConfig,
      specification: { path: 'features/checkout.feature', source },
    })
    const featurePath = join(project, 'features', 'checkout.feature')

    const preview = Bun.spawnSync({
      cmd: [pickleCommand, 'migrate'],
      cwd: project,
      env: { ...Bun.env },
    })
    expect(preview.exitCode).toBe(0)
    expect(preview.stdout.toString()).toContain(
      'Feature "Checkout": add @pickle:state:active',
    )
    expect(preview.stdout.toString()).not.toContain('@pickle:id:')
    expect(preview.stdout.toString()).toContain(
      'Re-run pickle migrate --yes after reviewing the preview',
    )
    expect(await Bun.file(featurePath).text()).toBe(source)

    const applied = Bun.spawnSync({
      cmd: [pickleCommand, 'migrate', '--yes'],
      cwd: project,
      env: { ...Bun.env },
    })
    expect(applied.exitCode).toBe(0)
    expect(applied.stdout.toString()).toContain(
      'Updated 1 Specification file(s)',
    )
    const migrated = await Bun.file(featurePath).text()
    expect(migrated).toContain('# keep this comment')
    expect(migrated).toContain('\n@smoke\n@pickle:state:active')
    expect(migrated).not.toContain('@pickle:id:')
    expect(migrated).toContain('Then the purchase succeeds')

    const checked = runCheck(project)
    expect(checked.exitCode).toBe(0)
    expect(checked.stdout.toString()).toContain('Project is valid')

    const again = Bun.spawnSync({
      cmd: [pickleCommand, 'migrate', '--yes'],
      cwd: project,
      env: { ...Bun.env },
    })
    expect(again.exitCode).toBe(0)
    expect(again.stdout.toString()).toContain(
      'No Specification metadata changes needed',
    )
    expect(await Bun.file(featurePath).text()).toBe(migrated)
  })

  test('check rejects missing Specification metadata without starting execution resources', async () => {
    const project = await createCheckProject('missing-metadata', {
      config: defaultCheckConfig,
      specification: {
        path: 'features/missing.feature',
        source:
          'Feature: Missing\n  Scenario: Needs identity\n    Then validation fails',
      },
    })

    const checked = runCheck(project)

    expect(checked.exitCode).toBe(2)
    expect(checked.stderr.toString()).toContain('missing a Specification state')
    expect(checked.stderr.toString()).toContain(
      'Run pickle migrate to add missing metadata',
    )
  })

  test('check and run never modify Specification source', async () => {
    const source =
      'Feature: Unchanged\n  Scenario: Stay put\n    Then nothing writes'
    const project = await createCheckProject('no-write', {
      config: defaultCheckConfig,
      specification: { path: 'features/unchanged.feature', source },
    })
    const featurePath = join(project, 'features', 'unchanged.feature')

    const checked = runCheck(project)
    expect(checked.exitCode).toBe(2)
    expect(await Bun.file(featurePath).text()).toBe(source)

    const purchasePath = join(workspace, 'purchase.feature')
    const purchaseSource = await Bun.file(purchasePath).text()
    const run = Bun.spawnSync({
      cmd: [
        pickleCommand,
        'run',
        'purchase.feature',
        '--config',
        'deterministic.config.jsonc',
        '--extensions',
        'pickle.extensions.ts',
      ],
      cwd: workspace,
      env: { ...Bun.env, PICKLE_TEST_OUTCOME: 'passed' },
    })
    expect(run.exitCode).toBe(0)
    expect(await Bun.file(purchasePath).text()).toBe(purchaseSource)
  })

  test('run reports missing Specification metadata without modifying source', async () => {
    const source = `Feature: Unreported
  Scenario: Still runs
    Then the purchase succeeds`
    const project = await createCheckProject('run-reports-metadata', {
      config: {
        schemaVersion: 1,
        executionTargetProfile: { id: 'deterministic' },
        specifications: 'features/**/*.feature',
      },
      specification: { path: 'features/unreported.feature', source },
      extensions: await Bun.file(
        join(workspace, 'pickle.extensions.ts'),
      ).text(),
    })
    const featurePath = join(project, 'features', 'unreported.feature')

    const run = Bun.spawnSync({
      cmd: [pickleCommand, 'run'],
      cwd: project,
      env: { ...Bun.env, PICKLE_TEST_OUTCOME: 'passed' },
    })

    expect(run.exitCode).toBe(0)
    expect(run.stderr.toString()).toContain('missing a Specification state')
    expect(run.stderr.toString()).toContain(
      'Run pickle migrate to add missing metadata',
    )
    expect(await Bun.file(featurePath).text()).toBe(source)
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
          '--config',
          'deterministic.config.jsonc',
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
      const records = stdout
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))

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
        '--config',
        'deterministic.config.jsonc',
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

    for (
      let attempt = 0;
      attempt < 200 && !(await Bun.file(stepMarker).exists());
      attempt++
    ) {
      await Bun.sleep(5)
    }
    expect(await Bun.file(stepMarker).exists()).toBe(true)

    child.kill('SIGINT')
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    const records = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))

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
    const applicationUrl =
      'data:text/html,<button id="search">Search</button><div id="results"></div>'
    await Bun.write(
      join(workspace, 'web.feature'),
      `@pickle:id:specwebaaaaaaaaaa @pickle:state:active
Feature: Web search
  @pickle:id:scnwebbbbbbbbbbb
  Scenario: Search from the application
    Given I navigate to the main page
    When I search for pickles
    Then pickle results are visible`,
    )
    await Bun.write(
      join(workspace, 'pickle.config.jsonc'),
      `{
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
}`,
    )
    await Bun.write(
      join(workspace, 'web.extensions.ts'),
      `
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
`,
    )

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

    expect(stderr).toBe('')
    expect(exitCode).toBe(0)
    const records = stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
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
    const screenshots = new Bun.Glob('**/*.png').scanSync({
      cwd: artifactDirectory,
    })
    expect([...screenshots]).toHaveLength(3)
    expect(stdout).not.toContain('Stagehand')
    expect(stdout).not.toContain('gherkinDocument')
  })

  test('selects a named test suite by path, tag, state, and name query', async () => {
    const project = await createCheckProject('named-suite', {
      config: {
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        executionTargetProfile: { id: 'deterministic' },
        suites: {
          smoke: {
            paths: ['features/checkout/**'],
            tagExpression: '@smoke',
            states: ['active', 'draft'],
            scenarioName: 'checkout',
          },
        },
      },
      extensions: await Bun.file(
        join(workspace, 'pickle.extensions.ts'),
      ).text(),
    })
    await mkdir(join(project, 'features', 'checkout'), { recursive: true })
    await Bun.write(
      join(project, 'features', 'checkout', 'guest.feature'),
      `@pickle:id:specguestaaaaaaaa @pickle:state:active @smoke
Feature: Guest checkout
  @pickle:id:scnguestbbbbbbbb
  Scenario: Checkout as a guest
    Then the purchase succeeds`,
    )
    await Bun.write(
      join(project, 'features', 'checkout', 'draft.feature'),
      `@pickle:id:specdraftaaaaaaaa @pickle:state:draft @smoke
Feature: Draft checkout
  @pickle:id:scndraftbbbbbbbb
  Scenario: Checkout as a draft customer
    Then the purchase succeeds`,
    )
    await Bun.write(
      join(project, 'features', 'search.feature'),
      `@pickle:id:specsearchaaaaaaa @pickle:state:active @smoke
Feature: Search
  @pickle:id:scnsearchbbbbbbb
  Scenario: Find a product
    Then results are visible`,
    )

    const run = Bun.spawnSync({
      cmd: [pickleCommand, 'run', '--suite', 'smoke'],
      cwd: project,
      env: { ...Bun.env, PICKLE_TEST_OUTCOME: 'passed' },
    })
    const records = run.stdout
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((record) => record.kind === 'test-result')

    expect(run.stderr.toString()).toBe('')
    expect(run.exitCode).toBe(0)
    expect(
      records.map((record) => [
        record.result.specification.name,
        record.result.scenario.name,
      ]),
    ).toEqual([
      ['Draft checkout', 'Checkout as a draft customer'],
      ['Guest checkout', 'Checkout as a guest'],
    ])
  })

  test('produces one test result per Scenario and execution target profile', async () => {
    const project = await createCheckProject('multi-target', {
      config: {
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        executionTargetProfiles: {
          web: { adapter: 'web', capabilities: ['screenshots'] },
          android: { adapter: 'android', capabilities: ['geolocation'] },
        },
      },
      specification: validSpecification,
      extensions: `
export default {
  adapters: {
    web: {
      capabilities: ['screenshots', 'web'],
      async openSession() {
        return {
          async executeStep(step) {
            return {
              state: 'passed',
              resolvedActions: [{ description: \`web: \${step.text}\` }],
            }
          },
          async close() {},
        }
      },
    },
    android: {
      capabilities: ['geolocation'],
      async openSession() {
        return {
          async executeStep(step) {
            return {
              state: 'passed',
              resolvedActions: [{ description: \`android: \${step.text}\` }],
            }
          },
          async close() {},
        }
      },
    },
  },
}
`,
    })

    const run = Bun.spawnSync({
      cmd: [pickleCommand, 'run'],
      cwd: project,
      env: { ...Bun.env },
    })
    const records = run.stdout
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((record) => record.kind === 'test-result')

    expect(run.stderr.toString()).toBe('')
    expect(run.exitCode).toBe(0)
    expect(
      records.map((record) => [
        record.result.scenario.name,
        record.result.executionTargetProfile.id,
        record.result.state,
      ]),
    ).toEqual([
      ['Validate project', 'web', 'passed'],
      ['Validate project', 'android', 'passed'],
    ])
  })

  test('rejects an incompatible target selection before starting execution resources', async () => {
    const projectName = 'incompatible-target'
    const projectPath = join(workspace, projectName)
    const marker = join(projectPath, 'server-started.txt')
    const project = await createCheckProject(projectName, {
      config: {
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        executionTargetProfiles: {
          web: { adapter: 'web', capabilities: ['screenshots'] },
        },
        server: {
          command: `bun -e "await Bun.write('${marker}', 'started')"`,
          url: 'http://127.0.0.1:1',
          startupTimeoutMs: 50,
          pollIntervalMs: 10,
        },
      },
      specification: {
        path: 'features/location.feature',
        source: `@pickle:id:speclocationaaaa @pickle:state:active @pickle:requires:geolocation
Feature: Nearby stores
  @pickle:id:scnlocationbbbb
  Scenario: Show stores near the customer
    Then nearby stores are listed`,
      },
      extensions: `
export default {
  adapters: {
    web: {
      capabilities: ['screenshots', 'web'],
      async openSession() {
        throw new Error('must not open')
      },
    },
  },
}
`,
    })

    const run = Bun.spawnSync({
      cmd: [pickleCommand, 'run'],
      cwd: project,
      env: { ...Bun.env },
    })

    expect(run.exitCode).toBe(2)
    expect(run.stderr.toString()).toContain(
      'Execution target profile "web" lacks required capabilities for Scenario "Show stores near the customer": geolocation',
    )
    expect(await Bun.file(marker).exists()).toBe(false)
  })

  test('loads custom adapters only from explicit extension imports', async () => {
    const project = await createCheckProject('no-plugin-discovery', {
      config: {
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        executionTargetProfiles: {
          discovered: { adapter: 'discovered' },
        },
      },
      specification: validSpecification,
      extensions: 'export default {}',
    })
    const pluginPath = join(
      project,
      'node_modules',
      'pickle-plugin-discovered',
      'index.ts',
    )
    await mkdir(dirname(pluginPath), { recursive: true })
    await Bun.write(
      pluginPath,
      `throw new Error('dynamic plugin discovery must not load this module')
export default { adapter: { async openSession() { throw new Error('no') } } }
`,
    )

    const run = Bun.spawnSync({
      cmd: [pickleCommand, 'run'],
      cwd: project,
      env: { ...Bun.env },
    })

    expect(run.exitCode).toBe(2)
    expect(run.stderr.toString()).toContain(
      'Execution target profile "discovered" requires adapter "discovered". Import it from pickle.extensions.ts.',
    )
    expect(run.stderr.toString()).not.toContain('dynamic plugin discovery')
  })

  test('check rejects an invalid named test suite query', async () => {
    const project = await createCheckProject('invalid-suite', {
      config: {
        ...defaultCheckConfig,
        suites: {
          smoke: { states: ['published'] },
        },
      },
      specification: validSpecification,
    })

    const checked = runCheck(project)

    expect(checked.exitCode).toBe(2)
    expect(checked.stderr.toString()).toContain(
      'selection.states must be draft, active, or deprecated',
    )
    expect(checked.stderr.toString()).toContain(
      'Correct the value and run pickle check again',
    )
  })
})
