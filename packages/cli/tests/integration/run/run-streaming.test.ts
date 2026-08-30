import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterAll, beforeAll, expect, test } from 'vitest'

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
  workspace = await mkdtemp(join(tmpdir(), 'pickle-run-streaming-'))
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

test('streams Test results in completion order through public CLI output', async () => {
  const project = join(workspace, 'ordered-blocks')
  const gates = join(project, 'gates')
  await mkdir(join(project, 'features'), { recursive: true })
  await mkdir(gates, { recursive: true })
  await Bun.write(
    join(project, 'pickle.config.jsonc'),
    JSON.stringify({
      schemaVersion: 1,
      specifications: 'features/**/*.feature',
      executionTargetProfile: { id: 'deterministic' },
      concurrency: 4,
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
          const gateName = step.text
          await Bun.write(\`\${gateDirectory}/\${gateName}.started\`, '')
          while (!(await Bun.file(\`\${gateDirectory}/\${gateName}.release\`).exists())) {
            if (signal?.aborted) {
              throw new DOMException('Scenario cancelled', 'AbortError')
            }
            await Bun.sleep(5)
          }
          await Bun.write(\`\${gateDirectory}/\${gateName}.finished\`, '')
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
    join(project, 'features', 'a.feature'),
    `@pickle:id:specaaaaaaaaaaaa @pickle:state:active
Feature: First Specification
  @pickle:id:scnaaaaaaaaaaaa
  Scenario: First declared Scenario
    Then a-first

  @pickle:id:scnbbbbbbbbbbbb
  Scenario: Second declared Scenario
    Then a-second`,
  )
  await Bun.write(
    join(project, 'features', 'b.feature'),
    `@pickle:id:speccccccccccccc @pickle:state:active
Feature: Second Specification
  @pickle:id:scncccccccccccc
  Scenario: Ready early
    Then b-only`,
  )
  await Bun.write(
    join(project, 'features', 'c.feature'),
    `@pickle:id:specdddddddddddd @pickle:state:active
Feature: Third Specification
  @pickle:id:scndddddddddddd
  Scenario: Keeps the run open
    Then c-only`,
  )

  const child = Bun.spawn({
    cmd: [pickleCommand, 'run'],
    cwd: project,
    env: {
      ...Bun.env,
      CI: 'true',
      PICKLE_TEST_GATE_DIRECTORY: gates,
    },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const output: string[] = []
  const decoder = new TextDecoder()
  const stderrOutput = new Response(child.stderr).text()
  const consumeStdout = (async () => {
    const reader = child.stdout.getReader()
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      output.push(decoder.decode(value, { stream: true }))
    }
    output.push(decoder.decode())
  })()

  await Promise.race([
    Promise.all(
      ['a-first', 'a-second', 'b-only', 'c-only'].map((name) =>
        waitForFile(join(gates, `${name}.started`)),
      ),
    ),
    child.exited.then(async (earlyExitCode) => {
      throw new Error(
        `pickle run exited before all Scenarios started (${earlyExitCode}): ${await stderrOutput}`,
      )
    }),
  ])

  const safetyRelease = setTimeout(() => {
    void Bun.write(join(gates, 'a-first.release'), '')
    void Bun.write(join(gates, 'a-second.release'), '')
    void Bun.write(join(gates, 'b-only.release'), '')
    void Bun.write(join(gates, 'c-only.release'), '')
  }, 2_000)

  await Bun.write(join(gates, 'b-only.release'), '')
  const firstOutput = await waitForOutput(
    output,
    'features/b.feature > Ready early',
  )
  expect(firstOutput).not.toContain('features/a.feature')
  expect(firstOutput).not.toContain('features/c.feature')

  await Bun.write(join(gates, 'a-first.release'), '')
  const secondOutput = await waitForOutput(
    output,
    'features/a.feature > First declared Scenario',
  )
  expect(secondOutput).not.toContain('Second declared Scenario [')
  expect(secondOutput).not.toContain('features/c.feature')

  await Bun.write(join(gates, 'a-second.release'), '')
  const progressiveOutput = await waitForOutput(
    output,
    'features/a.feature > Second declared Scenario',
  )
  expect(progressiveOutput.indexOf('features/b.feature')).toBeLessThan(
    progressiveOutput.indexOf('features/a.feature > First declared Scenario'),
  )
  expect(
    progressiveOutput.indexOf('features/a.feature > First declared Scenario'),
  ).toBeLessThan(
    progressiveOutput.indexOf('features/a.feature > Second declared Scenario'),
  )
  expect(progressiveOutput).not.toContain('features/c.feature')

  await Bun.write(join(gates, 'c-only.release'), '')
  const [exitCode, stderr] = await Promise.all([
    child.exited,
    stderrOutput,
    consumeStdout,
  ])
  const finalOutput = output.join('')

  expect(exitCode).toBe(0)
  clearTimeout(safetyRelease)
  expect(stderr).toBe('')
  expect(finalOutput.indexOf('features/c.feature')).toBeGreaterThan(
    progressiveOutput.indexOf('features/a.feature > Second declared Scenario'),
  )
  expect(finalOutput.match(/features\/a\.feature/g)).toHaveLength(2)
  expect(finalOutput.match(/features\/b\.feature/g)).toHaveLength(1)
  expect(finalOutput.match(/features\/c\.feature/g)).toHaveLength(1)
  expect(finalOutput).toContain('Specifications  3')
  expect(finalOutput).toContain('Scenarios       4')
  expect(finalOutput).toContain('Test results    4 passed (4)')
  expect(finalOutput).not.toContain('\u001b')
}, 15_000)
