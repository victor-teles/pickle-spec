import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { resolveLocalProjectStorage } from '@pickle-spec/runner'
import { afterAll, beforeAll, expect, test } from 'vitest'
import { requiredValue } from '../../../src/required-value'

let workspace: string
let pickleCommand: string

type PackageManifest = {
  bin: { pickle: string }
}

type InteractiveRunOptions = {
  cmd: string[]
  cwd: string
  env: Record<string, string | undefined>
}

function spawnInteractiveRun(options: InteractiveRunOptions) {
  const output: string[] = []
  const decoder = new TextDecoder()
  const child = Bun.spawn({
    ...options,
    terminal: {
      cols: 80,
      rows: 24,
      data(_terminal, data) {
        output.push(decoder.decode(data, { stream: true }))
      },
    },
  })
  return {
    child,
    output,
    async finish() {
      const exitCode = await child.exited
      output.push(decoder.decode())
      child.terminal?.close()
      return { exitCode, output: output.join('') }
    },
  }
}

async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000
  while (!(await Bun.file(path).exists())) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`)
    await Bun.sleep(5)
  }
}

async function waitForOutput(
  output: readonly string[],
  expected: string,
): Promise<string> {
  const deadline = Date.now() + 5_000
  while (!output.join('').includes(expected)) {
    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for output: ${expected}`)
    }
    await Bun.sleep(5)
  }
  return output.join('')
}

beforeAll(async () => {
  workspace = await mkdtemp(join(tmpdir(), 'pickle-run-live-'))
  const packageDirectory = resolve(import.meta.dir, '../../..')
  const packageManifest = (await Bun.file(
    join(packageDirectory, 'package.json'),
  ).json()) as PackageManifest
  pickleCommand = join(workspace, 'node_modules', '.bin', 'pickle')
  await mkdir(join(workspace, 'node_modules', '.bin'), { recursive: true })
  await symlink(
    resolve(packageDirectory, packageManifest.bin.pickle),
    pickleCommand,
  )
})

afterAll(async () => {
  await rm(workspace, { recursive: true, force: true })
})

test('shows deterministic concurrent Scenario completion through an interactive pickle run', async () => {
  const project = join(workspace, 'concurrent-progress')
  const gates = join(project, 'gates')
  await mkdir(join(project, 'features'), { recursive: true })
  await mkdir(gates, { recursive: true })
  await Bun.write(
    join(project, 'pickle.config.jsonc'),
    JSON.stringify({
      schemaVersion: 1,
      specifications: 'features/**/*.feature',
      executionTargetProfile: { id: 'deterministic' },
      concurrency: 2,
    }),
  )
  await Bun.write(
    join(project, 'pickle.extensions.ts'),
    `
const gateDirectory = process.env.PICKLE_TEST_GATE_DIRECTORY

export default {
  adapter: {
    async openSession() {
      return {
        async executeStep(step, signal) {
          await Bun.write(\`\${gateDirectory}/\${step.text}.started\`, '')
          while (!(await Bun.file(\`\${gateDirectory}/\${step.text}.release\`).exists())) {
            if (signal?.aborted) throw new DOMException('Scenario cancelled', 'AbortError')
            await Bun.sleep(5)
          }
          return { state: 'passed', resolvedActions: [] }
        },
        async close() {},
      }
    },
  },
}
`,
  )
  await Bun.write(
    join(project, 'features', 'progress.feature'),
    `@pickle:id:specaaaaaaaaaaaa @pickle:state:active
Feature: Streaming Specification
  @pickle:id:scnaaaaaaaaaaaa
  Scenario: First result appears last
    Then first
  @pickle:id:scnbbbbbbbbbbbb
  Scenario: Second result appears first
    Then second`,
  )

  const interactiveRun = spawnInteractiveRun({
    cmd: [pickleCommand, 'run'],
    cwd: project,
    env: {
      ...Bun.env,
      NO_COLOR: '1',
      PICKLE_TEST_GATE_DIRECTORY: gates,
      TERM: 'xterm-256color',
    },
  })
  const { child, output } = interactiveRun

  await Promise.race([
    Promise.all([
      waitForFile(join(gates, 'first.started')),
      waitForFile(join(gates, 'second.started')),
    ]),
    child.exited.then((earlyExitCode) => {
      throw new Error(
        `pickle run exited before both Scenarios started (${earlyExitCode}): ${output.join('')}`,
      )
    }),
  ])
  const activeOutput = await waitForOutput(output, 'features/progress.feature')
  expect(activeOutput).toContain('0/2 Test results')
  expect(activeOutput).toContain('First result appears last')
  expect(activeOutput).toContain('Second result appears first')
  expect(activeOutput).toContain('Then first')
  expect(activeOutput).toContain('Then second')
  expect(activeOutput).not.toContain('Second result appears first [')

  await Bun.write(join(gates, 'second.release'), '')
  const liveOutput = await waitForOutput(
    output,
    'Second result appears first [',
  )
  expect(liveOutput).not.toContain('First result appears last [')

  await Bun.write(join(gates, 'first.release'), '')
  const { exitCode, output: finalOutput } = await interactiveRun.finish()

  expect(exitCode).toBe(0)
  expect(finalOutput).toContain('First result appears last [')
  expect(finalOutput.split(' Specifications  1')).toHaveLength(2)
  expect(finalOutput.split(' Test results    2 passed (2)')).toHaveLength(2)
  expect(finalOutput).not.toContain('\u001b[32m')
}, 15_000)

