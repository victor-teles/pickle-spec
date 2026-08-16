#!/usr/bin/env bun

import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  ExecutionTargetAdapter,
  ExecutionTargetProfile,
  RunExtensions,
} from '@pickle-spec/runner'
import {
  createFilePlanStore,
  formatJson,
  formatJunit,
  formatNdjson,
  openTestRunStore,
  resolveRunConfiguration,
  runScenarios,
  validateTargetSelection,
} from '@pickle-spec/runner'
import {
  parseSpecification,
  type SelectionOptions,
  type SpecificationState,
  selectScenarios,
  validateSpecificationMetadata,
} from '@pickle-spec/spec'
import { createWebAdapter, type WebAdapterOptions } from '@pickle-spec/web'
import { loadConfig, type PickleConfig, runConfigurationFrom } from './config'
import type { Extensions } from './extensions'
import { checkProject, initializeProject, migrateProject } from './project'
import { startServer } from './server'

interface RunArguments {
  pattern?: string
  configPath?: string
  extensionsPath?: string
  suite?: string
  profiles?: string[]
  selection: SelectionOptions
  retries?: number
  concurrency?: number
  language?: string
  scenarioTimeoutMs?: number
  stepTimeoutMs?: number
  reuseServer?: boolean
  headed?: boolean
  screenshotMode?: NonNullable<WebAdapterOptions['screenshots']>['mode']
  applicationRevision?: string
  junitPath?: string
  jsonPath?: string
  ndjsonPath?: string
}

function integer(value: string, flag: string, minimum: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(
      `${flag} requires an integer greater than or equal to ${minimum}`,
    )
  }
  return parsed
}

function valueAfter(argv: string[], index: number): string {
  const value = argv[index + 1]
  if (!value || value.startsWith('--'))
    throw new Error(`${argv[index]} requires a value`)
  return value
}

function parseShard(value: string): { index: number; total: number } {
  const match = value.match(/^(\d+)\/(\d+)$/)
  if (!match) throw new Error('--shard requires <index>/<total>')
  return { index: Number(match[1]), total: Number(match[2]) }
}

