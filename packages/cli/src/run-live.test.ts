import { afterAll, beforeAll, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

let workspace: string
let pickleCommand: string

type PackageManifest = {
  bin: { pickle: string }
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
  const packageDirectory = resolve(import.meta.dir, '..')
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

  const output: string[] = []
  const decoder = new TextDecoder()
  const child = Bun.spawn({
    cmd: [pickleCommand, 'run'],
    cwd: project,
    env: {
      ...Bun.env,
      NO_COLOR: '1',
      PICKLE_TEST_GATE_DIRECTORY: gates,
      TERM: 'xterm-256color',
    },
    terminal: {
      cols: 80,
      rows: 24,
      data(_terminal, data) {
        output.push(decoder.decode(data, { stream: true }))
      },
    },
  })

  await Promise.race([
    Promise.all([
      waitForFile(join(gates, 'first.started')),
      waitForFile(join(gates, 'second.started')),
    ]),
    child.exited.then((exitCode) => {
      throw new Error(
        `pickle run exited before both Scenarios started (${exitCode}): ${output.join('')}`,
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
  const exitCode = await child.exited
  output.push(decoder.decode())
  child.terminal?.close()
  const finalOutput = output.join('')

  expect(exitCode).toBe(0)
  expect(finalOutput).toContain('First result appears last [')
  expect(finalOutput.split(' Specifications  1')).toHaveLength(2)
  expect(finalOutput.split(' Test results    2 passed (2)')).toHaveLength(2)
  expect(finalOutput).not.toContain('\u001b[32m')
}, 15_000)
