import {
  type ResultInspectionLocation,
  resultInspectorTabs,
} from '../runs/result/result-inspection'

export const runFilterStates = [
  'running',
  'passed',
  'failed',
  'skipped',
  'cancelled',
  'infrastructure-error',
] as const

export type RunFilterState = (typeof runFilterStates)[number]

export type RunsFilters = {
  q?: string
  state?: RunFilterState
  specification?: string
  profile?: string
  suite?: string
}

export type ResultArtifactLocation = {
  result: ResultInspectionLocation
  artifactIndex: number
}

export type StudioRoute =
  | { kind: 'specifications' }
  | { kind: 'specification'; specificationId: string }
  | {
      kind: 'scenario'
      specificationId: string
      scenarioId: string
    }
  | { kind: 'runs'; filters: RunsFilters }
  | { kind: 'run'; runId: string }
  | { kind: 'result'; location: ResultInspectionLocation }
  | { kind: 'artifact'; location: ResultArtifactLocation }
  | { kind: 'not-found' }

const specificationRoutePattern = /^\/specifications\/([^/]+)$/
const scenarioRoutePattern = /^\/specifications\/([^/]+)\/scenarios\/([^/]+)$/
const runRoutePattern = /^\/runs\/([^/]+)$/
const resultRoutePattern =
  /^\/runs\/([^/]+)\/results\/([^/]+)\/scenarios\/([^/]+)(?:\/examples\/([^/]+))?\/profiles\/([^/]+)\/attempts\/([^/]+)(?:\/artifacts\/([^/]+))?$/

export function parseStudioRoute(input: string): StudioRoute {
  let url: URL
  try {
    url = new URL(input, 'http://studio.local')
  } catch {
    return { kind: 'not-found' }
  }
  if (url.pathname === '/') return { kind: 'specifications' }
  if (url.pathname === '/runs') {
    return { kind: 'runs', filters: parseRunsFilters(url.searchParams) }
  }

  const scenarioMatch = url.pathname.match(scenarioRoutePattern)
  if (scenarioMatch) return parseScenarioRoute(scenarioMatch)

  const specificationMatch = url.pathname.match(specificationRoutePattern)
  if (specificationMatch) return parseSpecificationRoute(specificationMatch)

  const resultMatch = url.pathname.match(resultRoutePattern)
  if (resultMatch) return parseResultRoute(resultMatch, url.searchParams)

  const runMatch = url.pathname.match(runRoutePattern)
  if (runMatch) {
    const runId = decodeSegment(runMatch[1])
    return runId ? { kind: 'run', runId } : { kind: 'not-found' }
  }
  return { kind: 'not-found' }
}

export function studioRouteHref(
  route: Exclude<StudioRoute, { kind: 'not-found' }>,
): string {
  if (route.kind === 'specifications') return '/'
  if (route.kind === 'specification') {
    return `/specifications/${encodeURIComponent(route.specificationId)}`
  }
  if (route.kind === 'scenario') {
    return `/specifications/${encodeURIComponent(route.specificationId)}/scenarios/${encodeURIComponent(route.scenarioId)}`
  }
  if (route.kind === 'runs') {
    const query = runsFilterQuery(route.filters)
    return query ? `/runs?${query}` : '/runs'
  }
  if (route.kind === 'run') return `/runs/${encodeURIComponent(route.runId)}`
  if (route.kind === 'result') return resultRouteHref(route.location)

  const { result, artifactIndex } = route.location
  const path = `${resultRoutePath(result)}/artifacts/${artifactIndex}`
  return result.tab ? `${path}?tab=${result.tab}` : path
}

function parseSpecificationRoute(match: RegExpMatchArray): StudioRoute {
  const specificationId = decodeSegment(match[1])
  return specificationId
    ? { kind: 'specification', specificationId }
    : { kind: 'not-found' }
}

function parseScenarioRoute(match: RegExpMatchArray): StudioRoute {
  const specificationId = decodeSegment(match[1])
  const scenarioId = decodeSegment(match[2])
  return specificationId && scenarioId
    ? { kind: 'scenario', specificationId, scenarioId }
    : { kind: 'not-found' }
}

function parseRunsFilters(parameters: URLSearchParams): RunsFilters {
  const stateValue = parameters.get('state')
  const state = runFilterStates.find((candidate) => candidate === stateValue)
  return compactFilters({
    q: parameters.get('q') ?? undefined,
    state,
    specification: parameters.get('specification') ?? undefined,
    profile: parameters.get('profile') ?? undefined,
    suite: parameters.get('suite') ?? undefined,
  })
}

function compactFilters(filters: RunsFilters): RunsFilters {
  return Object.fromEntries(
    Object.entries(filters).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  ) as RunsFilters
}

function runsFilterQuery(filters: RunsFilters): string {
  const query = new URLSearchParams()
  if (filters.q) query.set('q', filters.q)
  if (filters.state) query.set('state', filters.state)
  if (filters.specification) {
    query.set('specification', filters.specification)
  }
  if (filters.profile) query.set('profile', filters.profile)
  if (filters.suite) query.set('suite', filters.suite)
  return query.toString()
}

function parseResultRoute(
  match: RegExpMatchArray,
  parameters: URLSearchParams,
): StudioRoute {
  if (hasLegacyResultIdentity(parameters)) {
    return { kind: 'not-found' }
  }
  const runId = decodeSegment(match[1])
  const specificationUri = decodeSegment(match[2])
  const scenarioId = decodeSegment(match[3])
  const examplesRowId = match[4] ? decodeSegment(match[4]) : undefined
  const profileId = decodeSegment(match[5])
  const attempt = positiveInteger(match[6])
  const artifactIndex = match[7] ? nonNegativeInteger(match[7]) : undefined
  if (
    !runId ||
    !specificationUri ||
    !scenarioId ||
    (match[4] && !examplesRowId) ||
    !profileId ||
    attempt === undefined ||
    (match[7] && artifactIndex === undefined)
  ) {
    return { kind: 'not-found' }
  }

  const location: ResultInspectionLocation = {
    runId,
    specificationUri,
    scenarioId,
    profileId,
    attempt,
  }
  if (examplesRowId) location.examplesRowId = examplesRowId
  const requestedTab = parameters.get('tab')
  const tab = resultInspectorTabs.find(
    (candidate) => candidate === requestedTab,
  )
  if (tab) location.tab = tab
  return artifactIndex === undefined
    ? { kind: 'result', location }
    : { kind: 'artifact', location: { result: location, artifactIndex } }
}

function hasLegacyResultIdentity(parameters: URLSearchParams): boolean {
  return parameters.has('specification') || parameters.has('examplesRow')
}

function resultRouteHref(location: ResultInspectionLocation): string {
  const path = resultRoutePath(location)
  return location.tab ? `${path}?tab=${location.tab}` : path
}

function resultRoutePath(location: ResultInspectionLocation): string {
  const examples = location.examplesRowId
    ? `/examples/${encodeURIComponent(location.examplesRowId)}`
    : ''
  return `/runs/${encodeURIComponent(location.runId)}/results/${encodeURIComponent(location.specificationUri)}/scenarios/${encodeURIComponent(location.scenarioId)}${examples}/profiles/${encodeURIComponent(location.profileId)}/attempts/${location.attempt}`
}

function positiveInteger(value: string | undefined): number | undefined {
  const number = nonNegativeInteger(value)
  return number && number > 0 ? number : undefined
}

function nonNegativeInteger(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : undefined
}

function decodeSegment(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}
