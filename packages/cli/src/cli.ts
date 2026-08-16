#!/usr/bin/env bun

import { join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  ExecutionTargetAdapter,
  ExecutionTargetProfile,
  RunExtensions,
  TestResult,
} from '@pickle-spec/runner'
import {
  compareTestRuns,
  createFilePlanStore,
  formatHtml,
  formatJson,
  formatJunit,
  formatNdjson,
  importRunArchive,
  latestHistoricalDurations,
  openTestRunStore,
  resolveRunConfiguration,
  runScenarios,
  selectRerunResults,
  validateTargetSelection,
  writeRunArchive,
} from '@pickle-spec/runner'
import {
  parseSpecification,
  resolveScenarioId,
  type SelectionOptions,
  type SpecificationState,
  selectScenarios,
  validateSpecificationMetadata,
} from '@pickle-spec/spec'
import {
  createWebAdapter,
  screenshotModes,
  type WebAdapterOptions,
} from '@pickle-spec/web'
import {
  defaultExtensionsFile,
  defaultSpecificationGlob,
  loadConfig,
  type PickleConfig,
  runConfigurationFrom,
} from './config'
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
  rerunId?: string
  failures?: boolean
  adaptations?: boolean
  fast?: boolean
}

const dayMs = 24 * 60 * 60 * 1000

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
        if (
          !screenshotModes.includes(mode as (typeof screenshotModes)[number])
        ) {
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
      case '--rerun':
        args.rerunId = valueAfter(argv, index++)
        break
      case '--failures':
        args.failures = true
        break
      case '--adaptations':
        args.adaptations = true
        break
      case '--fast':
        args.fast = true
        break
      default:
        throw new Error(`Unknown option: ${flag}`)
    }
    index++
  }
  return args
}

