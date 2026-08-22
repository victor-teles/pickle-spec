import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
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

interface MobileBenchmarkCliOptions {
  samplePairs?: number
  driverPath?: string
}

function parseArguments(args: readonly string[]): MobileBenchmarkCliOptions {
  const options: MobileBenchmarkCliOptions = {}
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]
    const value = args[index + 1]
    if (argument === '--samples' && value) {
      options.samplePairs = Number(value)
      index++
      continue
    }
    if (argument === '--driver' && value) {
      options.driverPath = value
      index++
      continue
    }
    throw new Error(
      `Unknown or incomplete mobile benchmark argument: ${argument}`,
    )
  }
  return options
}

async function loadModuleDriver(
  driverPath: string,
): Promise<NonNullable<MobileBenchmarkDriverModule['measureMobileBenchmark']>> {
  const driver = (await import(
    pathToFileURL(resolve(driverPath)).href
  )) as MobileBenchmarkDriverModule
  if (typeof driver.measureMobileBenchmark !== 'function') {
    throw new Error(
      'Mobile benchmark driver must export measureMobileBenchmark(mode)',
    )
  }
  return driver.measureMobileBenchmark
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function runMobileBenchmarkCli(
  args: readonly string[] = process.argv.slice(2),
): Promise<number> {
  let dispose: (() => Promise<void>) | undefined
  try {
    const options = parseArguments(args)
    let measure: NonNullable<
      MobileBenchmarkDriverModule['measureMobileBenchmark']
    >
    if (options.driverPath) {
      measure = await loadModuleDriver(options.driverPath)
    } else {
      const controlled = await createControlledMobileBenchmarkDriver()
      measure = controlled.measure
      dispose = controlled.dispose
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
