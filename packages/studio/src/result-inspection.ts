export const resultInspectorTabs = [
  'overview',
  'timeline',
  'artifacts',
  'diagnostics',
] as const

export type ResultInspectorTab = (typeof resultInspectorTabs)[number]

export type HistoryLocation = {
  specificationUri: string
  runId: string
  scenarioId?: string
  examplesRowId?: string
  profileId?: string
  attempt?: number
  tab?: ResultInspectorTab
}

export type ResultInspectionLocation = HistoryLocation & {
  scenarioId: string
  profileId: string
  attempt: number
}

export function parseHistoryLocation(
  search: string,
): HistoryLocation | undefined {
  const parameters = new URLSearchParams(search)
  const specificationUri = parameters.get('specification')
  const runId = parameters.get('run')
  if (!specificationUri || !runId) return undefined

  const scenarioId = parameters.get('scenario') ?? undefined
  const examplesRowId = parameters.get('examplesRow') ?? undefined
  const profileId = parameters.get('profile') ?? undefined
  const attemptValue = Number(parameters.get('attempt'))
  const requestedTab = parameters.get('tab')
  const tab = resultInspectorTabs.find((value) => value === requestedTab)

  return {
    specificationUri,
    runId,
    scenarioId,
    examplesRowId,
    profileId,
    attempt:
      scenarioId &&
      profileId &&
      Number.isInteger(attemptValue) &&
      attemptValue > 0
        ? attemptValue
        : undefined,
    tab,
  }
}

export function historyLocationHref(location: HistoryLocation): string {
  const parameters = new URLSearchParams({
    specification: location.specificationUri,
    run: location.runId,
  })
  if (location.scenarioId) parameters.set('scenario', location.scenarioId)
  if (location.examplesRowId) {
    parameters.set('examplesRow', location.examplesRowId)
  }
  if (location.profileId) parameters.set('profile', location.profileId)
  if (location.attempt) parameters.set('attempt', String(location.attempt))
  if (location.tab) parameters.set('tab', location.tab)
  return `?${parameters}`
}

export function isResultInspection(
  location: HistoryLocation | undefined,
): location is ResultInspectionLocation {
  return Boolean(location?.scenarioId && location.profileId && location.attempt)
}
