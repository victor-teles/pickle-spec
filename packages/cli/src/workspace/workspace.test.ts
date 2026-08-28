import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import {
  openTestRunStore,
  resolveLocalProjectStorage,
  type TestRunManifest,
} from '@pickle-spec/runner'

describe('public CLI workspace seam', () => {
  let workspace: string
  let pickleCommand: string

  function runsDirectory(project: string): string {
    return resolveLocalProjectStorage(project).runsDirectory
  }

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
    const packageDirectory = resolve(import.meta.dir, '../..')
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
    expect(await Bun.file(join(workspace, '.pickle')).exists()).toBe(false)
  }, 15_000)

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

  test('carries one initialized project through execution and result exports', async () => {
    const project = join(workspace, 'complete-workspace-lifecycle')
    await mkdir(project, { recursive: true })
    const initialized = Bun.spawnSync({
      cmd: [pickleCommand, 'init'],
      cwd: project,
      env: { ...Bun.env },
    })
    expect(initialized.exitCode).toBe(0)

    await mkdir(join(project, 'features'), { recursive: true })
    await Bun.write(
      join(project, 'features', 'release.feature'),
      `@pickle:id:specreleaseaaaaaa @pickle:state:active
Feature: Release acceptance
  @pickle:id:scnreleasebbbbbb
  Scenario: Export a completed result
    Then the release result is available`,
    )
    await Bun.write(
      join(project, 'pickle.config.jsonc'),
      JSON.stringify(deterministicRunConfig),
    )
    await Bun.write(
      join(project, 'pickle.extensions.ts'),
      `export default {
  adapter: {
    async openSession() {
      return {
        async executeStep(step) {
          return {
            state: 'passed',
            resolvedActions: [{ description: \`Complete: \${step.text}\` }],
          }
        },
        async close() {},
      }
    },
  },
}`,
    )

    const run = runProject(project)
    expect(run.stderr.toString()).toBe('')
    expect(run.exitCode).toBe(0)
    const manifests = [
      ...new Bun.Glob('*/manifest.json').scanSync({
        cwd: runsDirectory(project),
      }),
    ]
    expect(manifests).toHaveLength(1)
    const runId = dirname(manifests[0]!)
    const manifest = (await Bun.file(
      join(runsDirectory(project), manifests[0]!),
    ).json()) as {
      id: string
      finishedAt?: string
      state: string
      results: Array<{ scenario: { name: string }; state: string }>
    }
    expect(manifest).toMatchObject({
      id: runId,
      state: 'passed',
      results: [
        {
          scenario: { name: 'Export a completed result' },
          state: 'passed',
        },
      ],
    })
    expect(manifest.finishedAt).toBeDefined()

    const archivePath = join(project, 'release-run.archive.json')
    const archive = Bun.spawnSync({
      cmd: [
        pickleCommand,
        'export',
        runId,
        '--output',
        `archive=${archivePath}`,
      ],
      cwd: project,
      env: { ...Bun.env },
    })
    expect(archive.stderr.toString()).toBe('')
    expect(archive.exitCode).toBe(0)
    const exportedArchive = (await Bun.file(archivePath).json()) as {
      schemaVersion: number
      kind: string
      manifest: { schemaVersion: number; id: string; state: string }
      events: Array<{
        schemaVersion: number
        sequence: number
        type: string
        run?: { id: string }
      }>
    }
    expect(exportedArchive).toMatchObject({
      schemaVersion: 2,
      kind: 'run-archive',
      manifest: { schemaVersion: 2, id: runId, state: 'passed' },
    })
    expect(exportedArchive.events[0]).toMatchObject({
      schemaVersion: 2,
      sequence: 1,
      type: 'run-started',
      run: { id: runId },
    })
    expect(
      exportedArchive.events.every((event) => event.schemaVersion === 2),
    ).toBe(true)
    expect(
      exportedArchive.events.some(
        (event) => event.type === 'scenario-finished',
      ),
    ).toBe(true)

    const htmlPath = join(project, 'release-run.html')
    const html = Bun.spawnSync({
      cmd: [pickleCommand, 'export', runId, '--output', `html=${htmlPath}`],
      cwd: project,
      env: { ...Bun.env },
    })
    expect(html.stderr.toString()).toBe('')
    expect(html.exitCode).toBe(0)
    expect(await Bun.file(htmlPath).text()).toContain(
      '<h2>Export a completed result</h2>',
    )
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

  test('check accepts CDP web browser configuration', async () => {
    const project = await createCheckProject('cdp-web-policy', {
      config: {
        ...defaultCheckConfig,
        web: {
          baseUrl: 'https://example.com',
          browser: {
            environment: 'local',
            cdpUrl: 'wss://browser.example.test/session',
            cdpExtensionId: 'stagehand-extension',
          },
        },
      },
      specification: validSpecification,
    })

    const checked = runCheck(project)

    expect(checked.exitCode).toBe(0)
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
          schemaVersion: 2,
          state: expected.outcome,
        },
      })
    }
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
    expect(flakyOutput).toContain(
      '(passed; flaky, 2 attempts; mode Adaptive; 0 inferences)',
    )
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
    expect(skippedOutput).toContain(
      '(skipped: Scenario is tagged @ignore; mode Adaptive; 0 inferences)',
    )
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
    expect(cancelledOutput).toContain(
      '(cancelled; mode Adaptive; 0 inferences)',
    )
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
      env: {
        ...Bun.env,
        PICKLE_CACHE_ROOT: join(workspace, '.test-execution-cache'),
      },
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
        schemaVersion: 2,
        specification: { name: 'Web search' },
        scenario: { name: 'Search from the application' },
        executionTargetProfile: { id: 'web' },
        state: 'passed',
        attempts: [
          {
            steps: [
              { artifacts: [{ kind: 'screenshot', mediaType: 'image/png' }] },
              { resolvedActions: [{ description: 'Search for pickles' }] },
              { state: 'passed' },
            ],
          },
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

  test('persists and exports canonical evidence for a failing Web Scenario Outline', async () => {
    const project = await createCheckProject('web-evidence', {
      config: {
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        executionTargetProfile: { id: 'chrome' },
        artifacts: { capture: 'on-failure' },
        web: {
          baseUrl:
            'data:text/html,<button id="pay">Pay</button><div id="status"></div>',
          screenshots: { mode: 'on-failure' },
        },
      },
      specification: {
        path: 'features/checkout.feature',
        source: `@pickle:id:speccheckaaaaaaaa @pickle:state:active
Feature: Checkout
  @pickle:id:scnpaybbbbbbbbbb
  Scenario Outline: Pay for the order
    When I click pay with <method>
    Then payment is captured

    @pickle:id:exspaycccccccccc
    Examples:
      | pickle_id        | method |
      | rowpaydddddddddd | card   |`,
      },
      extensions: `
export default {
  webAutomationFactory: {
    async launch() {
      return {
        async openContext() {
          return {
            async navigate() {},
            async observe() {
              return [{ description: 'Click pay on chrome', handle: 'pay' }]
            },
            async act() { return { success: true } },
            async verify() {
              return {
                meetsExpectation: false,
                actualState: 'Payment was declined',
              }
            },
            async readIsolationState() {
              return { cookieCount: 0, storageKeyCount: 0 }
            },
            async screenshot() {
              return new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
            },
            async close() {},
          }
        },
        async close() {},
      }
    },
  },
}
`,
    })
    const pickleHome = join(workspace, 'web-evidence-pickle-home')
    const jsonPath = join(project, 'result.json')
    const ndjsonPath = join(project, 'events.ndjson')

    const child = Bun.spawn({
      cmd: [
        pickleCommand,
        'run',
        '--output',
        `json=${jsonPath}`,
        '--output',
        `ndjson=${ndjsonPath}`,
        '--reporter',
        'ndjson',
      ],
      cwd: project,
      env: { ...Bun.env, PICKLE_HOME: pickleHome },
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])

    expect(stderr).toContain(`OUTPUT succeeded json=${jsonPath}`)
    expect(stderr).toContain(`OUTPUT succeeded ndjson=${ndjsonPath}`)
    expect(exitCode).toBe(1)
    expect(stdout).toContain('Payment was declined')

    const storage = resolveLocalProjectStorage(project, pickleHome)
    const manifestPaths = [
      ...new Bun.Glob('*/manifest.json').scanSync({
        cwd: storage.runsDirectory,
      }),
    ]
    expect(manifestPaths).toHaveLength(1)
    const runId = dirname(manifestPaths[0]!)
    const runDirectory = join(storage.runsDirectory, runId)
    const manifest = (await Bun.file(
      join(runDirectory, 'manifest.json'),
    ).json()) as TestRunManifest

    expect(manifest.schemaVersion).toBe(2)
    expect(manifest.id).toBe(runId)
    expect(manifest.state).toBe('failed')
    expect(manifest.results).toHaveLength(1)
    const result = manifest.results[0]!
    expect(result.schemaVersion).toBe(2)
    expect(result.specification).toEqual({
      name: 'Checkout',
      uri: 'features/checkout.feature',
    })
    expect(result.scenario).toEqual({
      name: 'Pay for the order',
      id: 'scnpaybbbbbbbbbb',
      examplesId: 'exspaycccccccccc',
      examplesRowId: 'rowpaydddddddddd',
    })
    expect(result.executionTargetProfile.id).toBe('chrome')
    expect(result.state).toBe('failed')
    expect(result.attempts).toHaveLength(1)
    const attempt = result.attempts[0]!
    expect(attempt.attempt).toBe(1)
    expect(attempt.state).toBe('failed')
    expect(attempt.steps).toHaveLength(2)
    const actionStep = attempt.steps[0]!
    expect(actionStep.index).toBe(0)
    expect(actionStep.state).toBe('passed')
    expect(actionStep.resolvedActions).toEqual([
      { description: 'Click pay on chrome' },
    ])
    const outcomeStep = attempt.steps[1]!
    expect(outcomeStep.index).toBe(1)
    expect(outcomeStep.state).toBe('failed')
    expect(outcomeStep.resolvedActions).toEqual([
      { description: 'Verify: payment is captured' },
    ])
    expect(outcomeStep.message).toBe(
      'Expected: "payment is captured" | Actual: Payment was declined',
    )
    expect(outcomeStep.artifacts).toHaveLength(1)
    const screenshot = outcomeStep.artifacts?.[0]
    expect(screenshot?.kind).toBe('screenshot')
    expect(typeof screenshot?.path).toBe('string')
    expect(screenshot?.mediaType).toBe('image/png')
    expect(screenshot?.name).toMatch(/\.png$/)
    expect(typeof screenshot?.sizeBytes).toBe('number')
    expect(screenshot?.capturedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(attempt.evidenceAvailability).toContainEqual({
      kind: 'screenshot',
      state: 'available',
    })
    expect(Date.parse(result.startedAt)).not.toBeNaN()
    expect(Date.parse(result.finishedAt)).not.toBeNaN()
    expect(result.durationMs).toBeGreaterThanOrEqual(0)
    expect(Date.parse(attempt.startedAt)).not.toBeNaN()
    expect(Date.parse(attempt.finishedAt)).not.toBeNaN()
    expect(attempt.durationMs).toBeGreaterThanOrEqual(0)
    for (const step of attempt.steps) {
      expect(Date.parse(step.startedAt)).not.toBeNaN()
      expect(Date.parse(step.finishedAt)).not.toBeNaN()
      expect(step.durationMs).toBeGreaterThanOrEqual(0)
    }

    expect(
      resolve(screenshot!.path).startsWith(
        `${resolve(join(runDirectory, 'artifacts'))}${sep}`,
      ),
    ).toBe(true)
    expect(await Bun.file(screenshot!.path).exists()).toBe(true)

    const reopened = await openTestRunStore({ root: project, pickleHome }).open(
      runId,
    )
    expect(await reopened.materialize()).toEqual(manifest)
    expect(await Bun.file(jsonPath).json()).toEqual(manifest)
    expect(
      (await Bun.file(ndjsonPath).text())
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line)),
    ).toEqual(await reopened.events())
    expect(await Bun.file(join(project, '.pickle')).exists()).toBe(false)
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
        cwd: runsDirectory(project),
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
        record.event.scenario.name,
        record.event.executionTargetProfile.id,
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

  test('composes declarative Android and iOS profiles before allocating mobile resources', async () => {
    const projectName = 'mobile-profile-capabilities'
    const projectPath = join(workspace, projectName)
    const marker = join(projectPath, 'server-started.txt')
    const project = await createCheckProject(projectName, {
      config: {
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        executionTargetProfiles: {
          android: {
            adapter: 'mobile',
            capabilities: ['android'],
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
            capabilities: ['ios'],
            mobile: {
              executionTarget: 'ios-simulator',
              application: {
                id: 'com.example.checkout',
                binaryPath: '/apps/Checkout.app',
              },
            },
          },
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
    })

    const run = Bun.spawnSync({
      cmd: [pickleCommand, 'run'],
      cwd: project,
      env: { ...Bun.env },
    })

    expect(run.exitCode).toBe(2)
    expect(run.stderr.toString()).toContain(
      'Execution target profile "android" lacks required capabilities for Scenario "Show stores near the customer": geolocation',
    )
    expect(run.stderr.toString()).not.toContain('mobile worker')
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

  test('ignores a poisoned legacy .pickle/plans file and runs the custom adapter Adaptively', async () => {
    const extensions = await Bun.file(
      join(workspace, 'pickle.extensions.ts'),
    ).text()
    const project = await createCheckProject('ignored-legacy-plan', {
      config: {
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        applicationRevision: 'app-1',
        executionTargetProfiles: { web: { adapter: 'custom' } },
      },
      specification: validSpecification,
      extensions,
    })
    const poisonedPath = join(
      project,
      '.pickle',
      'plans',
      'web',
      'scnvalidbbbbbbbb.json',
    )
    await mkdir(dirname(poisonedPath), { recursive: true })
    await Bun.write(poisonedPath, 'poisoned legacy data')

    const run = Bun.spawnSync({
      cmd: [pickleCommand, 'run', '--profile', 'web', '--reporter', 'ndjson'],
      cwd: project,
      env: { ...Bun.env, PICKLE_TEST_OUTCOME: 'passed' },
    })

    expect(run.exitCode).toBe(0)
    expect(run.stdout.toString()).toContain('"executionMode":"adaptive"')
    expect(await Bun.file(poisonedPath).text()).toBe('poisoned legacy data')
  })

  test('runs Adaptive, Replay, refresh, and explicit CI cache-only through the local Execution cache', async () => {
    const project = await createCheckProject('execution-cache-lifecycle', {
      config: {
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        applicationRevision: 'app-1',
        cache: { maxBytes: 1024 * 1024 },
        executionTargetProfile: { id: 'deterministic' },
      },
      specification: validSpecification,
      extensions: `
const marker = process.env.PICKLE_CACHE_TEST_MARKER
const behavior = process.env.PICKLE_CACHE_TEST_BEHAVIOR

async function record(value) {
  if (!marker) return
  const previous = await Bun.file(marker).exists()
    ? await Bun.file(marker).text()
    : ''
  await Bun.write(marker, previous + value + '\\n')
}

export default {
  adapter: {
    executionCache: {
      adapterKind: 'cli-deterministic',
      adapterCacheSchemaVersion: '1',
      targetConfigurationFingerprint: 'cli-target-1',
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
      await record(input.mode)
      return {
        async executeStep(_step, _signal, context) {
          const evaluation = context?.evaluation ?? input.mode
          if (evaluation === 'replay' && behavior === 'diverge') {
            return {
              state: 'failed',
              replayDiverged: true,
              resolvedActions: [],
            }
          }
          return { state: 'passed', resolvedActions: [] }
        },
        async complete() {
          return {
            inferenceCount: input.mode === 'adaptive' ? 1 : 0,
            evaluationModel: 'deterministic-fixture',
            replayRepresentation:
              behavior === 'uncacheable'
                ? {
                    cacheable: false,
                    reason: 'non-deterministic-assertion',
                  }
                : {
                    cacheable: true,
                    adapterPayload: { operations: ['assert:validation'] },
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
    })
    const marker = join(project, 'cache-modes.txt')
    const cacheRoot = join(project, '.test-execution-cache')
    const runWithBehavior = (
      behavior: string | undefined,
      ...flags: string[]
    ) =>
      Bun.spawnSync({
        cmd: [pickleCommand, 'run', '--reporter', 'ndjson', ...flags],
        cwd: project,
        env: {
          ...Bun.env,
          CI: 'true',
          PICKLE_CACHE_ROOT: cacheRoot,
          PICKLE_CACHE_TEST_MARKER: marker,
          PICKLE_CACHE_TEST_BEHAVIOR: behavior,
        },
      })
    const run = (...flags: string[]) => runWithBehavior(undefined, ...flags)

    const adaptive = run()
    const replay = run('--cache-only')
    const refresh = run('--refresh-cache')
    const cold = run('--cache-only', '--application-revision', 'app-2')
    const conflicting = run('--cache-only', '--refresh-cache')
    const fallback = runWithBehavior('diverge')
    const uncacheable = runWithBehavior('uncacheable', '--refresh-cache')

    expect(adaptive.stderr.toString()).toBe('')
    expect(adaptive.exitCode).toBe(0)
    expect(replay.exitCode).toBe(0)
    expect(refresh.exitCode).toBe(0)
    expect(cold.exitCode).toBe(1)
    expect(conflicting.exitCode).toBe(2)
    expect(fallback.exitCode).toBe(0)
    expect(uncacheable.exitCode).toBe(0)
    expect(conflicting.stderr.toString()).toContain(
      '--refresh-cache cannot be combined with --cache-only',
    )
    expect(await Bun.file(marker).text()).toBe(
      'adaptive\nreplay\nadaptive\nreplay\nadaptive\n',
    )
    expect(replay.stdout.toString()).toContain('"executionMode":"replay"')
    expect(replay.stdout.toString()).toContain('"cacheOutcome":"hit"')
    expect(replay.stdout.toString()).toContain('"inferenceCount":0')
    expect(refresh.stdout.toString()).toContain('"cacheOutcome":"refresh"')
    expect(refresh.stdout.toString()).toContain('"inferenceCount":1')
    expect(cold.stdout.toString()).toContain('"failureKind":"cache-miss"')
    expect(cold.stdout.toString()).toContain('"inferenceCount":0')
    expect(fallback.stdout.toString()).toContain(
      '"type":"adaptive-fallback-started"',
    )
    expect(fallback.stdout.toString()).toContain('"cacheOutcome":"miss"')
    expect(uncacheable.stdout.toString()).toContain('"state":"passed"')
    expect(uncacheable.stdout.toString()).toContain(
      '"cacheOutcome":"uncacheable"',
    )
  })

  test('check rejects the removed policy field', async () => {
    const project = await createCheckProject('removed-policy', {
      config: {
        ...defaultCheckConfig,
        policy: { adaptedResults: 'ignore' },
      },
      specification: validSpecification,
    })

    const checked = runCheck(project)

    expect(checked.exitCode).toBe(2)
    expect(checked.stderr.toString()).toContain(
      'configuration.policy is not supported',
    )
    expect(checked.stderr.toString()).toContain(
      'Correct the value and run pickle check again',
    )
  })

  test('run rejects the removed --adaptations option', async () => {
    const run = Bun.spawnSync({
      cmd: [pickleCommand, 'run', '--adaptations'],
      cwd: workspace,
    })

    expect(run.exitCode).toBe(2)
    expect(run.stderr.toString()).toContain('Unknown option: --adaptations')
  })

  test('pickle run persists an immutable test run and writes stable CI outputs', async () => {
    const project = await createCheckProject('persisted-run', {
      config: {
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        executionTargetProfile: { id: 'deterministic' },
        artifacts: { capture: 'on-failure' },
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
        '--output',
        `junit=${junitPath}`,
        '--output',
        `json=${jsonPath}`,
        '--output',
        `ndjson=${ndjsonPath}`,
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

    expect(stderr).toContain(`OUTPUT succeeded junit=${junitPath}`)
    expect(stderr).toContain(`OUTPUT succeeded json=${jsonPath}`)
    expect(stderr).toContain(`OUTPUT succeeded ndjson=${ndjsonPath}`)
    expect(exitCode).toBe(0)
    expect(stdout).toContain('"kind":"run-event"')
    expect(stdout).not.toContain('OUTPUT succeeded')

    const manifests = [
      ...new Bun.Glob('*/manifest.json').scanSync({
        cwd: runsDirectory(project),
      }),
    ]
    expect(manifests).toHaveLength(1)
    const manifest = (await Bun.file(
      join(runsDirectory(project), manifests[0]!),
    ).json()) as {
      schemaVersion: number
      id: string
      state: string
      results: Array<{ state: string; scenario: { name: string } }>
    }
    expect(manifest).toMatchObject({
      schemaVersion: 2,
      state: 'passed',
      results: [{ state: 'passed', scenario: { name: 'Complete a purchase' } }],
    })
    const events = (
      await Bun.file(
        join(runsDirectory(project), dirname(manifests[0]!), 'events.ndjson'),
      ).text()
    )
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line))
    expect(events[0]).toMatchObject({
      schemaVersion: 2,
      sequence: 1,
      type: 'run-started',
      run: { id: manifest.id },
    })
    expect(JSON.parse(await Bun.file(jsonPath).text())).toMatchObject({
      schemaVersion: 2,
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
    const expiredDirectory = join(runsDirectory(project), 'run-expired')
    const expiredStartedAt = '2026-07-01T00:00:00.000Z'
    const expiredFinishedAt = '2026-07-01T00:00:01.000Z'
    await mkdir(expiredDirectory, { recursive: true })
    await Bun.write(
      join(expiredDirectory, 'events.ndjson'),
      `${JSON.stringify({
        schemaVersion: 2,
        sequence: 1,
        occurredAt: expiredStartedAt,
        type: 'run-started',
        run: { id: 'run-expired', startedAt: expiredStartedAt },
      })}\n`,
    )
    await Bun.write(
      join(expiredDirectory, 'manifest.json'),
      JSON.stringify({
        schemaVersion: 2,
        id: 'run-expired',
        startedAt: expiredStartedAt,
        finishedAt: expiredFinishedAt,
        state: 'passed',
        results: [],
      }),
    )
    const retainedDirectory = join(runsDirectory(project), 'run-retained')
    const retainedAt = new Date().toISOString()
    await mkdir(retainedDirectory, { recursive: true })
    const retainedEvents = `${JSON.stringify({
      schemaVersion: 2,
      sequence: 1,
      occurredAt: retainedAt,
      type: 'run-started',
      run: { id: 'run-retained', startedAt: retainedAt },
    })}\n`
    const retainedManifest = `${JSON.stringify({
      schemaVersion: 2,
      id: 'run-retained',
      startedAt: retainedAt,
      finishedAt: retainedAt,
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
        cwd: runsDirectory(project),
      }),
    ]
    expect(sourceManifests).toHaveLength(1)
    const sourceId = dirname(sourceManifests[0]!)
    const sourceEvents = await Bun.file(
      join(runsDirectory(project), sourceId, 'events.ndjson'),
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
        cwd: runsDirectory(project),
      }),
    ]
    expect(manifests).toHaveLength(2)
    const rerunManifestPath = manifests.find(
      (path) => dirname(path) !== sourceId,
    )!
    const rerunManifest = (await Bun.file(
      join(runsDirectory(project), rerunManifestPath),
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
        join(runsDirectory(project), sourceId, 'events.ndjson'),
      ).text(),
    ).toBe(sourceEvents)
  })

  test('pickle export and import move an immutable run archive between projects', async () => {
    const project = await createCheckProject('export-import', {
      config: {
        schemaVersion: 1,
        specifications: 'features/**/*.feature',
        executionTargetProfile: { id: 'deterministic' },
        artifacts: { capture: 'on-failure' },
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
          cwd: runsDirectory(project),
        }),
      ][0]!,
    )
    const archivePath = join(project, 'run.archive.json')
    const allurePath = join(project, 'allure-results')
    const exported = Bun.spawnSync({
      cmd: [
        pickleCommand,
        'export',
        sourceId,
        '--output',
        `archive=${archivePath}`,
        '--output',
        `allure=${allurePath}`,
      ],
      cwd: project,
      env: { ...Bun.env },
    })
    expect(exported.exitCode).toBe(0)
    expect(await Bun.file(archivePath).exists()).toBe(true)
    const allureResultPaths = [
      ...new Bun.Glob('*-result.json').scanSync({ cwd: allurePath }),
    ]
    expect(allureResultPaths).toHaveLength(1)
    expect(
      await Bun.file(join(allurePath, allureResultPaths[0]!)).json(),
    ).toMatchObject({
      testCaseId: 'scnpurchasebbbbbb',
      status: 'failed',
      labels: expect.arrayContaining([
        { name: 'executionTargetProfile', value: 'deterministic' },
      ]),
    })
    expect([
      ...new Bun.Glob('*-attachment.png').scanSync({ cwd: allurePath }),
    ]).toHaveLength(1)
    const originalArchive = await Bun.file(archivePath).text()

    const siblingHtmlPath = join(project, 'sibling.html')
    const partial = Bun.spawnSync({
      cmd: [
        pickleCommand,
        'export',
        sourceId,
        '--output',
        `archive=${archivePath}`,
        '--output',
        `html=${siblingHtmlPath}`,
      ],
      cwd: project,
      env: { ...Bun.env },
    })
    expect(partial.exitCode).toBe(2)
    expect(partial.stdout.toString()).toContain(
      `OUTPUT failed archive=${archivePath}`,
    )
    expect(partial.stdout.toString()).toContain(
      `OUTPUT succeeded html=${siblingHtmlPath}`,
    )
    expect(await Bun.file(archivePath).text()).toBe(originalArchive)
    expect(await Bun.file(siblingHtmlPath).exists()).toBe(true)

    const forced = Bun.spawnSync({
      cmd: [
        pickleCommand,
        'export',
        sourceId,
        '--output',
        `archive=${archivePath}`,
        '--force',
      ],
      cwd: project,
      env: { ...Bun.env },
    })
    expect(forced.exitCode).toBe(0)

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
        join(
          resolveLocalProjectStorage(target).archivesDirectory,
          `${sourceId}.json`,
        ),
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
      cmd: [pickleCommand, 'export', sourceId, '--output', `html=${htmlPath}`],
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
      env: {
        ...Bun.env,
        PICKLE_CACHE_ROOT: join(project, '.test-execution-cache'),
      },
    })

    expect(run.stderr.toString()).toBe('')
    expect(run.exitCode).toBe(0)
    const result = JSON.parse(run.stdout.toString().trim().split('\n').at(-1)!)
    expect(result).toMatchObject({
      kind: 'test-result',
      result: {
        attempts: [
          {
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
        ],
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
      const startedAt = '2026-08-15T12:00:00.000Z'
      const finishedAt = new Date(
        Date.parse(startedAt) + durationMs,
      ).toISOString()
      const specification = {
        name: `${name} spec`,
        uri: 'features/example.feature',
      }
      const scenario = { name, id: scenarioId }
      const executionTargetProfile = { id: 'deterministic' }
      await priorRun.append({
        type: 'scenario-finished',
        specification,
        scenario,
        executionTargetProfile,
        scope: {
          scenarioId,
          executionTargetProfileId: executionTargetProfile.id,
          attempt: 1,
        },
        attempt: {
          attempt: 1,
          startedAt,
          finishedAt,
          durationMs,
          state: 'passed',
          steps: [],
          executionMode: 'adaptive',
          cacheOutcome: 'uncacheable',
          inferenceCount: 0,
          evidenceAvailability: [
            { kind: 'screenshot', state: 'not-supported' },
            { kind: 'trace', state: 'not-supported' },
            { kind: 'recording', state: 'not-supported' },
            { kind: 'device-log', state: 'not-supported' },
            { kind: 'diagnostics', state: 'not-supported' },
          ],
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
      'artifacts.capture must be off, on-failure, or always',
    )
  })
})
