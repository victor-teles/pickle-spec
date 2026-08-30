import type {
  TestRunComparison,
  TestRunManifest,
  TestRunSummary,
} from '@pickle-spec/runner'
import { type Dispatch, type SetStateAction, useMemo, useState } from 'react'
import type { StudioApi } from '../../app/studio-api'
import type { RunsFilters, StudioRoute } from '../../app/studio-route'
import { toast } from '../../components/ui/toast'
import type {
  StudioProject,
  StudioRunSnapshot,
  StudioRunsIndex,
} from '../../server/contracts'
import { defaultRunAttemptLocation } from '../result/live-result-follow'
import type { LiveResultInspection } from '../result/live-result-inspection'
import { reasonMessage } from '../result/result-presentation'
import {
  activeRunListItem,
  filterRuns,
  type RunListItem,
  runListItems,
} from '../runs-model'

export type FilterOption = { value: string; label: string }

export type RunFilterOptions = {
  specifications: FilterOption[]
  profiles: FilterOption[]
  suites: FilterOption[]
}

export type RunsDashboardModel = {
  comparison?: TestRunComparison
  error?: string
  filterOptions: RunFilterOptions
  filters: RunsFilters
  items: RunListItem[]
  openingRunId?: string
  pinnedRunIds: ReadonlySet<string>
  selectedRunIds: readonly string[]
  specificationNames: ReadonlyMap<string, string>
  visibleActiveRunIds: readonly string[]
  clearFilters: () => void
  compareSelected: () => void
  deleteEligible: () => void
  importArchive: (file?: File) => void
  openRunAttempt: (runId: string) => void
  setFilters: (patch: Partial<RunsFilters>) => void
  setPinned: (runId: string, pinned: boolean) => void
  setSelectedRunIds: Dispatch<SetStateAction<string[]>>
}

type UseRunsDashboardOptions = {
  api: StudioApi
  index?: StudioRunsIndex
  inspections: ReadonlyMap<string, LiveResultInspection>
  project: StudioProject
  route: Extract<StudioRoute, { kind: 'runs' }>
  onNavigate: (route: StudioRoute, replace?: boolean) => void
  reloadIndex: () => Promise<StudioRunsIndex>
}

export function useRunsDashboard(
  options: UseRunsDashboardOptions,
): RunsDashboardModel {
  const filters = options.route.filters
  const { activeIds, allItems, specificationNames } = useRunCollections(options)
  const activeItems = useMemo(
    () =>
      (options.index?.activeRunIds ?? []).map((runId) =>
        activeRunListItem(
          runId,
          options.inspections.get(runId),
          allItems.find((item) => item.summary.id === runId)?.summary,
        ),
      ),
    [allItems, options.index?.activeRunIds, options.inspections],
  )
  const visibleActiveRunIds = useMemo(
    () =>
      filterRuns(activeItems, filters, specificationNames).map(
        (item) => item.summary.id,
      ),
    [activeItems, filters, specificationNames],
  )
  const items = useMemo(
    () =>
      filterRuns(
        allItems.filter((item) => !activeIds.has(item.summary.id)),
        filters,
        specificationNames,
      ),
    [activeIds, allItems, filters, specificationNames],
  )
  const [error, setError] = useState<string>()
  const [openingRunId, setOpeningRunId] = useState<string>()
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])
  const [comparison, setComparison] = useState<TestRunComparison>()
  const navigateToFilters = (nextFilters: RunsFilters) =>
    options.onNavigate({ kind: 'runs', filters: nextFilters }, true)

  return {
    comparison,
    error,
    filterOptions: optionsFrom(options.index?.runs ?? [], options.project),
    filters,
    items,
    openingRunId,
    pinnedRunIds: new Set(options.index?.storage.pinnedRunIds ?? []),
    selectedRunIds,
    specificationNames,
    visibleActiveRunIds,
    clearFilters: () => navigateToFilters({}),
    compareSelected: () =>
      void compareSelectedRuns(
        options.api,
        selectedRunIds,
        setComparison,
        setError,
      ),
    deleteEligible: () =>
      void deleteEligibleRuns(
        options,
        selectedRunIds,
        setSelectedRunIds,
        setComparison,
        setError,
      ),
    importArchive: (file) => void importRunArchive(options, file, setError),
    openRunAttempt: (runId) =>
      void openRunAttempt(options, runId, setOpeningRunId, setError),
    setFilters: (patch) => navigateToFilters({ ...filters, ...patch }),
    setPinned: (runId, pinned) =>
      void setRunPinned(options, runId, pinned, setError),
    setSelectedRunIds,
  }
}

function useRunCollections(options: UseRunsDashboardOptions) {
  const specificationNames = useMemo(
    () =>
      new Map(
        options.project.specifications.map((specification) => [
          specification.uri,
          specification.name,
        ]),
      ),
    [options.project.specifications],
  )
  const activeIds = useMemo(
    () => new Set(options.index?.activeRunIds ?? []),
    [options.index?.activeRunIds],
  )
  const allItems = useMemo(
    () => runListItems(options.index?.runs ?? [], activeIds),
    [activeIds, options.index?.runs],
  )
  return { activeIds, allItems, specificationNames }
}