test('finishes an interrupted interactive run with partial persisted and exported evidence', async () => {
  const project = join(workspace, 'interrupted-run')
  const gates = join(project, 'gates')
  const jsonPath = join(project, 'interrupted.json')
  const ndjsonPath = join(project, 'interrupted.ndjson')
  await mkdir(join(project, 'features'), { recursive: true })
  await mkdir(gates, { recursive: true })
  await Bun.write(
    join(project, 'pickle.config.jsonc'),
    JSON.stringify({
      schemaVersion: 1,
      specifications: 'features/**/*.feature',
      executionTargetProfile: { id: 'deterministic' },
      concurrency: 2,
    }),
  )
  await Bun.write(
    join(project, 'pickle.extensions.ts'),
    `
const gateDirectory = process.env.PICKLE_TEST_GATE_DIRECTORY

export default {
  adapter: {
    async openSession() {
      return {
        async executeStep(step, signal) {
          await Bun.write(\`\${gateDirectory}/\${step.text}.started\`, '')
          while (!(await Bun.file(\`\${gateDirectory}/\${step.text}.release\`).exists())) {
            if (signal?.aborted) throw new DOMException('Scenario cancelled', 'AbortError')
            await Bun.sleep(5)
          }
          return { state: 'passed', resolvedActions: [] }
        },
        async close() {},
      }
    },
  },
}
`,
  )
  await Bun.write(
    join(project, 'features', 'interrupt.feature'),
    `@pickle:id:specinterruptaaa @pickle:state:active
Feature: Interrupt safely
  @pickle:id:scncompletedaaaa
  Scenario: Completed before interruption
    Then completed

  @pickle:id:scncancelledaaaa
  Scenario: Cancelled by interruption
    Then cancelled`,
  )

  const interactiveRun = spawnInteractiveRun({
    cmd: [
      pickleCommand,
      'run',
      '--output',
      `json=${jsonPath}`,
      '--output',
      `ndjson=${ndjsonPath}`,
    ],
    cwd: project,
    env: {
      ...Bun.env,
      NO_COLOR: '1',
      PICKLE_TEST_GATE_DIRECTORY: gates,
      TERM: 'xterm-256color',
    },
  })
  const { child, output } = interactiveRun

  await Promise.all([
    waitForFile(join(gates, 'completed.started')),
    waitForFile(join(gates, 'cancelled.started')),
  ])
  await Bun.write(join(gates, 'completed.release'), '')
  await waitForOutput(output, 'Completed before interruption [')
  child.kill('SIGINT')

  const { exitCode, output: finalOutput } = await interactiveRun.finish()

  expect(exitCode).toBe(130)
  expect(finalOutput).toContain('Run interrupted')
  expect(finalOutput).toContain('Partial summary')
  expect(finalOutput).toContain('1 passed | 1 cancelled (2)')

  const manifestPaths = [
    ...new Bun.Glob('*/manifest.json').scanSync({
      cwd: resolveLocalProjectStorage(project).runsDirectory,
    }),
  ]
  expect(manifestPaths).toHaveLength(1)
  const persistedManifest = await Bun.file(
    join(
      resolveLocalProjectStorage(project).runsDirectory,
      requiredValue(manifestPaths[0]),
    ),
  ).json()
  const exportedManifest = await Bun.file(jsonPath).json()
  expect(exportedManifest).toEqual(persistedManifest)
  expect(
    persistedManifest.results.map((result: { state: string }) => result.state),
  ).toEqual(['passed', 'cancelled'])
  expect(typeof persistedManifest.finishedAt).toBe('string')

  const exportedEvents = (await Bun.file(ndjsonPath).text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(
    exportedEvents
      .filter((event) => event.type === 'scenario-finished')
      .map((event) => event.attempt.state),
  ).toEqual(['passed', 'cancelled'])
}, 15_000)

test('restores an interactive terminal before reporting a zero-selection command error', async () => {
  const project = join(workspace, 'zero-selection')
  await mkdir(join(project, 'features'), { recursive: true })
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
    `export default {
  adapter: {
    async openSession() { throw new Error('must not start') },
  },
}`,
  )
  await Bun.write(
    join(project, 'features', 'selection.feature'),
    `@pickle:id:specselectionaaa @pickle:state:active
Feature: Selection
  @pickle:id:scnselectionaaaa
  Scenario: Existing Scenario
    Then validation succeeds`,
  )

  const interactiveRun = spawnInteractiveRun({
    cmd: [pickleCommand, 'run', '--scenario', 'Missing Scenario'],
    cwd: project,
    env: { ...Bun.env, NO_COLOR: '1', TERM: 'xterm-256color' },
  })

  const { exitCode, output: finalOutput } = await interactiveRun.finish()
  const restoredTerminal = '\u001b[0m\u001b[?25h'

  expect(exitCode).toBe(2)
  expect(finalOutput).toContain(
    'ERROR No Scenarios match the current selection',
  )
  expect(finalOutput).not.toContain('Run failed')
  expect(finalOutput).not.toContain('Specifications  ')
  expect(finalOutput).not.toContain('Test results    ')
  expect(finalOutput.indexOf(restoredTerminal)).toBeLessThan(
    finalOutput.indexOf('ERROR '),
  )
  expect(finalOutput.split(restoredTerminal)).toHaveLength(2)
  expect(finalOutput.match(/ERROR /g)).toHaveLength(1)
}, 15_000)

