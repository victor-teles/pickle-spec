import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  minimumReplayBenchmarkSamplePairs,
  removeProviderCredentials,
} from '@pickle-spec/runner/benchmarking'
import { z } from 'zod'
import {
  type MobileBenchmarkMode,
  runMobilePerformanceBenchmark,
} from './mobile-benchmark'
import { createControlledMobileBenchmarkDriver } from './mobile-benchmark-controlled-driver'

interface MobileBenchmarkDriverModule {
  measureMobileBenchmark?: (
    mode: MobileBenchmarkMode,
  ) => number | Promise<number>
}

const samplePairsSchema = z.coerce
  .number()
  .int()
  .min(minimumReplayBenchmarkSamplePairs)
const driverPathSchema = z.string().min(1)
const benchmarkArgumentsSchema = z.union([
  z
    .tuple([])
    .transform(() => ({ samplePairs: undefined, driverPath: undefined })),
  z
    .tuple([z.literal('--samples'), samplePairsSchema])
    .transform(([, samplePairs]) => ({
      samplePairs,
      driverPath: undefined,
    })),
  z
    .tuple([z.literal('--driver'), driverPathSchema])
    .transform(([, driverPath]) => ({
      samplePairs: undefined,
      driverPath,
    })),
  z
    .tuple([
      z.literal('--samples'),
      samplePairsSchema,
      z.literal('--driver'),
      driverPathSchema,
    ])
    .transform(([, samplePairs, , driverPath]) => ({
      samplePairs,
      driverPath,
    })),
  z
    .tuple([
      z.literal('--driver'),
      driverPathSchema,
      z.literal('--samples'),
      samplePairsSchema,
    ])
    .transform(([, driverPath, , samplePairs]) => ({
      samplePairs,
      driverPath,
    })),
])
type MobileBenchmarkCliOptions = z.infer<typeof benchmarkArgumentsSchema>

function parseArguments(args: readonly string[]): MobileBenchmarkCliOptions {
  return benchmarkArgumentsSchema.parse(args)
}

async function loadModuleDriver(
  driverPath: string,
): Promise<NonNullable<MobileBenchmarkDriverModule['measureMobileBenchmark']>> {
  const result = z
    .object({
      measureMobileBenchmark: z.function({
        input: [z.enum(['adaptive', 'replay'])],
        output: z.union([z.number(), z.promise(z.number())]),
      }),
    })
    .safeParse(await import(pathToFileURL(resolve(driverPath)).href))
  if (!result.success) {
    throw new Error(
      'Mobile benchmark driver must export measureMobileBenchmark(mode)',
    )
  }
  return result.data.measureMobileBenchmark
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

export async function runMobileBenchmarkCli(
  args: readonly string[] = process.argv.slice(2),
): Promise<number> {
  let dispose: (() => Promise<void>) | undefined
  try {
    removeProviderCredentials(process.env)
    const options = parseArguments(args)
    let measure: NonNullable<
      MobileBenchmarkDriverModule['measureMobileBenchmark']
    >
    if (options.driverPath) {
      measure = await loadModuleDriver(options.driverPath)
    } else {
      const controlled = await createControlledMobileBenchmarkDriver()
      measure = (mode) => controlled.measure(mode)
      dispose = () => controlled.dispose()
    }
    const result = await runMobilePerformanceBenchmark({
      samplePairs: options.samplePairs,
      measure,
    })
    process.stdout.write(
      `${JSON.stringify({
        schemaVersion: 1,
        driver: { kind: options.driverPath ? 'module' : 'controlled' },
        ...result,
      })}\n`,
    )
    return result.passed ? 0 : 1
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`)
    return 2
  } finally {
    await dispose?.()
  }
}

if (import.meta.main) process.exitCode = await runMobileBenchmarkCli()