async function openRunAttempt(
  options: Pick<UseRunsDashboardOptions, 'api' | 'onNavigate'>,
  runId: string,
  setOpeningRunId: Dispatch<SetStateAction<string | undefined>>,
  setError: (error?: string) => void,
) {
  setError(undefined)
  setOpeningRunId(runId)
  try {
    const snapshot = await options.api<StudioRunSnapshot>(
      `/api/runs/${encodeURIComponent(runId)}`,
    )
    const location = defaultRunAttemptLocation(snapshot)
    options.onNavigate(
      location ? { kind: 'result', location } : { kind: 'run', runId },
    )
  } catch (reason) {
    setError(reasonMessage(reason))
  } finally {
    setOpeningRunId((current) => (current === runId ? undefined : current))
  }
}

async function compareSelectedRuns(
  api: StudioApi,
  runIds: readonly string[],
  setComparison: (value: TestRunComparison) => void,
  setError: (value?: string) => void,
) {
  if (runIds.length !== 2) return
  setError(undefined)
  try {
    setComparison(
      await api('/api/history/compare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baselineRunId: runIds[1],
          candidateRunId: runIds[0],
        }),
      }),
    )
  } catch (reason) {
    setError(reasonMessage(reason))
  }
}

async function importRunArchive(
  options: UseRunsDashboardOptions,
  file: File | undefined,
  setError: (value?: string) => void,
) {
  if (!file) return
  setError(undefined)
  try {
    const manifest = await options.api<TestRunManifest>('/api/history/import', {
      method: 'POST',
      body: file,
    })
    await options.reloadIndex()
    toast.add({
      type: 'success',
      title: 'Test run imported',
      description: `Test run ${manifest.id} is now available in Runs.`,
    })
  } catch (reason) {
    setError(reasonMessage(reason))
  }
}

async function setRunPinned(
  options: UseRunsDashboardOptions,
  runId: string,
  pinned: boolean,
  setError: (value?: string) => void,
) {
  setError(undefined)
  try {
    await options.api(`/api/history/${encodeURIComponent(runId)}/pin`, {
      method: pinned ? 'POST' : 'DELETE',
    })
    await options.reloadIndex()
    toast.add({
      type: 'success',
      title: `Test run ${pinned ? 'pinned' : 'unpinned'}`,
      description: pinned
        ? `${runId} is protected from retention deletion.`
        : `${runId} can be deleted by the retention policy.`,
    })
  } catch (reason) {
    setError(reasonMessage(reason))
  }
}

async function deleteEligibleRuns(
  options: UseRunsDashboardOptions,
  selectedRunIds: readonly string[],
  setSelectedRunIds: Dispatch<SetStateAction<string[]>>,
  setComparison: (value?: TestRunComparison) => void,
  setError: (value?: string) => void,
) {
  setError(undefined)
  try {
    const result = await options.api<{ removed: string[] }>(
      '/api/history/retention',
      { method: 'POST' },
    )
    setSelectedRunIds((current) =>
      current.filter((runId) => !result.removed.includes(runId)),
    )
    if (selectedRunIds.some((runId) => result.removed.includes(runId)))
      setComparison(undefined)
    await options.reloadIndex()
    const empty = result.removed.length === 0
    toast.add({
      type: empty ? 'info' : 'success',
      title: empty ? 'No Test runs deleted' : 'Run retention applied',
      description: empty
        ? 'No local Test runs matched the configured retention policy.'
        : `Deleted ${result.removed.length} local Test runs.`,
    })
  } catch (reason) {
    setError(reasonMessage(reason))
  }
}

function optionsFrom(
  runs: readonly TestRunSummary[],
  project: StudioProject,
): RunFilterOptions {
  const names = new Map(
    project.specifications.map((specification) => [
      specification.uri,
      specification.name,
    ]),
  )
  const specificationUris = new Set(
    runs.flatMap((run) => run.specificationUris),
  )
  for (const specification of project.specifications) {
    specificationUris.add(specification.uri)
  }
  return {
    specifications: [...specificationUris]
      .sort((left, right) =>
        (names.get(left) ?? left).localeCompare(names.get(right) ?? right),
      )
      .map((value) => ({ value, label: names.get(value) ?? value })),
    profiles: [
      ...new Set([
        ...runs.flatMap((run) => run.executionTargetProfileIds),
        ...project.profiles,
      ]),
    ]
      .sort()
      .map((value) => ({ value, label: value })),
    suites: [
      ...new Set([
        ...runs.flatMap((run) => (run.suite ? [run.suite] : [])),
        ...project.suites,
      ]),
    ]
      .sort()
      .map((value) => ({ value, label: value })),
  }
}