test('preserves materialized evidence and restores the terminal when rendering throws', async () => {
  const project = join(workspace, 'reporter-failure')
  const jsonPath = join(project, 'reporter-failure.json')
  const ndjsonPath = join(project, 'reporter-failure.ndjson')
  await mkdir(join(project, 'features'), { recursive: true })
  await Bun.write(
    join(project, 'pickle.config.jsonc'),
    JSON.stringify({
      schemaVersion: 1,
      specifications: 'features/**/*.feature',
      executionTargetProfile: { id: 'deterministic' },
      concurrency: 2,
    }),
  )
  await Bun.write(
    join(project, 'pickle.extensions.ts'),
    `Bun.stringWidth = () => { throw new Error('Reporter rendering failed') }

export default {
  adapter: {
    async openSession() {
      return {
        async executeStep() {
          return { state: 'passed', resolvedActions: [] }
        },
        async close() {},
      }
    },
  },
}`,
  )
  await Bun.write(
    join(project, 'features', 'reporter.feature'),
    `@pickle:id:specreporteraaaaa @pickle:state:active
Feature: Reporter failure
  @pickle:id:scnreporteraaaaaa
  Scenario: Preserve completed evidence
    Then rendering fails after completion

  @pickle:id:scnreporterbbbbbb
  Scenario: Preserve concurrent evidence
    Then concurrent rendering also completes`,
  )

  const interactiveRun = spawnInteractiveRun({
    cmd: [
      pickleCommand,
      'run',
      '--output',
      `json=${jsonPath}`,
      '--output',
      `ndjson=${ndjsonPath}`,
    ],
    cwd: project,
    env: { ...Bun.env, NO_COLOR: '1', TERM: 'xterm-256color' },
  })

  const { exitCode, output: finalOutput } = await interactiveRun.finish()
  const restoredTerminal = '\u001b[0m\u001b[?25h'

  expect(exitCode).toBe(2)
  expect(finalOutput).toContain('ERROR Reporter rendering failed')
  expect(finalOutput.indexOf(restoredTerminal)).toBeLessThan(
    finalOutput.indexOf('ERROR '),
  )
  expect(finalOutput.split(restoredTerminal)).toHaveLength(2)
  expect(finalOutput.match(/ERROR /g)).toHaveLength(1)
  expect(finalOutput).not.toContain('Test results    ')

  const exportedManifest = await Bun.file(jsonPath).json()
  expect(
    exportedManifest.results.map((result: { state: string }) => result.state),
  ).toEqual(['passed', 'passed'])
  const exportedEvents = (await Bun.file(ndjsonPath).text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(
    exportedEvents
      .filter((event) => event.type === 'scenario-finished')
      .map((event) => event.attempt.state),
  ).toEqual(['passed', 'passed'])
}, 15_000)

test('interrupts application server startup and exits with the cancellation code', async () => {
  const project = join(workspace, 'interrupt-server-startup')
  const marker = join(project, 'server-started')
  const jsonPath = join(project, 'startup-interrupted.json')
  const junitPath = join(project, 'startup-interrupted.xml')
  const ndjsonPath = join(project, 'startup-interrupted.ndjson')
  await mkdir(join(project, 'features'), { recursive: true })
  await Bun.write(
    join(project, 'pickle.config.jsonc'),
    JSON.stringify({
      schemaVersion: 1,
      specifications: 'features/**/*.feature',
      executionTargetProfile: { id: 'deterministic' },
      server: {
        command: `bun -e "await Bun.write('${marker}', 'started'); setInterval(() => {}, 1000)" & wait`,
        url: 'http://127.0.0.1:1',
        startupTimeoutMs: 10_000,
        pollIntervalMs: 5_000,
      },
    }),
  )
  await Bun.write(
    join(project, 'pickle.extensions.ts'),
    `export default {
  adapter: {
    async openSession() { throw new Error('must not start') },
  },
}`,
  )
  await Bun.write(
    join(project, 'features', 'startup.feature'),
    `@pickle:id:specstartupaaaaa @pickle:state:active
Feature: Startup interruption
  @pickle:id:scnstartupaaaaaa
  Scenario: Stop before execution
    Then execution never starts`,
  )

  const interactiveRun = spawnInteractiveRun({
    cmd: [
      pickleCommand,
      'run',
      '--output',
      `json=${jsonPath}`,
      '--output',
      `junit=${junitPath}`,
      '--output',
      `ndjson=${ndjsonPath}`,
    ],
    cwd: project,
    env: { ...Bun.env, NO_COLOR: '1', TERM: 'xterm-256color' },
  })
  const { child } = interactiveRun

  await waitForFile(marker)
  const interruptedAt = Date.now()
  child.kill('SIGINT')
  const { exitCode, output: finalOutput } = await interactiveRun.finish()

  expect(exitCode).toBe(130)
  expect(Date.now() - interruptedAt).toBeLessThan(1_000)
  expect(finalOutput).toContain('Run interrupted')
  expect(finalOutput).toContain('Partial summary')
  expect(finalOutput).not.toContain('ERROR Server failed to start')
  expect(finalOutput.indexOf('\u001b[0m\u001b[?25h')).toBeGreaterThan(-1)

  const exportedManifest = await Bun.file(jsonPath).json()
  expect(exportedManifest.results).toEqual([])
  expect(typeof exportedManifest.finishedAt).toBe('string')
  expect(await Bun.file(junitPath).text()).toContain('tests="0"')
  const exportedEvents = (await Bun.file(ndjsonPath).text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line))
  expect(exportedEvents.map((event) => event.type)).toEqual(['run-started'])
}, 30_000)
