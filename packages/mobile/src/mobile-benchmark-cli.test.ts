import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { providerCredentialEnvironmentNames } from '@pickle-spec/runner'

const temporaryDirectories: string[] = []
const cliPath = join(import.meta.dir, 'mobile-benchmark-cli.ts')

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function executeCli(
  args: readonly string[],
  environment: Record<string, string | undefined> = Bun.env,
) {
  const process = Bun.spawn([Bun.which('bun')!, cliPath, ...args], {
    env: environment,
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

function runCli(...args: string[]) {
  return executeCli(args)
}

describe('mobile benchmark executable', () => {
  test('controlled driver rejects every provider credential', async () => {
    const controlledBenchmarkUrl = new URL(
      './mobile-benchmark-controlled-driver.ts',
      import.meta.url,
    ).href
    for (const credentialName of providerCredentialEnvironmentNames) {
      const process = Bun.spawn(
        [
          Bun.which('bun')!,
          '-e',
          `import { createControlledMobileBenchmarkDriver } from ${JSON.stringify(controlledBenchmarkUrl)}; await createControlledMobileBenchmarkDriver()`,
        ],
        {
          env: { [credentialName]: 'must-not-reach-controlled-mobile' },
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const [exitCode, stderr] = await Promise.all([
        process.exited,
        new Response(process.stderr).text(),
      ])

      expect(exitCode).not.toBe(0)
      expect(stderr).toContain(credentialName)
    }
  })

  test('removes provider credentials before starting the controlled driver', async () => {
    const environment = Object.fromEntries(
      providerCredentialEnvironmentNames.map((name) => [
        name,
        'must-not-reach-controlled-mobile',
      ]),
    )
    const execution = await executeCli([], environment)

    expect(execution.exitCode).toBe(0)
    expect(execution.stderr).toBe('')
  })

  test('runs the controlled driver by default and prints passing JSON', async () => {
    const execution = await runCli()
    const report = JSON.parse(execution.stdout)

    expect(execution.exitCode).toBe(0)
    expect(execution.stderr).toBe('')
    expect(report).toMatchObject({
      schemaVersion: 1,
      driver: { kind: 'controlled' },
      warmupPairsDiscarded: 3,
      passed: true,
    })
    expect(report.samples).toHaveLength(20)
  })

  test('returns one when an optional module driver breaks a budget', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pickle-mobile-benchmark-'))
    temporaryDirectories.push(directory)
    const driverPath = join(directory, 'driver.ts')
    await Bun.write(
      driverPath,
      `export function measureMobileBenchmark(mode: 'adaptive' | 'replay') {
        return mode === 'adaptive' ? 100 : 111
      }
`,
    )

    const execution = await runCli('--driver', driverPath)
    const report = JSON.parse(execution.stdout)

    expect(execution.exitCode).toBe(1)
    expect(execution.stderr).toBe('')
    expect(report).toMatchObject({
      driver: { kind: 'module' },
      passed: false,
      gates: {
        p50: { passed: false },
        p95: { passed: false },
      },
    })
  })

  test('rejects unknown, trailing, missing, fractional, and insufficient arguments without printing JSON', async () => {
    const invalidArguments = [
      ['--unknown'],
      ['--samples', '20', 'trailing'],
      ['--samples'],
      ['--samples', '20.5'],
      ['--samples', '19'],
    ]

    for (const args of invalidArguments) {
      const execution = await runCli(...args)
      expect(execution.exitCode).toBe(2)
      expect(execution.stdout).toBe('')
      expect(execution.stderr).not.toBe('')
    }
  })

  test('returns two instead of serializing a non-finite ratio', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pickle-mobile-benchmark-'))
    temporaryDirectories.push(directory)
    const driverPath = join(directory, 'driver.ts')
    await Bun.write(
      driverPath,
      `export function measureMobileBenchmark(mode: 'adaptive' | 'replay') {
        return mode === 'adaptive' ? 0 : 1
      }
`,
    )

    const execution = await runCli('--driver', driverPath)

    expect(execution.exitCode).toBe(2)
    expect(execution.stdout).toBe('')
    expect(execution.stderr).toContain(
      'Adaptive benchmark percentiles must be greater than zero',
    )
    expect(execution.stderr).not.toContain('Infinity')
  })
})
