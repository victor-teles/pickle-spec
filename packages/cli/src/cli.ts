#!/usr/bin/env bun

import type { ExecutionTargetAdapter, ExecutionTargetProfile } from '@pickle-spec/runner'
import { resolveRunConfiguration, runScenarios } from '@pickle-spec/runner'
import { parseSpecificationFile, selectScenarios, type SelectionOptions } from '@pickle-spec/spec'
import {
  createWebAdapter,
  type WebAdapterOptions,
  type WebAutomationFactory,
} from '@pickle-spec/web'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { loadConfig, type PickleConfig } from './config'
import { checkProject, initializeProject } from './project'
import { startServer } from './server'

interface Extensions {
  adapter?: ExecutionTargetAdapter
  executionTargetProfile?: ExecutionTargetProfile
  webAutomationFactory?: WebAutomationFactory
}

interface RunArguments {
  pattern?: string
  configPath?: string
  extensionsPath?: string
  selection: SelectionOptions
  retries?: number
  concurrency?: number
  language?: string
  scenarioTimeoutMs?: number
  stepTimeoutMs?: number
  reuseServer?: boolean
  headed?: boolean
  screenshotMode?: NonNullable<WebAdapterOptions['screenshots']>['mode']
}

function integer(value: string, flag: string, minimum: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(`${flag} requires an integer greater than or equal to ${minimum}`)
  }
  return parsed
}

