import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
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
  const deterministicRunConfig = {
    schemaVersion: 1,
    specifications: 'features/**/*.feature',
    executionTargetProfile: { id: 'deterministic' },
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

  function runProject(project: string, env: Record<string, string> = {}) {
    return Bun.spawnSync({
      cmd: [pickleCommand, 'run'],
      cwd: project,
      env: { ...Bun.env, ...env },
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
const states = (
  process.env.PICKLE_TEST_OUTCOMES ??
  process.env.PICKLE_TEST_OUTCOME ??
  'passed'
).split(',')
let attempt = 0

const adapter = {
  async openSession() {
    const state = states[attempt++] ?? states.at(-1) ?? 'passed'
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
        const message = process.env.PICKLE_TEST_MESSAGE
        const artifactPath = process.env.PICKLE_TEST_ARTIFACT
        const artifacts = artifactPath
          ? [{ kind: 'trace', path: artifactPath, mediaType: 'text/plain' }]
          : undefined
        return {
          state,
          resolvedActions: [{ description: \`Deterministic action: \${step.text}\` }],
          message,
          artifacts,
        }
      },
      async close() {
        if (process.env.PICKLE_TEST_CLOSE_MARKER) {
          await Bun.write(process.env.PICKLE_TEST_CLOSE_MARKER, 'closed')
        }
      },
    }
  },
}

export default {
  adapter,
  adapters: { custom: adapter },
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
    expect(stdout).toContain(`RUN  pickle 1.0.2 ${await realpath(workspace)}`)
    expect(stdout).toContain('✓ purchase.feature > Complete a purchase [')
    expect(stdout).not.toContain('[deterministic]')
    expect(stdout).toContain('Specifications  1')
    expect(stdout).toContain('Scenarios       1')
    expect(stdout).toContain('Test results    1 passed (1)')
    expect(stdout).toContain('Start at')
    expect(stdout).toContain('Duration')
    expect(stdout).not.toContain('\u001b[')
    expect(stdout).not.toContain('"kind":"run-event"')
    expect(stdout).not.toContain('"kind":"test-result"')
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
    expect(run.stderr.toString()).toStartWith('ERROR ')
    expect(run.stderr.toString()).toContain('Parser errors')
    expect(run.stderr.toString()).not.toContain('\n    at ')
    expect(run.stdout.toString()).not.toContain('Test results    ')
    expect(await Bun.file(marker).exists()).toBe(false)
    expect(await Bun.file(extensionMarker).exists()).toBe(false)
  })

  test('run reports invalid configuration as a concise command error', async () => {
    const project = await createCheckProject('run-invalid-configuration', {
      config: { schemaVersion: 99 },
      specification: validSpecification,
    })

    const run = runProject(project)
    const stderr = run.stderr.toString()

    expect(run.exitCode).toBe(2)
    expect(stderr).toStartWith('ERROR Invalid configuration')
    expect(stderr).toContain('Unsupported configuration schemaVersion: 99')
    expect(stderr).not.toContain('\n    at ')
    expect(run.stdout.toString()).toBe('')
  })

  test('run reports missing Specifications without a Test result summary', async () => {
    const project = await createCheckProject('run-missing-specifications', {
      config: {
        ...deterministicRunConfig,
        specifications: 'features/**/*.feature',
      },
      extensions: await Bun.file(
        join(workspace, 'pickle.extensions.ts'),
      ).text(),
    })

    const run = runProject(project)
    const stderr = run.stderr.toString()
    const stdout = run.stdout.toString()

    expect(run.exitCode).toBe(2)
    expect(stderr).toStartWith('ERROR No specifications found matching:')
    expect(stderr).not.toContain('\n    at ')
    expect(stdout).not.toContain('Specifications  ')
    expect(stdout).not.toContain('Test results    ')
  })

  test('run treats an empty Scenario selection as a command error', async () => {
    const project = await createCheckProject('run-empty-selection', {
      config: deterministicRunConfig,
      specification: validSpecification,
      extensions: await Bun.file(
        join(workspace, 'pickle.extensions.ts'),
      ).text(),
    })

    const run = Bun.spawnSync({
      cmd: [pickleCommand, 'run', '--scenario', 'Missing Scenario'],
      cwd: project,
      env: { ...Bun.env },
    })
    const stderr = run.stderr.toString()
    const stdout = run.stdout.toString()

    expect(run.exitCode).toBe(2)
    expect(stderr).toBe('ERROR No Scenarios match the current selection\n')
    expect(stdout).not.toContain('Specifications  ')
    expect(stdout).not.toContain('Test results    ')
  })

  test('run reports an application server startup failure as a command error', async () => {
    const project = await createCheckProject('run-server-start-failure', {
      config: {
        ...deterministicRunConfig,
        server: {
          command: 'exit 9',
          url: 'http://127.0.0.1:1',
          startupTimeoutMs: 20,
          pollIntervalMs: 5,
        },
      },
      specification: validSpecification,
      extensions: await Bun.file(
        join(workspace, 'pickle.extensions.ts'),
      ).text(),
    })

    const run = runProject(project)
    const stderr = run.stderr.toString()
    const stdout = run.stdout.toString()

    expect(run.exitCode).toBe(2)
    expect(stderr).toStartWith('ERROR Server failed to start within 20ms')
    expect(stderr).not.toContain('\n    at ')
    expect(stdout).not.toContain('Specifications  ')
    expect(stdout).not.toContain('Test results    ')
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
  }, 15_000)

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

    expect(run.exitCode).toBe(2)
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
          '--reporter',
          'ndjson',
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

  test('default run output preserves accepted adaptations and explains policy rejection', async () => {
    const extensions = await Bun.file(
      join(workspace, 'pickle.extensions.ts'),
    ).text()
    const project = await createCheckProject('adaptation-policy-output', {
      config: {
        ...deterministicRunConfig,
        policy: { adaptedResults: 'accept' },
      },
      specification: validSpecification,
      extensions,
    })
    const runAdapted = () =>
      runProject(project, {
        PICKLE_TEST_OUTCOME: 'passed-with-adaptation',
      })

    const accepted = runAdapted()

    expect(accepted.stderr.toString()).toBe('')
    expect(accepted.exitCode).toBe(0)
    expect(accepted.stdout.toString()).toContain(
      '~ features/example.feature > Validate project',
    )
    expect(accepted.stdout.toString()).toContain('(adapted)')
    expect(accepted.stdout.toString()).not.toContain(
      'Adaptation policy rejected the Test run',
    )

    await Bun.write(
      join(project, 'pickle.config.jsonc'),
      JSON.stringify({
        ...deterministicRunConfig,
        policy: { adaptedResults: 'reject' },
      }),
    )
    const rejected = runAdapted()
    const rejectedOutput = rejected.stdout.toString()

    expect(rejected.exitCode).toBe(1)
    expect(rejected.stderr.toString()).toBe('')
    expect(rejectedOutput).toContain(
      '~ features/example.feature > Validate project',
    )
    expect(rejectedOutput).toContain('(adapted)')
    expect(rejectedOutput).toContain(
      '! Adaptation policy rejected the Test run',
    )
    expect(rejectedOutput).toContain(
      '1 adapted Test result passed, but policy.adaptedResults is set to reject.',
    )
    expect(rejectedOutput).toContain(
      'The Test result remains adapted and pickle run exits with code 1.',
    )

    await Bun.write(
      join(project, 'pickle.config.jsonc'),
      JSON.stringify({
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        executionTargetProfiles: {
          web: { adapter: 'custom' },
          android: { adapter: 'custom' },
        },
        policy: { adaptedResults: 'reject' },
      }),
    )
    const rejectedWithCancellation = runProject(project, {
      PICKLE_TEST_OUTCOMES: 'passed-with-adaptation,cancelled',
    })
    const mixedOutput = rejectedWithCancellation.stdout.toString()

    expect(rejectedWithCancellation.exitCode).toBe(1)
    expect(rejectedWithCancellation.stderr.toString()).toBe('')
    expect(mixedOutput).toContain('~ [web] features/example.feature')
    expect(mixedOutput).toContain('○ [android] features/example.feature')
    expect(mixedOutput).toContain(
      'The Test result remains adapted and pickle run exits with code 1.',
    )
  })

  test('default run output reports flaky, skipped, and cancelled results truthfully', async () => {
    const extensions = await Bun.file(
      join(workspace, 'pickle.extensions.ts'),
    ).text()
    const flakyProject = await createCheckProject('flaky-result-output', {
      config: {
        ...deterministicRunConfig,
        execution: { functionalRetries: 1 },
      },
      specification: validSpecification,
      extensions,
    })

    const flaky = runProject(flakyProject, {
      PICKLE_TEST_OUTCOMES: 'failed,passed',
    })
    const flakyOutput = flaky.stdout.toString()

    expect(flaky.exitCode).toBe(0)
    expect(flaky.stderr.toString()).toBe('')
    expect(flakyOutput).toContain(
      '✓↻ features/example.feature > Validate project',
    )
    expect(flakyOutput).toContain('(passed; flaky, 2 attempts)')
    expect(flakyOutput).toContain(' Test results    1 passed (1)')
    expect(flakyOutput).toContain(' Flaky results   1')

    const skippedProject = await createCheckProject('skipped-result-output', {
      config: deterministicRunConfig,
      specification: {
        path: 'features/ignored.feature',
        source: `@pickle:id:specignoredaaaaaa @pickle:state:active
Feature: Ignored
  @pickle:id:scnignoredbbbbbb @ignore
  Scenario: Ignore this Scenario
    Then validation succeeds`,
      },
      extensions,
    })

    const skipped = runProject(skippedProject)
    const skippedOutput = skipped.stdout.toString()

    expect(skipped.exitCode).toBe(0)
    expect(skipped.stderr.toString()).toBe('')
    expect(skippedOutput).toContain(
      '↓ features/ignored.feature > Ignore this Scenario',
    )
    expect(skippedOutput).toContain('(skipped: Scenario is tagged @ignore)')
    expect(skippedOutput).toContain(' Specifications  1')
    expect(skippedOutput).toContain(' Scenarios       1')
    expect(skippedOutput).toContain(' Test results    1 skipped (1)')
    expect(skippedOutput).not.toContain(' Failures')
    expect(skippedOutput).not.toContain(' Infrastructure errors')

    const cancelledProject = await createCheckProject(
      'cancelled-result-output',
      {
        config: deterministicRunConfig,
        specification: validSpecification,
        extensions,
      },
    )

    const cancelled = runProject(cancelledProject, {
      PICKLE_TEST_OUTCOME: 'cancelled',
    })
    const cancelledOutput = cancelled.stdout.toString()

    expect(cancelled.exitCode).toBe(130)
    expect(cancelled.stderr.toString()).toBe('')
    expect(cancelledOutput).toContain(
      '○ features/example.feature > Validate project',
    )
    expect(cancelledOutput).toContain('(cancelled)')
    expect(cancelledOutput).not.toContain(' Failures')
    expect(cancelledOutput).not.toContain(' Infrastructure errors')
  })

  test('default run output keeps actionable result diagnostics on stdout', async () => {
    const artifactPath = join(workspace, 'diagnostic-artifact.txt')
    await Bun.write(artifactPath, 'diagnostic evidence')
    const cases = [
      {
        outcome: 'failed',
        section: 'Failures',
        label: '× Failure',
        step: '× Given a product is in the basket',
      },
      {
        outcome: 'infrastructure-error',
        section: 'Infrastructure errors',
        label: '! Infrastructure error',
        step: '! Given a product is in the basket',
      },
    ] as const

    for (const expected of cases) {
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
        env: {
          ...Bun.env,
          PICKLE_TEST_OUTCOME: expected.outcome,
          PICKLE_TEST_MESSAGE:
            'Expected checkout confirmation\nbut the target became unavailable',
          PICKLE_TEST_ARTIFACT: artifactPath,
        },
      })
      const stdout = run.stdout.toString()

      expect(run.exitCode).toBe(1)
      expect(run.stderr.toString()).toBe('')
      expect(stdout).toContain(` ${expected.section}`)
      expect(stdout).toContain(` ${expected.label}`)
      expect(stdout).toContain(expected.step)
      expect(stdout).toContain(
        '       Expected checkout confirmation\n' +
          '       but the target became unavailable',
      )
      expect(stdout).toContain('         trace: diagnostic-artifact.txt')
      expect(stdout).not.toContain('Deterministic action:')
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
        '--reporter',
        'ndjson',
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
    async launch() {
      let page = ''
      return {
        async openContext() {
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
            async readIsolationState() {
              return { cookieCount: 0, storageKeyCount: 0 }
            },
            async screenshot() { return new Uint8Array([137, 80, 78, 71]) },
            async close() {},
          }
        },
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
        '--reporter',
        'ndjson',
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
      cmd: [pickleCommand, 'run', '--suite', 'smoke', '--reporter', 'ndjson'],
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
      specification: {
        path: 'features/example.feature',
        source: `@pickle:id:specaaaaaaaaaaaa @pickle:state:active
Feature: Example
  @pickle:id:scnbbbbbbbbbbbb
  Scenario: Validate project
    Then validation succeeds
  @pickle:id:scncccccccccccc
  Scenario: Validate another behavior
    Then another validation succeeds`,
      },
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
      cmd: [pickleCommand, 'run', '--reporter', 'ndjson'],
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
      ['Validate another behavior', 'web', 'passed'],
      ['Validate another behavior', 'android', 'passed'],
    ])

    const [sourceManifest] = [
      ...new Bun.Glob('*/manifest.json').scanSync({
        cwd: join(project, '.pickle', 'runs'),
      }),
    ]
    const sourceId = dirname(sourceManifest!)
    const rerun = Bun.spawnSync({
      cmd: [pickleCommand, 'run', '--rerun', sourceId, '--reporter', 'ndjson'],
      cwd: project,
      env: { ...Bun.env },
    })
    const rerunRecords = rerun.stdout
      .toString()
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
    const rerunResults = rerunRecords.filter(
      (record) => record.kind === 'test-result',
    )
    const rerunFinishedEvents = rerunRecords.filter(
      (record) =>
        record.kind === 'run-event' &&
        record.event.type === 'scenario-finished',
    )

    expect(rerun.stderr.toString()).toBe('')
    expect(rerun.exitCode).toBe(0)
    expect(
      rerunResults.map((record) => [
        record.result.scenario.name,
        record.result.executionTargetProfile.id,
      ]),
    ).toEqual([
      ['Validate project', 'web'],
      ['Validate another behavior', 'web'],
      ['Validate project', 'android'],
      ['Validate another behavior', 'android'],
    ])
    expect(
      rerunFinishedEvents.map((record) => [
        record.event.result.scenario.name,
        record.event.result.executionTargetProfile.id,
        record.event.scheduleIndex,
      ]),
    ).toEqual([
      ['Validate project', 'web', 0],
      ['Validate another behavior', 'web', 1],
      ['Validate project', 'android', 0],
      ['Validate another behavior', 'android', 1],
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
    expect(run.stderr.toString()).toStartWith(
      'ERROR Execution target profile "web"',
    )
    expect(run.stderr.toString()).toContain(
      'Execution target profile "web" lacks required capabilities for Scenario "Show stores near the customer": geolocation',
    )
    expect(run.stderr.toString()).not.toContain('\n    at ')
    expect(run.stdout.toString()).not.toContain('Test results    ')
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

  test('runs Adaptive then Replay from reviewable plan files and rejects adapted results by policy', async () => {
    const extensions = await Bun.file(
      join(workspace, 'pickle.extensions.ts'),
    ).text()
    const project = await createCheckProject('execution-plans', {
      config: {
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        applicationRevision: 'app-1',
        executionTargetProfiles: {
          web: { adapter: 'custom' },
          android: { adapter: 'custom' },
        },
        policy: { adaptedResults: 'accept' },
      },
      specification: {
        path: 'features/purchase.feature',
        source: `@pickle:id:specpurchaseaaaaaa @pickle:state:active
Feature: Purchase
  @pickle:id:scnpurchasebbbbbb
  Scenario: Complete a purchase
    Given a product is in the basket
    Then the purchase succeeds`,
      },
      extensions,
    })
    const approvedPath = join(
      project,
      '.pickle',
      'plans',
      'web',
      'scnpurchasebbbbbb.json',
    )
    const candidatePath = join(
      project,
      '.pickle',
      'candidates',
      'web',
      'scnpurchasebbbbbb.json',
    )

    const first = Bun.spawnSync({
      cmd: [pickleCommand, 'run', '--profile', 'web', '--reporter', 'ndjson'],
      cwd: project,
      env: { ...Bun.env, PICKLE_TEST_OUTCOME: 'passed' },
    })
    const firstResult = JSON.parse(
      first.stdout.toString().trim().split('\n').at(-1) ?? '{}',
    )
    expect(first.exitCode).toBe(0)
    expect(firstResult).toMatchObject({
      kind: 'test-result',
      result: { state: 'passed', executionMode: 'adaptive' },
    })
    expect(await Bun.file(candidatePath).exists()).toBe(true)
    expect(await Bun.file(approvedPath).exists()).toBe(false)

    const candidate = JSON.parse(await Bun.file(candidatePath).text())
    expect(candidate).toMatchObject({
      schemaVersion: 1,
      scenarioId: 'scnpurchasebbbbbb',
      executionTargetProfileId: 'web',
      applicationRevision: 'app-1',
    })
    expect(candidate.steps[0].resolvedActions.length).toBeGreaterThanOrEqual(1)
    await mkdir(dirname(approvedPath), { recursive: true })
    await Bun.write(approvedPath, `${JSON.stringify(candidate, null, 2)}\n`)
    const approved = await Bun.file(approvedPath).text()
    await Bun.write(candidatePath, 'stale-candidate')

    const replay = Bun.spawnSync({
      cmd: [pickleCommand, 'run', '--profile', 'web', '--reporter', 'ndjson'],
      cwd: project,
      env: { ...Bun.env, PICKLE_TEST_OUTCOME: 'passed' },
    })
    expect(replay.exitCode).toBe(0)
    expect(
      JSON.parse(replay.stdout.toString().trim().split('\n').at(-1) ?? '{}'),
    ).toMatchObject({
      kind: 'test-result',
      result: { state: 'passed', executionMode: 'replay' },
    })
    expect(await Bun.file(approvedPath).text()).toBe(approved)
    expect(await Bun.file(candidatePath).text()).toBe('stale-candidate')

    const otherProfile = Bun.spawnSync({
      cmd: [
        pickleCommand,
        'run',
        '--profile',
        'android',
        '--reporter',
        'ndjson',
      ],
      cwd: project,
      env: { ...Bun.env, PICKLE_TEST_OUTCOME: 'passed' },
    })
    expect(otherProfile.exitCode).toBe(0)
    expect(
      JSON.parse(
        otherProfile.stdout.toString().trim().split('\n').at(-1) ?? '{}',
      ),
    ).toMatchObject({
      kind: 'test-result',
      result: {
        state: 'passed',
        executionMode: 'adaptive',
        executionTargetProfile: { id: 'android' },
      },
    })
    expect(await Bun.file(approvedPath).text()).toBe(approved)

    await Bun.write(
      join(project, 'pickle.config.jsonc'),
      JSON.stringify({
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        applicationRevision: 'app-1',
        executionTargetProfiles: {
          web: { adapter: 'custom' },
        },
        policy: { adaptedResults: 'reject' },
      }),
    )
    const rejected = Bun.spawnSync({
      cmd: [pickleCommand, 'run', '--profile', 'web', '--reporter', 'ndjson'],
      cwd: project,
      env: { ...Bun.env, PICKLE_TEST_OUTCOME: 'passed-with-adaptation' },
    })
    expect(rejected.exitCode).toBe(1)
    expect(
      JSON.parse(rejected.stdout.toString().trim().split('\n').at(-1) ?? '{}'),
    ).toMatchObject({
      kind: 'test-result',
      result: { state: 'passed-with-adaptation' },
    })
    expect(await Bun.file(approvedPath).text()).toBe(approved)
  })

  test('check rejects an unknown adapted-result policy', async () => {
    const project = await createCheckProject('invalid-adapted-policy', {
      config: {
        ...defaultCheckConfig,
        policy: { adaptedResults: 'ignore' },
      },
      specification: validSpecification,
    })

    const checked = runCheck(project)

    expect(checked.exitCode).toBe(2)
    expect(checked.stderr.toString()).toContain(
      'policy.adaptedResults must be accept or reject',
    )
    expect(checked.stderr.toString()).toContain(
      'Correct the value and run pickle check again',
    )
  })

  test('pickle run persists an immutable test run and writes stable CI outputs', async () => {
    const project = await createCheckProject('persisted-run', {
      config: {
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        executionTargetProfile: { id: 'deterministic' },
        artifacts: { capture: 'on-failure-or-adaptation' },
      },
      specification: {
        path: 'features/purchase.feature',
        source: `@pickle:id:specpurchaseaaaaaa @pickle:state:active
Feature: Purchase
  @pickle:id:scnpurchasebbbbbb
  Scenario: Complete a purchase
    Then the purchase succeeds`,
      },
      extensions: await Bun.file(
        join(workspace, 'pickle.extensions.ts'),
      ).text(),
    })
    const junitPath = join(project, 'results.xml')
    const jsonPath = join(project, 'results.json')
    const ndjsonPath = join(project, 'events.ndjson')

    const process = Bun.spawn({
      cmd: [
        pickleCommand,
        'run',
        '--junit',
        junitPath,
        '--json',
        jsonPath,
        '--ndjson',
        ndjsonPath,
        '--reporter',
        'ndjson',
      ],
      cwd: project,
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
    expect(stdout).toContain('"kind":"run-event"')

    const manifests = [
      ...new Bun.Glob('*/manifest.json').scanSync({
        cwd: join(project, '.pickle', 'runs'),
      }),
    ]
    expect(manifests).toHaveLength(1)
    const manifest = (await Bun.file(
      join(project, '.pickle', 'runs', manifests[0]!),
    ).json()) as {
      schemaVersion: number
      id: string
      state: string
      results: Array<{ state: string; scenario: { name: string } }>
    }
    expect(manifest).toMatchObject({
      schemaVersion: 1,
      state: 'passed',
      results: [{ state: 'passed', scenario: { name: 'Complete a purchase' } }],
    })
    const events = (
      await Bun.file(
        join(
          project,
          '.pickle',
          'runs',
          dirname(manifests[0]!),
          'events.ndjson',
        ),
      ).text()
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(events[0]).toMatchObject({
      schemaVersion: 1,
      sequence: 1,
      type: 'run-started',
      run: { id: manifest.id },
    })
    expect(JSON.parse(await Bun.file(jsonPath).text())).toMatchObject({
      schemaVersion: 1,
      id: manifest.id,
      state: 'passed',
    })
    expect(await Bun.file(junitPath).text()).toContain(
      'classname="features/purchase.feature"',
    )
    expect(
      (await Bun.file(ndjsonPath).text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual(events)
  })

  test('pickle run applies retention without changing a retained test run', async () => {
    const project = await createCheckProject('retention-run', {
      config: {
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        executionTargetProfile: { id: 'deterministic' },
        retention: { days: 14 },
      },
      specification: {
        path: 'features/purchase.feature',
        source: `@pickle:id:specpurchaseaaaaaa @pickle:state:active
Feature: Purchase
  @pickle:id:scnpurchasebbbbbb
  Scenario: Complete a purchase
    Then the purchase succeeds`,
      },
      extensions: await Bun.file(
        join(workspace, 'pickle.extensions.ts'),
      ).text(),
    })
    const expiredDirectory = join(project, '.pickle', 'runs', 'run-expired')
    await mkdir(expiredDirectory, { recursive: true })
    await Bun.write(
      join(expiredDirectory, 'events.ndjson'),
      `${JSON.stringify({
        schemaVersion: 1,
        sequence: 1,
        type: 'run-started',
        run: { id: 'run-expired' },
      })}\n`,
    )
    await Bun.write(
      join(expiredDirectory, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 1,
        id: 'run-expired',
        startedAt: '2026-07-01T00:00:00.000Z',
        finishedAt: '2026-07-01T00:00:01.000Z',
        state: 'passed',
        results: [],
      }),
    )
    const retainedDirectory = join(project, '.pickle', 'runs', 'run-retained')
    await mkdir(retainedDirectory, { recursive: true })
    const retainedEvents = `${JSON.stringify({
      schemaVersion: 1,
      sequence: 1,
      type: 'run-started',
      run: { id: 'run-retained' },
    })}\n`
    const retainedManifest = `${JSON.stringify({
      schemaVersion: 1,
      id: 'run-retained',
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      state: 'passed',
      results: [],
    })}\n`
    await Bun.write(join(retainedDirectory, 'events.ndjson'), retainedEvents)
    await Bun.write(join(retainedDirectory, 'manifest.json'), retainedManifest)

    const run = Bun.spawnSync({
      cmd: [pickleCommand, 'run'],
      cwd: project,
      env: { ...Bun.env, PICKLE_TEST_OUTCOME: 'passed' },
    })

    expect(run.exitCode).toBe(0)
    expect(
      await Bun.file(join(expiredDirectory, 'events.ndjson')).exists(),
    ).toBe(false)
    expect(
      await Bun.file(join(retainedDirectory, 'events.ndjson')).text(),
    ).toBe(retainedEvents)
    expect(
      await Bun.file(join(retainedDirectory, 'manifest.json')).text(),
    ).toBe(retainedManifest)
  })

  test('pickle run --rerun creates a new test run linked to its source', async () => {
    const project = await createCheckProject('rerun-source', {
      config: {
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        executionTargetProfile: { id: 'deterministic' },
      },
      specification: {
        path: 'features/purchase.feature',
        source: `@pickle:id:specpurchaseaaaaaa @pickle:state:active
Feature: Purchase
  @pickle:id:scnpurchasebbbbbb
  Scenario: Complete a purchase
    Then the purchase succeeds
  @pickle:id:scnpurchasecccccc
  Scenario: Pay for the order
    Then payment succeeds`,
      },
      extensions: `
const outcomes = {
  'the purchase succeeds': process.env.PICKLE_TEST_PURCHASE ?? 'passed',
  'payment succeeds': process.env.PICKLE_TEST_PAYMENT ?? 'failed',
}

export default {
  adapter: {
    async openSession() {
      return {
        async executeStep(step) {
          return {
            state: outcomes[step.text] ?? 'passed',
            resolvedActions: [{ description: \`Deterministic action: \${step.text}\` }],
          }
        },
        async close() {},
      }
    },
  },
}
`,
    })

    const first = Bun.spawnSync({
      cmd: [pickleCommand, 'run'],
      cwd: project,
      env: {
        ...Bun.env,
        PICKLE_TEST_PURCHASE: 'passed',
        PICKLE_TEST_PAYMENT: 'failed',
      },
    })
    expect(first.exitCode).toBe(1)
    const sourceManifests = [
      ...new Bun.Glob('*/manifest.json').scanSync({
        cwd: join(project, '.pickle', 'runs'),
      }),
    ]
    expect(sourceManifests).toHaveLength(1)
    const sourceId = dirname(sourceManifests[0]!)
    const sourceEvents = await Bun.file(
      join(project, '.pickle', 'runs', sourceId, 'events.ndjson'),
    ).text()

    const rerun = Bun.spawnSync({
      cmd: [pickleCommand, 'run', '--rerun', sourceId, '--failures'],
      cwd: project,
      env: {
        ...Bun.env,
        PICKLE_TEST_PURCHASE: 'passed',
        PICKLE_TEST_PAYMENT: 'passed',
      },
    })
    expect(rerun.stderr.toString()).toBe('')
    expect(rerun.exitCode).toBe(0)

    const manifests = [
      ...new Bun.Glob('*/manifest.json').scanSync({
        cwd: join(project, '.pickle', 'runs'),
      }),
    ]
    expect(manifests).toHaveLength(2)
    const rerunManifestPath = manifests.find(
      (path) => dirname(path) !== sourceId,
    )!
    const rerunManifest = (await Bun.file(
      join(project, '.pickle', 'runs', rerunManifestPath),
    ).json()) as {
      sourceRunId?: string
      results: Array<{ scenario: { name: string }; state: string }>
    }
    expect(rerunManifest.sourceRunId).toBe(sourceId)
    expect(rerunManifest.results).toHaveLength(1)
    expect(rerunManifest.results[0]).toMatchObject({
      scenario: { name: 'Pay for the order' },
      state: 'passed',
    })
    expect(
      await Bun.file(
        join(project, '.pickle', 'runs', sourceId, 'events.ndjson'),
      ).text(),
    ).toBe(sourceEvents)
  })

  test('pickle export and import move an immutable run archive between projects', async () => {
    const project = await createCheckProject('export-import', {
      config: {
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        executionTargetProfile: { id: 'deterministic' },
        artifacts: { capture: 'on-failure-or-adaptation' },
      },
      specification: {
        path: 'features/purchase.feature',
        source: `@pickle:id:specpurchaseaaaaaa @pickle:state:active
Feature: Purchase
  @pickle:id:scnpurchasebbbbbb
  Scenario: Complete a purchase
    Then the purchase succeeds`,
      },
      extensions: `
export default {
  adapter: {
    async openSession() {
      return {
        async executeStep(step) {
          const path = process.env.PICKLE_TEST_ARTIFACT
          return {
            state: 'failed',
            resolvedActions: [{ description: \`Deterministic action: \${step.text}\` }],
            artifacts: path
              ? [{ kind: 'screenshot', path, mediaType: 'image/png' }]
              : [],
          }
        },
        async close() {},
      }
    },
  },
}
`,
    })
    const artifactPath = join(project, 'failure.png')
    await Bun.write(artifactPath, 'png-bytes')
    const run = Bun.spawnSync({
      cmd: [pickleCommand, 'run'],
      cwd: project,
      env: { ...Bun.env, PICKLE_TEST_ARTIFACT: artifactPath },
    })
    expect(run.exitCode).toBe(1)
    const sourceId = dirname(
      [
        ...new Bun.Glob('*/manifest.json').scanSync({
          cwd: join(project, '.pickle', 'runs'),
        }),
      ][0]!,
    )
    const archivePath = join(project, 'run.archive.json')
    const exported = Bun.spawnSync({
      cmd: [pickleCommand, 'export', sourceId, '--archive', archivePath],
      cwd: project,
      env: { ...Bun.env },
    })
    expect(exported.exitCode).toBe(0)
    expect(await Bun.file(archivePath).exists()).toBe(true)
    const originalArchive = await Bun.file(archivePath).text()

    const target = await createCheckProject('import-target', {
      config: {
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        executionTargetProfile: { id: 'deterministic' },
      },
      specification: validSpecification,
      extensions: 'export default {}',
    })
    await Bun.write(join(target, 'incoming.json'), originalArchive)
    const imported = Bun.spawnSync({
      cmd: [pickleCommand, 'import', 'incoming.json'],
      cwd: target,
      env: { ...Bun.env },
    })
    expect(imported.exitCode).toBe(0)
    expect(await Bun.file(join(target, 'incoming.json')).text()).toBe(
      originalArchive,
    )
    expect(
      await Bun.file(
        join(target, '.pickle', 'archives', `${sourceId}.json`),
      ).text(),
    ).toBe(originalArchive)
    const compare = Bun.spawnSync({
      cmd: [pickleCommand, 'compare', sourceId, sourceId],
      cwd: target,
      env: { ...Bun.env },
    })
    expect(compare.exitCode).toBe(0)
    expect(JSON.parse(compare.stdout.toString())).toMatchObject({
      schemaVersion: 1,
      baselineRunId: sourceId,
      candidateRunId: sourceId,
      pairs: [],
      added: [],
      removed: [],
    })

    const htmlPath = join(project, 'report.html')
    const html = Bun.spawnSync({
      cmd: [pickleCommand, 'export', sourceId, '--html', htmlPath],
      cwd: project,
      env: { ...Bun.env },
    })
    expect(html.exitCode).toBe(0)
    expect(await Bun.file(htmlPath).text()).toContain('data:image/png;base64,')
  })

  test('records fast profile fidelity trade-offs through the CLI', async () => {
    const project = join(workspace, 'fast-profile')
    const applicationUrl = 'data:text/html,<button id="search">Search</button>'
    await mkdir(project, { recursive: true })
    await Bun.write(
      join(project, 'web.feature'),
      `@pickle:id:specwebfastaaaaaaa @pickle:state:active
Feature: Web search
  @pickle:id:scnwebfastbbbbbb
  Scenario: Search from the application
    When I search for pickles
    Then pickle results are visible`,
    )
    await Bun.write(
      join(project, 'pickle.config.jsonc'),
      JSON.stringify({
        schemaVersion: 1,
        executionTargetProfile: { id: 'web' },
        server: {
          command: 'exit 9',
          url: applicationUrl,
          reuseExisting: true,
        },
        web: { baseUrl: applicationUrl },
      }),
    )
    await Bun.write(
      join(project, 'web.extensions.ts'),
      `
export default {
  webAutomationFactory: {
    async launch() {
      return {
        async openContext() {
          return {
            async navigate() {},
            async observe() {
              return [{ description: 'Search for pickles', handle: 'search' }]
            },
            async act() { return { success: true } },
            async verify() {
              return { meetsExpectation: true, actualState: 'Ready' }
            },
            async readIsolationState() {
              return { cookieCount: 0, storageKeyCount: 0 }
            },
            async screenshot() { return new Uint8Array() },
            async close() {},
          }
        },
        close: async () => {},
      }
    },
  },
}
`,
    )

    const run = Bun.spawnSync({
      cmd: [
        pickleCommand,
        'run',
        'web.feature',
        '--config',
        'pickle.config.jsonc',
        '--extensions',
        'web.extensions.ts',
        '--fast',
        '--reporter',
        'ndjson',
      ],
      cwd: project,
      env: { ...Bun.env },
    })

    expect(run.stderr.toString()).toBe('')
    expect(run.exitCode).toBe(0)
    const result = JSON.parse(run.stdout.toString().trim().split('\n').at(-1)!)
    expect(result).toMatchObject({
      kind: 'test-result',
      result: {
        fidelityPolicy: {
          profile: 'fast',
          tradeOffs: [
            'block-image',
            'block-media',
            'block-font',
            'disable-animations',
          ],
        },
      },
    })
  })

  test('balances shards using the latest finished test run history', async () => {
    const project = join(workspace, 'shard-history')
    await mkdir(project, { recursive: true })
    await Bun.write(
      join(project, 'pickle.config.jsonc'),
      JSON.stringify({
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        executionTargetProfile: { id: 'deterministic' },
      }),
    )
    await Bun.write(
      join(project, 'pickle.extensions.ts'),
      await Bun.file(join(workspace, 'pickle.extensions.ts')).text(),
    )
    await mkdir(join(project, 'features'), { recursive: true })
    await Bun.write(
      join(project, 'features', 'fast.feature'),
      `@pickle:id:specfastaaaaaaaa @pickle:state:active
Feature: Fast checkout
  @pickle:id:scnfastbbbbbbbbbb
  Scenario: Fast checkout
    Then the purchase succeeds`,
    )
    await Bun.write(
      join(project, 'features', 'medium.feature'),
      `@pickle:id:specmediumaaaaaa @pickle:state:active
Feature: Medium checkout
  @pickle:id:scnmediumbbbbbbbb
  Scenario: Medium checkout
    Then the purchase succeeds`,
    )
    await Bun.write(
      join(project, 'features', 'slow.feature'),
      `@pickle:id:specslowaaaaaaaaa @pickle:state:active
Feature: Slow checkout
  @pickle:id:scnslowbbbbbbbbbb
  Scenario: Slow checkout
    Then the purchase succeeds`,
    )

    const { openTestRunStore } = await import('@pickle-spec/runner')
    const store = openTestRunStore({
      root: project,
      createId: () => 'prior-run',
      now: () => new Date('2026-08-15T12:00:00.000Z'),
    })
    const priorRun = await store.create()
    for (const [scenarioId, name, durationMs] of [
      ['scnfastbbbbbbbbbb', 'Fast checkout', 100],
      ['scnmediumbbbbbbbb', 'Medium checkout', 400],
      ['scnslowbbbbbbbbbb', 'Slow checkout', 900],
    ] as const) {
      await priorRun.append({
        type: 'scenario-finished',
        result: {
          schemaVersion: 1,
          specification: {
            name: `${name} spec`,
            uri: 'features/example.feature',
          },
          scenario: { name, id: scenarioId },
          executionTargetProfile: { id: 'deterministic' },
          state: 'passed',
          steps: [],
          durationMs,
        },
      })
    }
    await priorRun.materialize({ finished: true })

    const run = Bun.spawnSync({
      cmd: [pickleCommand, 'run', '--shard', '2/2', '--reporter', 'ndjson'],
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
    expect(records.map((record) => record.result.scenario.name)).toEqual([
      'Medium checkout',
    ])
  })

  test('check rejects an unknown artifact capture policy', async () => {
    const project = await createCheckProject('invalid-artifact-policy', {
      config: {
        ...defaultCheckConfig,
        artifacts: { capture: 'sometimes' },
      },
      specification: validSpecification,
    })

    const checked = runCheck(project)

    expect(checked.exitCode).toBe(2)
    expect(checked.stderr.toString()).toContain(
      'artifacts.capture must be off, on-failure-or-adaptation, or always',
    )
  })
})
