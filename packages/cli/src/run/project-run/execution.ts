import type {
  ExecutionCachePolicy,
  PersistedTestRun,
  ScenarioCompletion,
  ScenarioRun,
  TestResult,
} from '@pickle-spec/runner'
import {
  openLocalExecutionCache,
  runScenarioSchedule,
} from '@pickle-spec/runner'
import { type PreparedRunSelection, selectionMatchesResult } from './selection'
import type { ResolvedProjectRunConfiguration } from './targets'
import type { ProjectRunOptions, StartProjectRunInput } from './types'

type RunSelectedResultPairsInput = {
  selectedResults: readonly TestResult[]
  selections: PreparedRunSelection['selections']
  targets: ResolvedProjectRunConfiguration['targets']
} & Omit<Parameters<typeof runScenarioSchedule>[0], 'selections' | 'targets'>

interface ExecutePreparedRunInput {
  input: StartProjectRunInput
  args: ProjectRunOptions
  selection: PreparedRunSelection
  configuration: ResolvedProjectRunConfiguration
  testRun: PersistedTestRun
  root: string
  onEvent: StartProjectRunInput['onEvent']
}

async function runSelectedResultPairs(
  input: RunSelectedResultPairsInput,
): Promise<ScenarioRun[]> {
  const runs: ScenarioRun[] = []
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
    const targetRuns = await runScenarioSchedule({
      ...input,
      selections: profileSelections,
      targets: [target],
    })
    runs.push(...targetRuns)
  }
  return runs
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

export async function executePreparedRun(
  context: ExecutePreparedRunInput,
): Promise<ScenarioRun[]> {
  const { args, configuration, input, onEvent, root, selection, testRun } =
    context
  const executionCache = await configuredExecutionCache(
    input,
    root,
    configuration.targets,
  )
  let cachePolicy: ExecutionCachePolicy = 'prefer-cache'
  if (args.cacheOnly) cachePolicy = 'cache-only'
  else if (args.refreshCache) cachePolicy = 'refresh'
  const onResult = input.onResult
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
    onResult: onResult
      ? (completion: ScenarioCompletion) => onResult(completion.result)
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
  return runScenarioSchedule({
    selections: selection.selections,
    ...configuration,
    ...shared,
  })
}