function valueAfter(argv: string[], index: number): string {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${argv[index]} requires a value`)
  return value
}

function parseShard(value: string): { index: number; total: number } {
  const match = value.match(/^(\d+)\/(\d+)$/)
  if (!match) throw new Error('--shard requires <index>/<total>')
  return { index: Number(match[1]), total: Number(match[2]) }
}

function parseRunArguments(argv: string[]): RunArguments {
  if (argv[0] !== 'run') throw new Error('Usage: pickle run [specifications] [options]')
  const args: RunArguments = { selection: {} }
  let index = 1
  if (argv[index] && !argv[index]!.startsWith('-')) args.pattern = argv[index++]

  while (index < argv.length) {
    const flag = argv[index]!
    switch (flag) {
      case '--config': args.configPath = valueAfter(argv, index++); break
      case '--extensions': args.extensionsPath = valueAfter(argv, index++); break
      case '--scenario': args.selection.scenarioName = valueAfter(argv, index++); break
      case '--tag':
      case '-t': args.selection.tagExpression = valueAfter(argv, index++); break
      case '--shard': args.selection.shard = parseShard(valueAfter(argv, index++)); break
      case '--retries': args.retries = integer(valueAfter(argv, index++), flag, 0); break
      case '--concurrency':
      case '-j': args.concurrency = integer(valueAfter(argv, index++), flag, 1); break
      case '--language':
      case '-l': args.language = valueAfter(argv, index++); break
      case '--scenario-timeout': {
        args.scenarioTimeoutMs = integer(valueAfter(argv, index++), flag, 1)
        break
      }
      case '--step-timeout': args.stepTimeoutMs = integer(valueAfter(argv, index++), flag, 1); break
      case '--reuse-server': args.reuseServer = true; break
      case '--headed': args.headed = true; break
      case '--screenshot': {
        const mode = valueAfter(argv, index++)
        if (!['off', 'on-failure', 'on-step'].includes(mode)) {
          throw new Error('--screenshot requires off, on-failure, or on-step')
        }
        args.screenshotMode = mode as RunArguments['screenshotMode']
        break
      }
      default: throw new Error(`Unknown option: ${flag}`)
    }
    index++
  }
  return args
}

async function loadExtensions(path?: string): Promise<Extensions> {
  const selectedPath = path ?? 'pickle.extensions.ts'
  const absolutePath = resolve(selectedPath)
  if (!(await Bun.file(absolutePath).exists())) {
    if (!path) return {}
    throw new Error(`Extensions file not found: ${selectedPath}`)
  }
  return ((await import(pathToFileURL(absolutePath).href)).default ?? {}) as Extensions
}

async function discoverSpecifications(patterns: string | string[], language?: string) {
  const paths = new Set<string>()
  for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
    const glob = new Bun.Glob(pattern)
    for await (const path of glob.scan({ cwd: process.cwd(), absolute: true })) paths.add(path)
  }
  if (paths.size === 0) {
    const description = Array.isArray(patterns) ? patterns.join(', ') : patterns
    throw new Error(`No specifications found matching: ${description}`)
  }
  return Promise.all([...paths].sort().map(path => parseSpecificationFile(path, language)))
}

function configuredWebOptions(config: PickleConfig, args: RunArguments): WebAdapterOptions | undefined {
  if (!config.web) return undefined
  return {
    ...config.web,
    browser: {
      ...config.web.browser,
      ...(args.headed ? { headless: false } : {}),
    },
    screenshots: {
      ...config.web.screenshots,
      ...(args.screenshotMode ? { mode: args.screenshotMode } : {}),
    },
  }
}

function configuredAdapter(
  extensions: Extensions,
  web: WebAdapterOptions | undefined,
): ExecutionTargetAdapter {
  if (extensions.adapter) return extensions.adapter
  if (!web) throw new Error('Configure web.baseUrl or export an adapter from pickle.extensions.ts')
  return createWebAdapter(web, extensions.webAutomationFactory)
}

async function run(argv: string[]): Promise<number> {
  const args = parseRunArguments(argv)
  const config = await loadConfig(args.configPath)
  const extensions = await loadExtensions(args.extensionsPath)
  const controller = new AbortController()
  const onSigint = () => controller.abort()
  process.on('SIGINT', onSigint)
  let server: Awaited<ReturnType<typeof startServer>>

  try {
    server = await startServer({
      ...config.server,
      ...(args.reuseServer ? { reuseExisting: true } : {}),
    })
    const specifications = await discoverSpecifications(
      args.pattern ?? config.specifications ?? 'features/**/*.feature',
      args.language ?? config.language,
    )
    const selections = selectScenarios(specifications, {
      ...config.selection,
      ...args.selection,
      shard: args.selection.shard ?? config.selection?.shard,
    })
    if (selections.length === 0) throw new Error('No Scenarios match the current selection')

    const web = configuredWebOptions(config, args)
    const resolvedConfiguration = resolveRunConfiguration({
      schemaVersion: config.schemaVersion,
      executionTargetProfile: config.executionTargetProfile ?? { id: web ? 'web' : 'custom' },
      concurrency: args.concurrency ?? config.concurrency,
      execution: {
        infrastructureRetries: args.retries ?? config.execution?.infrastructureRetries,
        stepTimeoutMs: args.stepTimeoutMs ?? config.execution?.stepTimeoutMs,
        scenarioTimeoutMs: args.scenarioTimeoutMs ?? config.execution?.scenarioTimeoutMs,
      },
    }, {
      adapter: configuredAdapter(extensions, web),
      executionTargetProfile: extensions.executionTargetProfile,
    })
    const runs = await runScenarios({
      selections,
      ...resolvedConfiguration,
      signal: controller.signal,
      onEvent(event) {
        console.log(JSON.stringify({ kind: 'run-event', event }))
      },
    })

    for (const scenarioRun of runs) {
      console.log(JSON.stringify({ kind: 'test-result', result: scenarioRun.result }))
    }
    if (runs.some(({ result }) => result.state === 'cancelled')) return 130
    if (runs.some(({ result }) => result.state === 'failed' || result.state === 'infrastructure-error')) {
      return 1
    }
    return 0
  } finally {
    process.off('SIGINT', onSigint)
    server?.stop()
  }
}

function projectOptions(argv: string[]): { configPath?: string; extensionsPath?: string } {
  const options: { configPath?: string; extensionsPath?: string } = {}
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index]!
    if (flag === '--config') options.configPath = valueAfter(argv, index++)
    else if (flag === '--extensions') options.extensionsPath = valueAfter(argv, index++)
    else throw new Error(`Unknown option: ${flag}`)
  }
  return options
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] === 'init') {
    if (argv.length > 1) throw new Error('Usage: pickle init')
    await initializeProject()
    return 0
  }
  if (argv[0] === 'check') {
    await checkProject({ ...projectOptions(argv), report: console.log })
    return 0
  }
  return run(argv)
}

try {
  process.exitCode = await main(Bun.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 2
}
