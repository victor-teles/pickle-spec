import { describe, expect, test } from 'bun:test'
import {
  evaluateWebPerformanceGates,
  type WebPerformanceBenchmarkResult,
} from '../index'
import { webPerformanceBenchmarkExitCode } from './web-benchmark-cli'

interface CliResult {
  exitCode: number
  output: WebPerformanceBenchmarkResult
}

async function runCli(...args: string[]): Promise<CliResult> {
  const child = Bun.spawn(
    [process.execPath, `${import.meta.dir}/web-benchmark-cli.ts`, ...args],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  if (!stdout.trim()) throw new Error(stderr || 'Benchmark produced no JSON')
  return {
    exitCode,
    output: JSON.parse(stdout) as WebPerformanceBenchmarkResult,
  }
}

describe('web Replay benchmark entrypoint', () => {
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
})
