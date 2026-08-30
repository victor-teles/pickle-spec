import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { MobileLiveViewportUpdate } from '@pickle-spec/mobile'
import type {
  EvidencePersistencePolicy,
  ExecutionCachePolicy,
  ExecutionTargetAdapter,
  ExecutionTargetProfile,
  PersistedTestRun,
  RunEvent,
  RunExtensions,
  ScenarioCompletion,
  ScenarioRun,
  ScheduledTestResult,
  TestResult,
  TestRunManifest,
  TestRunStore,
} from '@pickle-spec/runner'
import {
  latestHistoricalDurations,
  openLocalExecutionCache,
  openTestRunStore,
  resolveRunConfiguration,
  runScenarios,
  scheduleScenarios,
  selectRerunResults,
  validateTargetSelection,
} from '@pickle-spec/runner'
import {
  parseSpecification,
  resolveScenarioId,
  type ScenarioSelection,
  type SelectionOptions,
  selectScenarios,
  validateSpecificationMetadata,
} from '@pickle-spec/spec'
import {
  createWebAdapter,
  resolveWebArtifactCapture,
  type WebAdapterOptions,
  type WebLiveViewportUpdate,
} from '@pickle-spec/web'

export type ProjectLiveViewportUpdate =
  | WebLiveViewportUpdate
  | MobileLiveViewportUpdate

import { resolveApplicationRevision } from '../configuration/application-revision'
import {
  defaultExtensionsFile,
  defaultSpecificationGlob,
  type PickleConfig,
  runConfigurationFrom,
} from '../configuration/config'
import type { Extensions } from '../extensions/extensions'
import { requiredValue } from '../required-value'
import {
  type ApplicationOutputAvailability,
  type ApplicationOutputLine,
  startServer,
} from '../server/server'
import { configuredMobileAdapter } from '../studio/studio-mobile-targets'
import {
  type ApplicationDiagnosticBuffer,
  createApplicationDiagnosticBuffer,
  type LiveApplicationDiagnostic,
} from './application-diagnostics'
import {
  type ApplicationOutputOptions,
  resolveApplicationOutput,
} from './application-output'
import { resolveEvidencePersistence } from './evidence-persistence'

export interface ProjectRunOptions {
  pattern?: string
  extensionsPath?: string
  suite?: string
  profiles?: string[]
  selection?: SelectionOptions
  retries?: number
  concurrency?: number
  language?: string
  scenarioTimeoutMs?: number
  stepTimeoutMs?: number
  reuseServer?: boolean
  headed?: boolean
  screenshotMode?: NonNullable<WebAdapterOptions['screenshots']>['mode']
  applicationRevision?: string
  rerunId?: string
  scenarioIds?: string[]
  failures?: boolean
  fast?: boolean
  refreshCache?: boolean
  cacheOnly?: boolean
  applicationOutput?: ApplicationOutputOptions
  evidencePersistence?: EvidencePersistencePolicy
}

export interface StartedProjectRun {
  id: string
  done: Promise<{
    runs: ScenarioRun[]
    manifest: TestRunManifest
  }>
}

type StartProjectRunInput = {
  root: string
  config: PickleConfig
  options?: ProjectRunOptions
  signal?: AbortSignal
  onEvent?: (event: RunEvent) => void | Promise<void>
  onApplicationDiagnostic?: (event: LiveApplicationDiagnostic) => void
  onLiveViewport?: (update: ProjectLiveViewportUpdate) => void
  onSchedule?: (
    schedule: readonly ScheduledTestResult[],
  ) => void | Promise<void>
  onResult?: (result: TestResult) => void | Promise<void>
}

export async function loadExtensions(
  path?: string,
  root = process.cwd(),
): Promise<Extensions> {
  const selectedPath = path ?? defaultExtensionsFile
  const absolutePath = resolve(root, selectedPath)
  if (!(await Bun.file(absolutePath).exists())) {
    if (!path) return {}
    throw new Error(`Extensions file not found: ${selectedPath}`)
  }
  return ((await import(pathToFileURL(absolutePath).href)).default ??
    {}) as Extensions
}

