import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { providerCredentialEnvironmentNames } from '@pickle-spec/runner/benchmarking'
import { describe, expect, test } from 'vitest'
import {
  evaluateWebPerformanceGates,
  type WebPerformanceBenchmarkResult,
} from '../../../src/benchmarking/web-benchmark'
import { webPerformanceBenchmarkExitCode } from '../../../src/benchmarking/web-benchmark-cli'

interface CliResult {
  exitCode: number
  output: WebPerformanceBenchmarkResult
}

interface CliExecution {
  exitCode: number
  stderr: string
  stdout: string
}

function providerFreeEnvironment(): Record<string, string | undefined> {
  const environment = { ...Bun.env }
  for (const name of providerCredentialEnvironmentNames) {
    delete environment[name]
  }
  return environment
}

async function runCli(
  environment?: Record<string, string | undefined>,
): Promise<CliResult> {
  const { exitCode, stdout, stderr } = await executeCli([], environment)
  if (!stdout.trim()) throw new Error(stderr || 'Benchmark produced no JSON')
  return {
    exitCode,
    output: JSON.parse(stdout) as WebPerformanceBenchmarkResult,
  }
}

async function executeCli(
  args: readonly string[],
  environment: Record<string, string | undefined> = providerFreeEnvironment(),
): Promise<CliExecution> {
  const child = Bun.spawn(
    [
      process.execPath,
      `${import.meta.dir}/../../../src/benchmarking/web-benchmark-cli.ts`,
      ...args,
    ],
    { env: environment, stdout: 'pipe', stderr: 'pipe' },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { exitCode, stdout, stderr }
}

describe('web Replay benchmark entrypoint', () => {
  test('rejects an unknown argument without printing JSON', async () => {
    const execution = await executeCli(['--unknown'])

    expect(execution.exitCode).toBe(2)
    expect(execution.stdout).toBe('')
  })

  test('rejects trailing, missing, fractional, and insufficient sample arguments', async () => {
    const invalidArguments = [
      ['--sample-pairs', '20', 'trailing'],
      ['--sample-pairs'],
      ['--sample-pairs', '20.5'],
      ['--sample-pairs', '19'],
    ]

    for (const args of invalidArguments) {
      const execution = await executeCli(args)
      expect(execution.exitCode).toBe(2)
      expect(execution.stdout).toBe('')
      expect(execution.stderr).not.toBe('')
    }
  })

  test('controlled fixture rejects inherited provider credentials', async () => {
    const controlledBenchmarkUrl = new URL(
      '../../../src/benchmarking/web-controlled-benchmark.ts',
      import.meta.url,
    ).href
    const child = Bun.spawn(
      [
        process.execPath,
        '-e',
        `import { runControlledWebPerformanceBenchmark } from ${JSON.stringify(controlledBenchmarkUrl)}; await runControlledWebPerformanceBenchmark()`,
      ],
      {
        env: {
          ...providerFreeEnvironment(),
          AWS_SECRET_ACCESS_KEY: 'must-not-reach-fixture',
        },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    const [exitCode, stderr] = await Promise.all([
      child.exited,
      new Response(child.stderr).text(),
    ])

    expect(exitCode).not.toBe(0)
    expect(stderr).toContain('provider credentials')
  })

  test('removes provider credentials before the controlled fixture starts', async () => {
    const result = await runCli({
      ...providerFreeEnvironment(),
      ANTHROPIC_API_KEY: 'must-not-reach-fixture',
      OPENAI_API_KEY: 'must-not-reach-fixture',
    })

    expect(result.exitCode).toBe(0)
    expect(result.output.passed).toBe(true)
  })

  test('prints passing controlled JSON without credentials or an external browser', async () => {
    const result = await runCli()

    expect(result.exitCode).toBe(0)
    expect(result.output).toMatchObject({
      warmupPairsDiscarded: 3,
      gates: {
        p50: { limitRatio: 0.5, passed: true },
        p95: { limitRatio: 0.65, passed: true },
      },
      passed: true,
    })
    expect(result.output.samples).toHaveLength(20)
  }, 30_000)

  test('returns a non-zero exit code when measured Replay breaks the budget', () => {
    const failed = evaluateWebPerformanceGates(
      Array.from({ length: 20 }, () => ({
        adaptiveMs: 100,
        replayMs: 101,
      })),
    )

    expect(webPerformanceBenchmarkExitCode(failed)).toBe(1)
  })

  test('returns two without JSON when the measured baseline is invalid', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pickle-web-benchmark-'))
    const preloadPath = join(directory, 'constant-clock.ts')
    await Bun.write(
      preloadPath,
      `Object.defineProperty(performance, 'now', { value: () => 1 })\n`,
    )
    try {
      const child = Bun.spawn(
        [
          process.execPath,
          '--preload',
          preloadPath,
          `${import.meta.dir}/../../../src/benchmarking/web-benchmark-cli.ts`,
        ],
        {
          env: providerFreeEnvironment(),
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const [exitCode, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])

      expect(exitCode).toBe(2)
      expect(stdout).toBe('')
      expect(stderr).toContain(
        'Adaptive benchmark percentiles must be greater than zero',
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
