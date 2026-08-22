import { relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type {
  ExecutionTargetAdapter,
  ExecutionTargetProfile,
  RunEvent,
  RunExtensions,
  ScenarioCompletion,
  ScenarioRun,
  ScheduledTestResult,
  TestResult,
  TestRunManifest,
} from '@pickle-spec/runner'
import {
  createFilePlanStore,
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
import { createWebAdapter, type WebAdapterOptions } from '@pickle-spec/web'
import {
  defaultExtensionsFile,
  defaultSpecificationGlob,
  type PickleConfig,
  runConfigurationFrom,
} from './config'
import type { Extensions } from './extensions'
import { startServer } from './server'

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
  adaptations?: boolean
  fast?: boolean
  refreshCache?: boolean
  cacheOnly?: boolean
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
  args: ProjectRunOptions,
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

export async function loadPersistedRun(root: string, runId: string) {
  const store = openTestRunStore({ root })
  const run = await store.open(runId)
  const events = await run.events()
  if (events.length === 0) throw new Error(`Unknown test run "${runId}"`)
  const manifestPath = resolve(root, '.pickle', 'runs', runId, 'manifest.json')
  const manifest = (await Bun.file(manifestPath).exists())
    ? ((await Bun.file(manifestPath).json()) as TestRunManifest)
    : await run.materialize({ finished: false })
  return { manifest, events }
}

export async function startProjectRun(
  input: StartProjectRunInput,
): Promise<StartedProjectRun> {
  const args = input.options ?? {}
  if (args.refreshCache && args.cacheOnly) {
    throw new Error('--refresh-cache cannot be combined with --cache-only')
  }
  const root = input.root
  const store = openTestRunStore({
    root,
    artifactCapture: input.config.artifacts?.capture,
  })
  const testRun = await store.create({
    ...(args.rerunId ? { sourceRunId: args.rerunId } : {}),
    ...(args.suite ? { suite: args.suite } : {}),
    ...((args.applicationRevision ?? input.config.applicationRevision)
      ? {
          applicationRevision:
            args.applicationRevision ?? input.config.applicationRevision,
        }
      : {}),
  })

  const done = new Promise<{
    runs: ScenarioRun[]
    manifest: TestRunManifest
  }>((resolve, reject) => {
    setTimeout(() => {
      void runWork().then(resolve, reject)
    }, 0)
  })

  async function runWork() {
    let resolvedConfiguration:
      | ReturnType<typeof resolveRunConfiguration>
      | undefined
    let server: Awaited<ReturnType<typeof startServer>> | undefined
    try {
      const specifications = await discoverSpecifications(
        args.pattern ?? input.config.specifications ?? defaultSpecificationGlob,
        args.language ?? input.config.language,
        root,
      )
      const suiteSelection = args.suite
        ? input.config.suites?.[args.suite]
        : undefined
      if (args.suite && !suiteSelection) {
        throw new Error(`Unknown test suite "${args.suite}"`)
      }
      const baseSelection = suiteSelection ?? input.config.selection
      const shardSelection = args.selection?.shard ?? baseSelection?.shard
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
      let selectedResults: TestResult[] | undefined

      if (args.rerunId) {
        const { manifest: sourceManifest } = await loadPersistedRun(
          root,
          args.rerunId,
        )
        selectedResults = selectRerunResults(sourceManifest, {
          failures: args.failures,
          adaptations: args.adaptations,
          ...(args.scenarioIds?.length
            ? { scenarioIds: args.scenarioIds }
            : args.selection?.scenarioName
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
          : input.config.executionTargetProfiles
            ? [
                ...new Set(
                  selectedResults.map(
                    (result) => result.executionTargetProfile.id,
                  ),
                ),
              ]
            : undefined
      }

      if (selections.length === 0)
        throw new Error('No Scenarios match the current selection')

      const extensions = await loadExtensions(args.extensionsPath, root)
      const runConfiguration = {
        ...runConfigurationFrom(input.config, profileIds),
        concurrency: args.concurrency ?? input.config.concurrency,
        applicationRevision:
          args.applicationRevision ?? input.config.applicationRevision,
        execution: {
          infrastructureRetries:
            args.retries ?? input.config.execution?.infrastructureRetries,
          functionalRetries: input.config.execution?.functionalRetries,
          stepTimeoutMs:
            args.stepTimeoutMs ?? input.config.execution?.stepTimeoutMs,
          scenarioTimeoutMs:
            args.scenarioTimeoutMs ?? input.config.execution?.scenarioTimeoutMs,
        },
      }
      resolvedConfiguration = resolveRunConfiguration(
        runConfiguration,
        configuredRunExtensions(
          extensions,
          input.config,
          args,
          runConfiguration.executionTargetProfiles ?? [],
        ),
      )
      validateTargetSelection(selections, resolvedConfiguration.targets)
      const includeTarget = selectedResults
        ? (
            selection: ScenarioSelection,
            executionTargetProfile: ExecutionTargetProfile,
          ) =>
            selectedResults.some(
              (result) =>
                result.executionTargetProfile.id ===
                  executionTargetProfile.id &&
                selectionMatchesResult(selection, result),
            )
        : undefined
      await input.onSchedule?.(
        scheduleScenarios({
          selections,
          executionTargetProfiles: resolvedConfiguration.targets.map(
            ({ executionTargetProfile }) => executionTargetProfile,
          ),
          includeTarget,
        }),
      )
      server = await startServer({
        ...input.config.server,
        ...(args.reuseServer ? { reuseExisting: true } : {}),
      })
      const onEvent = async (event: RunEvent) => {
        const persisted = await testRun.append(event)
        if (event.type === 'scenario-finished') {
          await testRun.materialize({ finished: false })
        }
        await input.onEvent?.(persisted)
      }
      for (const event of await testRun.events()) {
        await input.onEvent?.(event)
      }
      const planStore = createFilePlanStore(root, {
        candidateEvidence: { testRunId: testRun.id },
      })
      const cacheCapable = resolvedConfiguration.targets.some(
        (target) => target.adapter.executionCache !== undefined,
      )
      const executionCache = cacheCapable
        ? await openLocalExecutionCache({
            projectRoot: root,
            cacheRoot: process.env.PICKLE_CACHE_ROOT,
            maxBytes: input.config.cache?.maxBytes,
          })
        : undefined
      const shared = {
        plans: planStore,
        ...(executionCache
          ? {
              executionCache: {
                store: executionCache,
                projectKey: executionCache.projectKey,
                sourceRunId: testRun.id,
              },
            }
          : {}),
        cachePolicy: args.cacheOnly
          ? ('cache-only' as const)
          : args.refreshCache
            ? ('refresh' as const)
            : ('prefer-cache' as const),
        ci: Boolean(process.env.CI),
        signal: input.signal,
        onEvent,
        onResult: input.onResult
          ? (completion: ScenarioCompletion) =>
              input.onResult?.(completion.result)
          : undefined,
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
      return { runs, manifest }
    } finally {
      server?.stop()
      if (resolvedConfiguration) {
        await disposeAdapters(resolvedConfiguration.targets)
      }
    }
  }

  return { id: testRun.id, done }
}
