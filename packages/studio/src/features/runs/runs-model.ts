import type { TestRunSummary } from '@pickle-spec/runner'
import type { RunFilterState, RunsFilters } from '../studio/studio-route'
import {
  isAttemptInProgress,
  type LiveResultInspection,
} from './result/live-result-inspection'

export type RunListItem = {
  summary: TestRunSummary
  state: RunFilterState
}

export type RunProgress = {
  scheduled: number
  completed: number
  running: number
  failed: number
}

export function runListItems(
  runs: readonly TestRunSummary[],
  activeRunIds: ReadonlySet<string>,
): RunListItem[] {
  return [...runs]
    .sort(
      (left, right) =>
        Date.parse(right.startedAt) - Date.parse(left.startedAt) ||
        right.id.localeCompare(left.id),
    )
    .map((summary) => ({
      summary,
      state: activeRunIds.has(summary.id) ? 'running' : summary.state,
    }))
}

export function activeRunListItem(
  runId: string,
  inspection: LiveResultInspection | undefined,
  indexedSummary: TestRunSummary | undefined,
): RunListItem {
  const manifest = inspection?.snapshot?.manifest
  const scheduledProfiles =
    inspection?.schedule.map((item) => item.executionTargetProfile.id) ?? []
  const scheduledSpecifications =
    inspection?.schedule.map((item) => item.specification.uri) ?? []
  const resultProfiles =
    manifest?.results.map((result) => result.executionTargetProfile.id) ?? []
  const resultSpecifications =
    manifest?.results.map((result) => result.specification.uri) ?? []
  const summary = indexedSummary ?? {
    id: runId,
    startedAt: manifest?.startedAt ?? '',
    executionTargetProfileIds: [],
    specificationUris: [],
    state: manifest?.state ?? 'skipped',
    resultCount: manifest?.results.length ?? 0,
  }
  return {
    summary: {
      ...summary,
      suite: summary.suite ?? manifest?.suite,
      applicationRevision:
        summary.applicationRevision ?? manifest?.applicationRevision,
      executionTargetProfileIds: unique([
        ...summary.executionTargetProfileIds,
        ...resultProfiles,
        ...scheduledProfiles,
      ]),
      specificationUris: unique([
        ...summary.specificationUris,
        ...resultSpecifications,
        ...scheduledSpecifications,
      ]),
    },
    state: 'running',
  }
}

export function filterRuns(
  items: readonly RunListItem[],
  filters: RunsFilters,
  specificationNames: ReadonlyMap<string, string>,
): RunListItem[] {
  const query = filters.q?.trim().toLocaleLowerCase()
  return items.filter((item) =>
    runMatchesFilters(item, filters, query, specificationNames),
  )
}

function runMatchesFilters(
  { summary, state }: RunListItem,
  filters: RunsFilters,
  query: string | undefined,
  specificationNames: ReadonlyMap<string, string>,
): boolean {
  if (filters.state && filters.state !== state) return false
  if (
    filters.specification &&
    !summary.specificationUris.includes(filters.specification)
  )
    return false
  if (
    filters.profile &&
    !summary.executionTargetProfileIds.includes(filters.profile)
  )
    return false
  if (filters.suite && summary.suite !== filters.suite) return false
  return (
    !query || searchableRunText(summary, specificationNames).includes(query)
  )
}

export function runProgress(inspection: LiveResultInspection): RunProgress {
  const results = inspection.snapshot?.manifest?.results ?? []
  const completedResults = results.filter((result) => {
    const attempt = result.attempts.at(-1)
    return attempt && !isAttemptInProgress(attempt)
  })
  return {
    scheduled: inspection.schedule.length,
    completed: completedResults.length,
    running: results.length - completedResults.length,
    failed: completedResults.filter(
      (result) =>
        result.state === 'failed' || result.state === 'infrastructure-error',
    ).length,
  }
}

function searchableRunText(
  run: TestRunSummary,
  specificationNames: ReadonlyMap<string, string>,
): string {
  return [
    run.id,
    run.suite,
    run.applicationRevision,
    ...run.executionTargetProfileIds,
    ...run.specificationUris.flatMap((uri) => [
      uri,
      specificationNames.get(uri),
    ]),
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLocaleLowerCase()
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)]
}
