export const resultInspectorTabs = [
  'overview',
  'timeline',
  'artifacts',
  'diagnostics',
] as const

export type ResultInspectorTab = (typeof resultInspectorTabs)[number]

export type ResultInspectionLocation = {
  specificationUri: string
  runId: string
  scenarioId: string
  examplesRowId?: string
  profileId: string
  attempt: number
  tab?: ResultInspectorTab
}
