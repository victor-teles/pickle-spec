import type { TestRunSummary } from '@pickle-spec/runner'
import type {
  StudioProject,
  StudioRunRequest,
  StudioRunsIndex,
  StudioScenario,
  StudioSpecification,
} from './server'

const idleItemLimit = 20
const searchedItemLimit = 50

export type CommandPaletteSpecification = {
  searchValue: string
  specification: StudioSpecification
}

export type CommandPaletteScenario = {
  searchValue: string
  scenario: StudioScenario
  specification: StudioSpecification
}

export type CommandPaletteRun = {
  active: boolean
  id: string
  searchValue: string
  summary?: TestRunSummary
}

export type CommandPaletteItems = {
  runs: CommandPaletteRun[]
  scenarios: CommandPaletteScenario[]
  specifications: CommandPaletteSpecification[]
}

type CommandActionAvailabilityOptions = {
  hasScenario: boolean
  hasSpecification: boolean
  hasSpecifications: boolean
  projectCanRun: boolean
  running: boolean
  scenarioCanRun: boolean
  specificationCanRun: boolean
}

type BuildCommandPaletteItemsOptions = {
  index?: StudioRunsIndex
  project: StudioProject
  query: string
}

export function buildCommandPaletteItems(
  options: BuildCommandPaletteItemsOptions,
): CommandPaletteItems {
  const specificationNames = new Map(
    options.project.specifications.map((specification) => [
      specification.uri,
      specification.name,
    ]),
  )
  const specifications = options.project.specifications.map(
    (specification) => ({
      specification,
      searchValue: [
        'Specification',
        specification.id,
        specification.name,
        specification.uri,
        ...(specification.tags ?? []),
      ].join(' '),
    }),
  )
  const scenarios = options.project.specifications.flatMap((specification) =>
    specification.scenarios.map((scenario) => ({
      scenario,
      specification,
      searchValue: [
        'Scenario',
        scenario.id,
        scenario.name,
        specification.id,
        specification.name,
        specification.uri,
      ].join(' '),
    })),
  )
  const runs = runItems(options.index, specificationNames)

  return {
    specifications: matchingItems(specifications, options.query),
    scenarios: matchingItems(scenarios, options.query),
    runs: matchingItems(runs, options.query),
  }
}

export function targetNewRun(
  request: StudioRunRequest,
  profileId: string | undefined,
): StudioRunRequest {
  return {
    ...request,
    profiles: profileId ? [profileId] : undefined,
  }
}

export function commandActionAvailability(
  options: CommandActionAvailabilityOptions,
) {
  const canStartSpecification =
    !options.running && options.hasSpecification && options.specificationCanRun

  return {
    runAll:
      !options.running && options.projectCanRun && options.hasSpecifications,
    runScenario:
      canStartSpecification && options.hasScenario && options.scenarioCanRun,
    runSpecification: canStartSpecification,
    refreshSpecification: canStartSpecification,
  }
}

export function limitCommandPaletteItems<Item>(
  items: readonly Item[],
  query: string,
): Item[] {
  const limit = normalize(query).trim() ? searchedItemLimit : idleItemLimit
  return items.slice(0, limit)
}

function runItems(
  index: StudioRunsIndex | undefined,
  specificationNames: ReadonlyMap<string, string>,
): CommandPaletteRun[] {
  if (!index) return []
  const activeRunIds = new Set(index.activeRunIds)
  const summaries = new Map(index.runs.map((summary) => [summary.id, summary]))
  const runIds = [
    ...index.activeRunIds,
    ...index.runs
      .map((summary) => summary.id)
      .filter((id) => !activeRunIds.has(id)),
  ]

  return runIds.map((id) => {
    const summary = summaries.get(id)
    const specificationLabels = summary?.specificationUris.flatMap((uri) => [
      uri,
      specificationNames.get(uri) ?? '',
    ])
    return {
      id,
      active: activeRunIds.has(id),
      summary,
      searchValue: [
        'Run',
        id,
        activeRunIds.has(id) ? 'running active' : '',
        summary?.state,
        summary?.suite,
        summary?.startedAt,
        ...(summary?.executionTargetProfileIds ?? []),
        ...(specificationLabels ?? []),
      ].join(' '),
    }
  })
}

function matchingItems<Item extends { searchValue: string }>(
  items: readonly Item[],
  query: string,
): Item[] {
  const tokens = normalize(query).split(/\s+/).filter(Boolean)
  if (tokens.length === 0) return limitCommandPaletteItems(items, query)
  return limitCommandPaletteItems(
    items.filter((item) => matchesCommandQuery(item.searchValue, query)),
    query,
  )
}

export function matchesCommandQuery(value: string, query: string): boolean {
  const normalizedValue = normalize(value)
  return normalize(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => normalizedValue.includes(token))
}

function normalize(value: string): string {
  return value.toLocaleLowerCase()
}
