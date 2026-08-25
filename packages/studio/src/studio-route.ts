import {
  type ResultInspectionLocation,
  resultInspectorTabs,
} from './result-inspection'

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

export type StudioRoute =
  | { kind: 'specifications' }
  | { kind: 'runs'; filters: RunsFilters }
  | { kind: 'run'; runId: string }
  | { kind: 'result'; location: ResultInspectionLocation }
  | { kind: 'not-found' }

const resultRoutePattern =
  /^\/runs\/([^/]+)\/results\/([^/]+)\/([^/]+)\/([^/]+)\/?$/
const runRoutePattern = /^\/runs\/([^/]+)\/?$/

export function parseStudioRoute(input: string): StudioRoute {
  const url = new URL(input, 'http://studio.local')
  if (url.pathname === '/') return { kind: 'specifications' }
  if (url.pathname === '/runs' || url.pathname === '/runs/') {
    return { kind: 'runs', filters: parseRunsFilters(url.searchParams) }
  }

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
  if (route.kind === 'runs') {
    const query = runsFilterQuery(route.filters)
    return query ? `/runs?${query}` : '/runs'
  }
  if (route.kind === 'run') return `/runs/${encodeURIComponent(route.runId)}`

  const { location } = route
  const query = new URLSearchParams({
    specification: location.specificationUri,
  })
  if (location.examplesRowId) query.set('examplesRow', location.examplesRowId)
  if (location.tab) query.set('tab', location.tab)
  return `${[
    '/runs',
    encodeURIComponent(location.runId),
    'results',
    encodeURIComponent(location.scenarioId),
    encodeURIComponent(location.profileId),
    String(location.attempt),
  ].join('/')}?${query}`
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
  const runId = decodeSegment(match[1])
  const scenarioId = decodeSegment(match[2])
  const profileId = decodeSegment(match[3])
  const attempt = Number(match[4])
  const specificationUri = parameters.get('specification')
  if (
    !runId ||
    !scenarioId ||
    !profileId ||
    !specificationUri ||
    !Number.isInteger(attempt) ||
    attempt < 1
  ) {
    return { kind: 'not-found' }
  }
  const requestedTab = parameters.get('tab')
  const tab = resultInspectorTabs.find(
    (candidate) => candidate === requestedTab,
  )
  return {
    kind: 'result',
    location: {
      runId,
      specificationUri,
      scenarioId,
      examplesRowId: parameters.get('examplesRow') ?? undefined,
      profileId,
      attempt,
      tab,
    },
  }
}

function decodeSegment(value: string | undefined): string | undefined {
  if (!value) return undefined
  try {
    return decodeURIComponent(value)
  } catch {
    return undefined
  }
}
