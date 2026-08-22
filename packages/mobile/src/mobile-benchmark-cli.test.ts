import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const temporaryDirectories: string[] = []
const cliPath = join(import.meta.dir, 'mobile-benchmark-cli.ts')

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function runCli(...args: string[]) {
  const process = Bun.spawn([Bun.which('bun')!, cliPath, ...args], {
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

describe('mobile benchmark executable', () => {
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

  test('returns two for an invalid sample count without printing a report', async () => {
    const execution = await runCli('--samples', '19')

    expect(execution.exitCode).toBe(2)
    expect(execution.stdout).toBe('')
    expect(execution.stderr).toContain('at least 20 paired samples')
  })
})
