import type {
  ExecutionTargetProfile,
  TestResult,
  TestRunStore,
} from '@pickle-spec/runner'
import {
  latestHistoricalDurations,
  selectRerunResults,
} from '@pickle-spec/runner'
import {
  resolveScenarioId,
  type ScenarioSelection,
  type SelectionOptions,
  selectScenarios,
} from '@pickle-spec/spec'
import {
  defaultSpecificationGlob,
  type PickleConfig,
} from '../../configuration/config'
import { requiredValue } from '../../required-value'
import { discoverSpecifications, loadPersistedRun } from './inputs'
import type { ProjectRunOptions } from './types'

type SelectedScenarios = ReturnType<typeof selectScenarios>
type ProjectSpecifications = Awaited<ReturnType<typeof discoverSpecifications>>

export type PreparedRunSelection = {
  selections: SelectedScenarios
  selectedResults?: TestResult[]
  profileIds?: string[]
}

interface PrepareRerunSelectionInput {
  root: string
  args: ProjectRunOptions
  config: PickleConfig
  specifications: ProjectSpecifications
  baseSelection: SelectionOptions | undefined
  shardSelection: SelectionOptions['shard']
  historicalDurations: Record<string, number> | undefined
}

export function scenarioSelectionId(selection: ScenarioSelection): string {
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

export function selectionMatchesResult(
  selection: ScenarioSelection,
  result: TestResult,
): boolean {
  if (result.scenario.id) {
    return scenarioSelectionId(selection) === result.scenario.id
  }
  return selection.scenario.name === result.scenario.name
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
  input: PrepareRerunSelectionInput,
): Promise<PreparedRunSelection> {
  const {
    args,
    baseSelection,
    config,
    historicalDurations,
    root,
    shardSelection,
    specifications,
  } = input
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
    profileIds: args.profiles?.length ? args.profiles : undefined,
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
    { historicalDurations },
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

export async function prepareRunSelection(
  store: TestRunStore,
  root: string,
  config: PickleConfig,
  args: ProjectRunOptions,
): Promise<PreparedRunSelection> {
  const specificationPatterns =
    args.pattern ?? config.specifications ?? defaultSpecificationGlob
  const specifications = await discoverSpecifications(
    specificationPatterns,
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
    return prepareRerunSelection({
      root,
      args,
      config,
      specifications,
      baseSelection,
      shardSelection,
      historicalDurations,
    })
  }
  const selections = filterScenarioIds(
    selectScenarios(
      specifications,
      { ...baseSelection, ...args.selection, shard: shardSelection },
      { historicalDurations },
    ),
    args.scenarioIds,
  )
  requireSelections(selections, false)
  return { selections, profileIds: args.profiles }
}

export function selectedTargetFilter(
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