async function loadExtensions(path?: string): Promise<Extensions> {
  const selectedPath = path ?? defaultExtensionsFile
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
  validateSpecificationMetadata(files, language)
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
    ...(args.fast ? { profile: 'fast' as const } : {}),
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

async function disposeAdapters(
  targets: ReturnType<typeof resolveRunConfiguration>['targets'],
): Promise<void> {
  const seen = new Set<ExecutionTargetAdapter>()
  for (const target of targets) {
    if (seen.has(target.adapter)) continue
    seen.add(target.adapter)
    await target.adapter.dispose?.()
  }
}

function scenarioSelectionId(selection: {
  specification: { source: { uri: string }; name: string }
  scenario: { name: string; id?: string; tags: string[] }
}): string {
  return (
    selection.scenario.id ??
    resolveScenarioId(
      selection.specification.source.uri,
      selection.specification.name,
      selection.scenario.name,
      selection.scenario.tags,
    )
  )
}

function selectionMatchesResult(
  selection: {
    specification: { source: { uri: string }; name: string }
    scenario: { name: string; id?: string; tags: string[] }
  },
  result: TestResult,
): boolean {
  return (
    scenarioSelectionId(selection) ===
      (result.scenario.id ?? result.scenario.name) ||
    selection.scenario.name === result.scenario.name
  )
}

async function run(argv: string[]): Promise<number> {
  const args = parseRunArguments(argv)
  const config = await loadConfig(args.configPath)
  const controller = new AbortController()
  const onSigint = () => controller.abort()
  process.on('SIGINT', onSigint)
  let server: Awaited<ReturnType<typeof startServer>>
  let resolvedConfiguration:
    | ReturnType<typeof resolveRunConfiguration>
    | undefined

  try {
    const specifications = await discoverSpecifications(
      args.pattern ?? config.specifications ?? defaultSpecificationGlob,
      args.language ?? config.language,
    )
    const suiteSelection = args.suite ? config.suites?.[args.suite] : undefined
    if (args.suite && !suiteSelection) {
      throw new Error(`Unknown test suite "${args.suite}"`)
    }
    const baseSelection = suiteSelection ?? config.selection
    const store = openTestRunStore({
      root: process.cwd(),
      artifactCapture: config.artifacts?.capture,
    })
    const shardSelection = args.selection.shard ?? baseSelection?.shard
    const historicalDurations = shardSelection
      ? await latestHistoricalDurations(store)
      : undefined

    let selections = selectScenarios(
      specifications,
      {
        ...baseSelection,
        ...args.selection,
        shard: shardSelection,
      },
      historicalDurations ? { historicalDurations } : {},
    )
    let profileIds = args.profiles
    let sourceRunId: string | undefined
    let selectedResults: TestResult[] | undefined

    if (args.rerunId) {
      const { manifest: sourceManifest } = await loadPersistedRun(args.rerunId)
      selectedResults = selectRerunResults(sourceManifest, {
        failures: args.failures,
        adaptations: args.adaptations,
        ...(args.selection.scenarioName
          ? { scenarioNames: [args.selection.scenarioName] }
          : {}),
        ...(args.profiles?.length ? { profileIds: args.profiles } : {}),
      })
      if (selectedResults.length === 0) {
        throw new Error('No results match the current rerun selection')
      }
      selections = selectScenarios(
        specifications,
        {
          ...baseSelection,
          ...args.selection,
          scenarioName: undefined,
          shard: shardSelection,
        },
        historicalDurations ? { historicalDurations } : {},
      ).filter((selection) =>
        selectedResults!.some((result) =>
          selectionMatchesResult(selection, result),
        ),
      )
      if (selections.length === 0) {
        throw new Error('No Scenarios match the current rerun selection')
      }
      profileIds = args.profiles?.length
        ? args.profiles
        : config.executionTargetProfiles
          ? [
              ...new Set(
                selectedResults.map(
                  (result) => result.executionTargetProfile.id,
                ),
              ),
            ]
          : undefined
      sourceRunId = args.rerunId
    }

    if (selections.length === 0)
      throw new Error('No Scenarios match the current selection')

    const extensions = await loadExtensions(args.extensionsPath)
    const runConfiguration = {
      ...runConfigurationFrom(config, profileIds),
      concurrency: args.concurrency ?? config.concurrency,
      applicationRevision:
        args.applicationRevision ?? config.applicationRevision,
      execution: {
        infrastructureRetries:
          args.retries ?? config.execution?.infrastructureRetries,
        functionalRetries: config.execution?.functionalRetries,
        stepTimeoutMs: args.stepTimeoutMs ?? config.execution?.stepTimeoutMs,
        scenarioTimeoutMs:
          args.scenarioTimeoutMs ?? config.execution?.scenarioTimeoutMs,
      },
    }
    resolvedConfiguration = resolveRunConfiguration(
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
    const testRun = await store.create(
      sourceRunId ? { sourceRunId } : undefined,
    )
    const onEvent = async (
      event: Parameters<
        NonNullable<Parameters<typeof runScenarios>[0]['onEvent']>
      >[0],
    ) => {
      const persisted = await testRun.append(event)
      if (event.type === 'scenario-finished') {
        await testRun.materialize({ finished: false })
      }
      console.log(JSON.stringify({ kind: 'run-event', event: persisted }))
    }

    const planStore = createFilePlanStore(process.cwd())
    const shared = {
      plans: planStore,
      ci: Boolean(process.env.CI),
      signal: controller.signal,
      onEvent,
    }
    const runs = selectedResults
      ? await runSelectedResultPairs({
          selectedResults,
          selections,
          targets: resolvedConfiguration.targets,
          retry: resolvedConfiguration.retry,
          timeout: resolvedConfiguration.timeout,
          concurrency: resolvedConfiguration.concurrency,
          applicationRevision: resolvedConfiguration.applicationRevision,
          ...shared,
        })
      : await runScenarios({
          selections,
          ...resolvedConfiguration,
          ...shared,
        })
    const manifest = await testRun.materialize()
    if (args.junitPath) await Bun.write(args.junitPath, formatJunit(manifest))
    if (args.jsonPath) await Bun.write(args.jsonPath, formatJson(manifest))
    if (args.ndjsonPath) {
      await Bun.write(args.ndjsonPath, formatNdjson(await testRun.events()))
    }
    await store.applyRetention({
      maxAgeMs: config.retention?.days
        ? config.retention.days * dayMs
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
    if (resolvedConfiguration) {
      await disposeAdapters(resolvedConfiguration.targets)
    }
  }
}

async function runSelectedResultPairs(
  input: {
    selectedResults: readonly TestResult[]
    selections: ReturnType<typeof selectScenarios>
    targets: ReturnType<typeof resolveRunConfiguration>['targets']
  } & Omit<Parameters<typeof runScenarios>[0], 'selections' | 'targets'>,
) {
  const runs = []
  for (const target of input.targets) {
    const profileId = target.executionTargetProfile.id
    const profileSelections = input.selections.filter((selection) =>
      input.selectedResults.some(
        (result) =>
          result.executionTargetProfile.id === profileId &&
          selectionMatchesResult(selection, result),
      ),
    )
    if (profileSelections.length === 0) continue
    runs.push(
      ...(await runScenarios({
        ...input,
        selections: profileSelections,
        targets: [target],
      })),
    )
  }
  return runs
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

async function loadPersistedRun(runId: string) {
  const store = openTestRunStore({ root: process.cwd() })
  const run = await store.open(runId)
  const events = await run.events()
  if (events.length === 0) throw new Error(`Unknown test run "${runId}"`)
  const manifestPath = join(
    process.cwd(),
    '.pickle',
    'runs',
    runId,
    'manifest.json',
  )
  const manifest = (await Bun.file(manifestPath).exists())
    ? ((await Bun.file(manifestPath).json()) as Awaited<
        ReturnType<typeof run.materialize>
      >)
    : await run.materialize({ finished: false })
  return { manifest, events }
}

async function compare(argv: string[]): Promise<number> {
  if (argv.length !== 3) {
    throw new Error('Usage: pickle compare <baseline-id> <candidate-id>')
  }
  const baseline = await loadPersistedRun(argv[1]!)
  const candidate = await loadPersistedRun(argv[2]!)
  console.log(
    JSON.stringify(
      compareTestRuns(baseline.manifest, candidate.manifest),
      null,
      2,
    ),
  )
  return 0
}

async function importArchive(argv: string[]): Promise<number> {
  if (argv.length !== 2) throw new Error('Usage: pickle import <archive>')
  const imported = await importRunArchive({
    root: process.cwd(),
    archivePath: resolve(argv[1]!),
  })
  console.log(
    JSON.stringify({
      kind: 'imported-run',
      id: imported.manifest.id,
      preservedArchivePath: imported.preservedArchivePath,
    }),
  )
  return 0
}

async function exportRun(argv: string[]): Promise<number> {
  if (argv[0] !== 'export' || !argv[1]) {
    throw new Error(
      'Usage: pickle export <id> (--archive <path> | --html <path>) [--all-artifacts]',
    )
  }
  const runId = argv[1]
  let archivePath: string | undefined
  let htmlPath: string | undefined
  let allArtifacts = false
  for (let index = 2; index < argv.length; index++) {
    const flag = argv[index]!
    if (flag === '--archive') archivePath = valueAfter(argv, index++)
    else if (flag === '--html') htmlPath = valueAfter(argv, index++)
    else if (flag === '--all-artifacts') allArtifacts = true
    else throw new Error(`Unknown option: ${flag}`)
  }
  if (!archivePath && !htmlPath) {
    throw new Error('pickle export requires --archive or --html')
  }
  if (archivePath && htmlPath) {
    throw new Error('pickle export accepts either --archive or --html')
  }
  if (archivePath) {
    await writeRunArchive({
      root: process.cwd(),
      runId,
      outputPath: resolve(archivePath),
    })
    return 0
  }

  const { manifest } = await loadPersistedRun(runId)
  const html = await formatHtml(manifest, {
    artifacts: allArtifacts ? 'all' : 'failures-and-adaptations',
  })
  const htmlBytes = Buffer.byteLength(html, 'utf8')
  const warningThreshold = 10 * 1024 * 1024
  if (allArtifacts && htmlBytes > warningThreshold) {
    console.error(
      `Warning: HTML export includes every available test artifact and is larger than 10 MB (${htmlBytes} bytes).`,
    )
  }
  await Bun.write(resolve(htmlPath!), html)
  return 0
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
  if (argv[0] === 'compare') {
    return compare(argv)
  }
  if (argv[0] === 'import') {
    return importArchive(argv)
  }
  if (argv[0] === 'export') {
    return exportRun(argv)
  }
  return run(argv)
}

try {
  process.exitCode = await main(Bun.argv.slice(2))
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 2
}