export async function loadProjectSpecifications(
  patterns: string | string[],
  language: string | undefined,
  root: string,
) {
  const paths = new Set<string>()
  for (const pattern of Array.isArray(patterns) ? patterns : [patterns]) {
    const glob = new Bun.Glob(pattern)
    for await (const path of glob.scan({
      cwd: root,
      absolute: true,
      onlyFiles: true,
    }))
      paths.add(path)
  }
  if (paths.size === 0) return []
  const files = await Promise.all(
    [...paths].sort().map(async (path) => ({
      uri: relative(root, path),
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

async function discoverSpecifications(
  patterns: string | string[],
  language: string | undefined,
  root: string,
) {
  const specifications = await loadProjectSpecifications(
    patterns,
    language,
    root,
  )
  if (specifications.length === 0) {
    const description = Array.isArray(patterns) ? patterns.join(', ') : patterns
    throw new Error(`No specifications found matching: ${description}`)
  }
  return specifications
}

function configuredWebOptions(
  config: PickleConfig,
  args: ProjectRunOptions,
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
      mode: resolveWebArtifactCapture({
        screenshotMode: args.screenshotMode ?? web.screenshots?.mode,
        artifactsCapture: config.artifacts?.capture,
      }).screenshots,
    },
  }
}

function configuredAdapter(
  extensions: Extensions,
  web: WebAdapterOptions | undefined,
  onLiveViewport?: (update: ProjectLiveViewportUpdate) => void,
): ExecutionTargetAdapter {
  if (extensions.adapter) return extensions.adapter
  if (!web)
    throw new Error(
      'Configure web.baseUrl or export an adapter from pickle.extensions.ts',
    )
  return createWebAdapter(web, extensions.webAutomationFactory, {
    onLiveViewport,
  })
}

function configureProfileAdapter(
  adapters: Record<string, ExecutionTargetAdapter>,
  extensions: Extensions,
  config: PickleConfig,
  args: ProjectRunOptions,
  profile: ExecutionTargetProfile,
  onLiveViewport?: (update: ProjectLiveViewportUpdate) => void,
): void {
  const configuredAdapters = adapters
  if (configuredAdapters[profile.id]) return
  if (profile.adapter === 'mobile') {
    if (!configuredAdapters.mobile) {
      configuredAdapters[profile.id] = configuredMobileAdapter(
        config,
        profile.id,
        undefined,
        { onLiveViewport },
      )
    }
    return
  }
  if (profile.adapter !== 'web') return
  if (configuredAdapters.web) {
    configuredAdapters[profile.id] = configuredAdapters.web
    return
  }
  const web = configuredWebOptions(config, args, profile.id)
  if (!web) {
    throw new Error(
      'Configure web.baseUrl or export an adapter from pickle.extensions.ts',
    )
  }
  configuredAdapters[profile.id] = createWebAdapter(
    web,
    extensions.webAutomationFactory,
    { onLiveViewport },
  )
}

function configuredRunExtensions(
  extensions: Extensions,
  config: PickleConfig,
  args: ProjectRunOptions,
  profiles: readonly ExecutionTargetProfile[],
  onLiveViewport?: (update: ProjectLiveViewportUpdate) => void,
): RunExtensions {
  const adapters: Record<string, ExecutionTargetAdapter> = {
    ...extensions.adapters,
  }
  if (extensions.adapter) adapters.custom ??= extensions.adapter

  for (const profile of profiles) {
    configureProfileAdapter(
      adapters,
      extensions,
      config,
      args,
      profile,
      onLiveViewport,
    )
  }

  return {
    adapter: profiles.some((profile) => profile.adapter)
      ? extensions.adapter
      : configuredAdapter(
          extensions,
          configuredWebOptions(config, args),
          onLiveViewport,
        ),
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

export function scenarioSelectionId(selection: {
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
  if (result.scenario.id) {
    return scenarioSelectionId(selection) === result.scenario.id
  }
  return selection.scenario.name === result.scenario.name
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

type ProjectRunStore = ReturnType<typeof openTestRunStore>
type PersistedProjectRun = Awaited<ReturnType<ProjectRunStore['create']>>
type ResolvedProjectRunConfiguration = ReturnType<
  typeof resolveRunConfiguration
>
type SelectedScenarios = ReturnType<typeof selectScenarios>
type ManagedProjectServer = Awaited<ReturnType<typeof startServer>>

type PreparedRunSelection = {
  selections: SelectedScenarios
  selectedResults?: TestResult[]
  profileIds?: string[]
}

function requireSelections(
  selections: SelectedScenarios,
  rerun: boolean,
): void {
  if (selections.length > 0) return
  throw new Error(
    rerun
      ? 'No Scenarios match the current rerun selection'
      : 'No Scenarios match the current selection',
  )
}

function selectedProfileIds(
  args: ProjectRunOptions,
  config: PickleConfig,
  selectedResults: readonly TestResult[],
): string[] | undefined {
  if (args.profiles?.length) return args.profiles
  if (!config.executionTargetProfiles) return undefined
  return [
    ...new Set(
      selectedResults.map((result) => result.executionTargetProfile.id),
    ),
  ]
}

async function prepareRerunSelection(
  root: string,
  args: ProjectRunOptions,
  config: PickleConfig,
  specifications: Awaited<ReturnType<typeof discoverSpecifications>>,
  baseSelection: SelectionOptions | undefined,
  shardSelection: SelectionOptions['shard'],
  historicalDurations: Record<string, number> | undefined,
): Promise<PreparedRunSelection> {
  const rerunId = requiredValue(args.rerunId)
  const { manifest: sourceManifest } = await loadPersistedRun(root, rerunId)
  const scenarioIds = args.scenarioIds?.length ? args.scenarioIds : undefined
  const scenarioNames =
    !scenarioIds && args.selection?.scenarioName
      ? [args.selection.scenarioName]
      : undefined
  const selectedResults = selectRerunResults(sourceManifest, {
    failures: args.failures,
    scenarioIds,
    scenarioNames,
    ...(args.profiles?.length ? { profileIds: args.profiles } : {}),
  })
  if (selectedResults.length === 0) {
    throw new Error('No results match the current rerun selection')
  }
  const selections = selectScenarios(
    specifications,
    {
      ...baseSelection,
      ...args.selection,
      scenarioName: undefined,
      shard: shardSelection,
    },
    historicalDurations ? { historicalDurations } : {},
  ).filter((selection) =>
    selectedResults.some((result) => selectionMatchesResult(selection, result)),
  )
  requireSelections(selections, true)
  return {
    selections,
    selectedResults,
    profileIds: selectedProfileIds(args, config, selectedResults),
  }
}

function filterScenarioIds(
  selections: SelectedScenarios,
  scenarioIds: readonly string[] | undefined,
): SelectedScenarios {
  if (!scenarioIds?.length) return selections
  const ids = new Set(scenarioIds)
  return selections.filter((selection) =>
    ids.has(scenarioSelectionId(selection)),
  )
}

async function prepareRunSelection(
  store: ProjectRunStore,
  root: string,
  config: PickleConfig,
  args: ProjectRunOptions,
): Promise<PreparedRunSelection> {
  const specifications = await discoverSpecifications(
    args.pattern ?? config.specifications ?? defaultSpecificationGlob,
    args.language ?? config.language,
    root,
  )
  const suiteSelection = args.suite ? config.suites?.[args.suite] : undefined
  if (args.suite && !suiteSelection) {
    throw new Error(`Unknown test suite "${args.suite}"`)
  }
  const baseSelection = suiteSelection ?? config.selection
  const shardSelection = args.selection?.shard ?? baseSelection?.shard
  const historicalDurations = shardSelection
    ? await latestHistoricalDurations(store)
    : undefined
  if (args.rerunId) {
    return prepareRerunSelection(
      root,
      args,
      config,
      specifications,
      baseSelection,
      shardSelection,
      historicalDurations,
    )
  }
  const selections = filterScenarioIds(
    selectScenarios(
      specifications,
      { ...baseSelection, ...args.selection, shard: shardSelection },
      historicalDurations ? { historicalDurations } : {},
    ),
    args.scenarioIds,
  )
  requireSelections(selections, false)
  return { selections, profileIds: args.profiles }
}

async function resolveProjectRunConfiguration(
  config: PickleConfig,
  args: ProjectRunOptions,
  applicationRevision: string | undefined,
  profileIds: string[] | undefined,
  root: string,
  onLiveViewport?: (update: ProjectLiveViewportUpdate) => void,
): Promise<ResolvedProjectRunConfiguration> {
  const extensions = await loadExtensions(args.extensionsPath, root)
  const runConfiguration = {
    ...runConfigurationFrom(config, profileIds),
    concurrency: args.concurrency ?? config.concurrency,
    applicationRevision,
    execution: {
      infrastructureRetries:
        args.retries ?? config.execution?.infrastructureRetries,
      functionalRetries: config.execution?.functionalRetries,
      stepTimeoutMs: args.stepTimeoutMs ?? config.execution?.stepTimeoutMs,
      scenarioTimeoutMs:
        args.scenarioTimeoutMs ?? config.execution?.scenarioTimeoutMs,
    },
  }
  return resolveRunConfiguration(
    runConfiguration,
    configuredRunExtensions(
      extensions,
      config,
      args,
      runConfiguration.executionTargetProfiles ?? [],
      onLiveViewport,
    ),
  )
}

function selectedTargetFilter(
  selectedResults: readonly TestResult[] | undefined,
) {
  if (!selectedResults) return
  return (
    selection: ScenarioSelection,
    executionTargetProfile: ExecutionTargetProfile,
  ) =>
    selectedResults.some(
      (result) =>
        result.executionTargetProfile.id === executionTargetProfile.id &&
        selectionMatchesResult(selection, result),
    )
}

async function publishRunSchedule(
  input: StartProjectRunInput,
  selection: PreparedRunSelection,
  configuration: ResolvedProjectRunConfiguration,
): Promise<void> {
  await input.onSchedule?.(
    scheduleScenarios({
      selections: selection.selections,
      executionTargetProfiles: configuration.targets.map(
        ({ executionTargetProfile }) => executionTargetProfile,
      ),
      includeTarget: selectedTargetFilter(selection.selectedResults),
    }),
  )
}

async function startApplicationDiagnostics(
  input: StartProjectRunInput,
  args: ProjectRunOptions,
  targets: ResolvedProjectRunConfiguration['targets'],
): Promise<{
  server: ManagedProjectServer
  diagnostics: ApplicationDiagnosticBuffer
}> {
  const applicationOutput = resolveApplicationOutput(
    input.config,
    targets.map(({ executionTargetProfile }) => executionTargetProfile),
    args.applicationOutput,
  )
  const pendingOutput: ApplicationOutputLine[] = []
  let diagnostics: ApplicationDiagnosticBuffer | undefined
  const server = await startServer(
    {
      ...input.config.server,
      output: applicationOutput.capture,
      ...(args.reuseServer ? { reuseExisting: true } : {}),
    },
    {
      signal: input.signal,
      onOutput(line) {
        if (diagnostics) diagnostics.record(line)
        else pendingOutput.push(line)
      },
    },
  )
  const unavailableOutput: ApplicationOutputAvailability = {
    stdout: applicationOutput.capture.stdout
      ? 'not-supported'
      : 'not-requested',
    stderr: applicationOutput.capture.stderr
      ? 'not-supported'
      : 'not-requested',
  }
  diagnostics = createApplicationDiagnosticBuffer({
    profiles: applicationOutput.profiles,
    availability: server?.outputAvailability ?? unavailableOutput,
    onDiagnostic: input.onApplicationDiagnostic,
  })
  for (const line of pendingOutput) diagnostics.record(line)
  return { server, diagnostics }
}

function createPersistedEventHandler(
  input: StartProjectRunInput,
  testRun: PersistedProjectRun,
  diagnostics: ApplicationDiagnosticBuffer,
): (event: RunEvent) => Promise<void> {
  return async (event) => {
    const projected = diagnostics.project(event)
    const persisted = await testRun.append(projected)
    if (projected.type === 'scenario-finished') {
      await testRun.materialize({ finished: false })
    }
    await input.onEvent?.(persisted)
  }
}

async function replayPersistedEvents(
  input: StartProjectRunInput,
  testRun: PersistedProjectRun,
): Promise<void> {
  for (const event of await testRun.events()) await input.onEvent?.(event)
}

async function configuredExecutionCache(
  input: StartProjectRunInput,
  root: string,
  targets: ResolvedProjectRunConfiguration['targets'],
) {
  if (!targets.some((target) => target.adapter.executionCache !== undefined)) {
    return
  }
  return openLocalExecutionCache({
    projectRoot: root,
    cacheRoot: process.env.PICKLE_CACHE_ROOT,
    maxBytes: input.config.cache?.maxBytes,
  })
}

async function executePreparedRun(
  input: StartProjectRunInput,
  args: ProjectRunOptions,
  selection: PreparedRunSelection,
  configuration: ResolvedProjectRunConfiguration,
  testRun: PersistedProjectRun,
  root: string,
  onEvent: (event: RunEvent) => Promise<void>,
): Promise<ScenarioRun[]> {
  const executionCache = await configuredExecutionCache(
    input,
    root,
    configuration.targets,
  )
  let cachePolicy: ExecutionCachePolicy = 'prefer-cache'
  if (args.cacheOnly) cachePolicy = 'cache-only'
  else if (args.refreshCache) cachePolicy = 'refresh'
  const shared = {
    executionCache: executionCache
      ? {
          store: executionCache,
          projectKey: executionCache.projectKey,
          sourceRunId: testRun.id,
        }
      : undefined,
    cachePolicy,
    signal: input.signal,
    onEvent,
    onResult: input.onResult
      ? (completion: ScenarioCompletion) => input.onResult?.(completion.result)
      : undefined,
  }
  if (selection.selectedResults) {
    return runSelectedResultPairs({
      selectedResults: selection.selectedResults,
      selections: selection.selections,
      targets: configuration.targets,
      retry: configuration.retry,
      timeout: configuration.timeout,
      concurrency: configuration.concurrency,
      applicationRevision: configuration.applicationRevision,
      ...shared,
    })
  }
  return runScenarios({
    selections: selection.selections,
    ...configuration,
    ...shared,
  })
}

async function stopProjectResources(
  server: ManagedProjectServer,
  configuration: ResolvedProjectRunConfiguration | undefined,
): Promise<void> {
  if (server) {
    server.stop()
    await Promise.race([
      server.outputComplete.catch(() => undefined),
      Bun.sleep(1_000),
    ])
  }
  if (configuration) await disposeAdapters(configuration.targets)
}

export async function loadPersistedRun(root: string, runId: string) {
  const store = openTestRunStore({ root })
  const run = await store.open(runId)
  const events = await run.events()
  if (events.length === 0) throw new Error(`Unknown test run "${runId}"`)
  const manifest = await run.materialize({ finished: false })
  return { manifest, events }
}

interface ProjectRunWorkInput {
  applicationRevision: string | undefined
  args: ProjectRunOptions
  input: StartProjectRunInput
  root: string
  store: TestRunStore
  testRun: PersistedTestRun
}

async function runProjectWork(context: ProjectRunWorkInput) {
  const { applicationRevision, args, input, root, store, testRun } = context
  let configuration: ResolvedProjectRunConfiguration | undefined
  let server: ManagedProjectServer
  try {
    const selection = await prepareRunSelection(store, root, input.config, args)
    configuration = await resolveProjectRunConfiguration(
      input.config,
      args,
      applicationRevision,
      selection.profileIds,
      root,
      input.onLiveViewport,
    )
    validateTargetSelection(selection.selections, configuration.targets)
    await publishRunSchedule(input, selection, configuration)
    const application = await startApplicationDiagnostics(
      input,
      args,
      configuration.targets,
    )
    server = application.server
    const onEvent = createPersistedEventHandler(
      input,
      testRun,
      application.diagnostics,
    )
    await replayPersistedEvents(input, testRun)
    const runs = await executePreparedRun(
      input,
      args,
      selection,
      configuration,
      testRun,
      root,
      onEvent,
    )
    return { runs, manifest: await testRun.materialize() }
  } finally {
    await stopProjectResources(server, configuration)
  }
}

export async function startProjectRun(
  input: StartProjectRunInput,
): Promise<StartedProjectRun> {
  const args = input.options ?? {}
  if (args.refreshCache && args.cacheOnly) {
    throw new Error('--refresh-cache cannot be combined with --cache-only')
  }
  const root = input.root
  const applicationRevision = resolveApplicationRevision(
    args.applicationRevision ?? input.config.applicationRevision,
    root,
  )
  const evidencePersistence = resolveEvidencePersistence({
    argument: args.evidencePersistence,
    configured: input.config.evidence?.persistence,
    artifactsCapture: input.config.artifacts?.capture,
  })
  const store = openTestRunStore({
    root,
    evidencePersistence,
    evidencePersistenceByProfile: Object.fromEntries(
      Object.entries(input.config.executionTargetProfiles ?? {}).flatMap(
        ([profileId, profile]) =>
          profile.evidence?.persistence
            ? [[profileId, profile.evidence.persistence]]
            : [],
      ),
    ),
  })
  const testRun = await store.create({
    ...(args.rerunId ? { sourceRunId: args.rerunId } : {}),
    ...(args.suite ? { suite: args.suite } : {}),
    ...(applicationRevision ? { applicationRevision } : {}),
    evidencePersistence,
  })

  const done = new Promise<{
    runs: ScenarioRun[]
    manifest: TestRunManifest
  }>((finish, reject) => {
    setTimeout(() => {
      void runWork().then(finish, reject)
    }, 0)
  })

  const runWork = () =>
    runProjectWork({ applicationRevision, args, input, root, store, testRun })

  return { id: testRun.id, done }
}