function parseRunArguments(argv: string[]): RunArguments {
  if (argv[0] !== 'run')
    throw new Error('Usage: pickle run [specifications] [options]')
  const args: RunArguments = { selection: {} }
  let index = 1
  if (argv[index] && !argv[index]!.startsWith('-')) args.pattern = argv[index++]

  while (index < argv.length) {
    const flag = argv[index]!
    switch (flag) {
      case '--config':
        args.configPath = valueAfter(argv, index++)
        break
      case '--extensions':
        args.extensionsPath = valueAfter(argv, index++)
        break
      case '--suite':
        args.suite = valueAfter(argv, index++)
        break
      case '--profile':
        args.profiles = [...(args.profiles ?? []), valueAfter(argv, index++)]
        break
      case '--scenario':
        args.selection.scenarioName = valueAfter(argv, index++)
        break
      case '--tag':
      case '-t':
        args.selection.tagExpression = valueAfter(argv, index++)
        break
      case '--state': {
        const state = valueAfter(argv, index++)
        args.selection.states = [
          ...(args.selection.states ?? []),
          state as SpecificationState,
        ]
        break
      }
      case '--shard':
        args.selection.shard = parseShard(valueAfter(argv, index++))
        break
      case '--retries':
        args.retries = integer(valueAfter(argv, index++), flag, 0)
        break
      case '--concurrency':
      case '-j':
        args.concurrency = integer(valueAfter(argv, index++), flag, 1)
        break
      case '--language':
      case '-l':
        args.language = valueAfter(argv, index++)
        break
      case '--scenario-timeout': {
        args.scenarioTimeoutMs = integer(valueAfter(argv, index++), flag, 1)
        break
      }
      case '--step-timeout':
        args.stepTimeoutMs = integer(valueAfter(argv, index++), flag, 1)
        break
      case '--reuse-server':
        args.reuseServer = true
        break
      case '--headed':
        args.headed = true
        break
      case '--screenshot': {
        const mode = valueAfter(argv, index++)
        if (!['off', 'on-failure', 'on-step'].includes(mode)) {
          throw new Error('--screenshot requires off, on-failure, or on-step')
        }
        args.screenshotMode = mode as RunArguments['screenshotMode']
        break
      }
      case '--application-revision':
        args.applicationRevision = valueAfter(argv, index++)
        break
      case '--junit':
        args.junitPath = valueAfter(argv, index++)
        break
      case '--json':
        args.jsonPath = valueAfter(argv, index++)
        break
      case '--ndjson':
        args.ndjsonPath = valueAfter(argv, index++)
        break
      default:
        throw new Error(`Unknown option: ${flag}`)
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
  return ((await import(pathToFileURL(absolutePath).href)).default ??
    {}) as Extensions
}

async function discoverSpecifications(
  patterns: string | string[],
  language?: string,
) {
  const paths = new Set<string>()
  for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
    const glob = new Bun.Glob(pattern)
    for await (const path of glob.scan({ cwd: process.cwd(), absolute: true }))
      paths.add(path)
  }
  if (paths.size === 0) {
    const description = Array.isArray(patterns) ? patterns.join(', ') : patterns
    throw new Error(`No specifications found matching: ${description}`)
  }
  const files = await Promise.all(
    [...paths].sort().map(async (path) => ({
      uri: relative(process.cwd(), path),
      source: await Bun.file(path).text(),
    })),
  )
  try {
    validateSpecificationMetadata(files, language)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
  }
  return files.map((file) =>
    parseSpecification({
      source: file.source,
      uri: file.uri,
      language,
    }),
  )
}

function configuredWebOptions(
  config: PickleConfig,
  args: RunArguments,
  profileId?: string,
): WebAdapterOptions | undefined {
  const web =
    (profileId
      ? config.executionTargetProfiles?.[profileId]?.web
      : undefined) ?? config.web
  if (!web) return undefined
  return {
    ...web,
    browser: {
      ...web.browser,
      ...(args.headed ? { headless: false } : {}),
    },
    screenshots: {
      ...web.screenshots,
      ...(args.screenshotMode ? { mode: args.screenshotMode } : {}),
    },
  }
}

function configuredAdapter(
  extensions: Extensions,
  web: WebAdapterOptions | undefined,
): ExecutionTargetAdapter {
  if (extensions.adapter) return extensions.adapter
  if (!web)
    throw new Error(
      'Configure web.baseUrl or export an adapter from pickle.extensions.ts',
    )
  return createWebAdapter(web, extensions.webAutomationFactory)
}

function configuredRunExtensions(
  extensions: Extensions,
  config: PickleConfig,
  args: RunArguments,
  profiles: readonly ExecutionTargetProfile[],
): RunExtensions {
  const adapters: Record<string, ExecutionTargetAdapter> = {
    ...extensions.adapters,
  }
  if (extensions.adapter) adapters.custom ??= extensions.adapter

  for (const profile of profiles) {
    if (profile.adapter !== 'web' || adapters[profile.id]) continue
    const web = configuredWebOptions(config, args, profile.id)
    if (adapters.web) {
      adapters[profile.id] = adapters.web
      continue
    }
    if (!web) {
      throw new Error(
        'Configure web.baseUrl or export an adapter from pickle.extensions.ts',
      )
    }
    adapters[profile.id] = createWebAdapter(
      web,
      extensions.webAutomationFactory,
    )
  }

  return {
    adapter: profiles.some((profile) => profile.adapter)
      ? extensions.adapter
      : configuredAdapter(extensions, configuredWebOptions(config, args)),
    adapters,
  }
}

async function run(argv: string[]): Promise<number> {
  const args = parseRunArguments(argv)
  const config = await loadConfig(args.configPath)
  const controller = new AbortController()
  const onSigint = () => controller.abort()
  process.on('SIGINT', onSigint)
  let server: Awaited<ReturnType<typeof startServer>>

  try {
    const specifications = await discoverSpecifications(
      args.pattern ?? config.specifications ?? 'features/**/*.feature',
      args.language ?? config.language,
    )
    const suiteSelection = args.suite ? config.suites?.[args.suite] : undefined
    if (args.suite && !suiteSelection) {
      throw new Error(`Unknown test suite "${args.suite}"`)
    }
    const baseSelection = suiteSelection ?? config.selection
    const selections = selectScenarios(specifications, {
      ...baseSelection,
      ...args.selection,
      shard: args.selection.shard ?? baseSelection?.shard,
    })
    if (selections.length === 0)
      throw new Error('No Scenarios match the current selection')

    const extensions = await loadExtensions(args.extensionsPath)
    const runConfiguration = {
      ...runConfigurationFrom(config, args.profiles),
      concurrency: args.concurrency ?? config.concurrency,
      applicationRevision:
        args.applicationRevision ?? config.applicationRevision,
      execution: {
        infrastructureRetries:
          args.retries ?? config.execution?.infrastructureRetries,
        stepTimeoutMs: args.stepTimeoutMs ?? config.execution?.stepTimeoutMs,
        scenarioTimeoutMs:
          args.scenarioTimeoutMs ?? config.execution?.scenarioTimeoutMs,
      },
    }
    const resolvedConfiguration = resolveRunConfiguration(
      runConfiguration,
      configuredRunExtensions(
        extensions,
        config,
        args,
        runConfiguration.executionTargetProfiles ?? [],
      ),
    )
    validateTargetSelection(selections, resolvedConfiguration.targets)
    server = await startServer({
      ...config.server,
      ...(args.reuseServer ? { reuseExisting: true } : {}),
    })
    const store = openTestRunStore({
      root: process.cwd(),
      artifactCapture: config.artifacts?.capture,
    })
    const testRun = await store.create()
    const runs = await runScenarios({
      selections,
      ...resolvedConfiguration,
      plans: createFilePlanStore(process.cwd()),
      ci: Boolean(process.env.CI),
      signal: controller.signal,
      async onEvent(event) {
        const persisted = await testRun.append(event)
        if (event.type === 'scenario-finished') {
          await testRun.materialize({ finished: false })
        }
        console.log(JSON.stringify({ kind: 'run-event', event: persisted }))
      },
    })
    const manifest = await testRun.materialize()
    if (args.junitPath) await Bun.write(args.junitPath, formatJunit(manifest))
    if (args.jsonPath) await Bun.write(args.jsonPath, formatJson(manifest))
    if (args.ndjsonPath) {
      await Bun.write(args.ndjsonPath, formatNdjson(await testRun.events()))
    }
    await store.applyRetention({
      maxAgeMs: config.retention?.days
        ? config.retention.days * 24 * 60 * 60 * 1000
        : undefined,
      maxBytes: config.retention?.maxBytes,
    })

    for (const scenarioRun of runs) {
      console.log(
        JSON.stringify({ kind: 'test-result', result: scenarioRun.result }),
      )
    }
    const states = runs.map(({ result }) => result.state)
    if (states.includes('cancelled')) return 130
    if (
      states.includes('failed') ||
      states.includes('infrastructure-error') ||
      (config.policy?.adaptedResults === 'reject' &&
        states.includes('passed-with-adaptation'))
    ) {
      return 1
    }
    return 0
  } finally {
    process.off('SIGINT', onSigint)
    server?.stop()
  }
}

function projectOptions(argv: string[]): {
  configPath?: string
  extensionsPath?: string
} {
  const options: { configPath?: string; extensionsPath?: string } = {}
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index]!
    if (flag === '--config') options.configPath = valueAfter(argv, index++)
    else if (flag === '--extensions')
      options.extensionsPath = valueAfter(argv, index++)
    else throw new Error(`Unknown option: ${flag}`)
  }
  return options
}

function migrateOptions(argv: string[]): {
  configPath?: string
  yes?: boolean
} {
  const options: { configPath?: string; yes?: boolean } = {}
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index]!
    if (flag === '--config') options.configPath = valueAfter(argv, index++)
    else if (flag === '--yes' || flag === '-y') options.yes = true
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
  if (argv[0] === 'migrate') {
    await migrateProject({ ...migrateOptions(argv), report: console.log })
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
