import type { TestRunComparison, TestRunSummary } from '@pickle-spec/runner'
import { useMemo, useState } from 'react'
import type { StudioApi } from '../app/studio-api'
import type { RunsFilters, StudioRoute } from '../app/studio-route'
import { LedgerLoadingSkeleton } from '../components/loading-skeletons'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { ResultMark } from '../components/ui/result-mark'
import type {
  StudioProject,
  StudioRunRequest,
  StudioRunsIndex,
} from '../server/server'
import type { LiveResultInspection } from './result/live-result-inspection'
import { RunComparison } from './run-comparison'
import { type RunFilterOptions, RunHistory } from './run-history'
import { RunStorage } from './run-storage'
import {
  compareSelectedRuns,
  deleteEligibleRuns,
  importRunArchive,
  openRunAttempt,
  setRunPinned,
} from './runs-dashboard-actions'
import {
  activeRunListItem,
  filterRuns,
  type RunListItem,
  runListItems,
  runProgress,
} from './runs-model'

type RunsDashboardProps = {
  api: StudioApi
  index?: StudioRunsIndex
  project: StudioProject
  route: Extract<StudioRoute, { kind: 'runs' }>
  runsBlocked: boolean
  inspections: ReadonlyMap<string, LiveResultInspection>
  onCancel: (runId: string) => void
  onNavigate: (route: StudioRoute, replace?: boolean) => void
  onRerun: (request: StudioRunRequest) => Promise<void>
  reloadIndex: () => Promise<StudioRunsIndex>
}

type RunsDashboardData = {
  filterOptions: RunFilterOptions
  filters: RunsFilters
  items: readonly RunListItem[]
  pinnedRunIds: ReadonlySet<string>
  specificationNames: ReadonlyMap<string, string>
  visibleActiveRunIds: readonly string[]
}

type RunsDashboardState = {
  comparison?: TestRunComparison
  error?: string
  openingRunId?: string
  selectedRunIds: readonly string[]
  compareSelected: () => Promise<void>
  deleteEligible: () => void
  importArchive: (file?: File) => void
  openRunAttempt: (runId: string) => void
  setPinned: (runId: string, pinned: boolean) => void
  setSelection: (runId: string, selected: boolean) => void
}

export function RunsDashboard(props: RunsDashboardProps) {
  const data = useRunsDashboardData(props)
  const state = useRunsDashboardState(props)
  if (!props.index) return <RunsLoading />

  const handleFilterChange = (patch: Partial<RunsFilters>) => {
    props.onNavigate(
      { kind: 'runs', filters: { ...data.filters, ...patch } },
      true,
    )
  }

  return (
    <section
      aria-labelledby="runs-title"
      className="min-h-0 flex-1 space-y-5 overflow-auto px-3 py-4 sm:px-5"
    >
      <RunsHeader
        selectedRunCount={state.selectedRunIds.length}
        onCompareSelected={state.compareSelected}
        onImportArchive={state.importArchive}
      />
      <ActiveRuns
        runIds={data.visibleActiveRunIds}
        inspections={props.inspections}
        onCancel={props.onCancel}
        onOpen={(runId) => props.onNavigate({ kind: 'run', runId })}
      />
      <RunHistory
        error={state.error}
        filters={data.filters}
        filterOptions={data.filterOptions}
        hasVisibleActiveRuns={data.visibleActiveRunIds.length > 0}
        items={data.items}
        openingRunId={state.openingRunId}
        pinnedRunIds={data.pinnedRunIds}
        runsBlocked={props.runsBlocked}
        selectedRunIds={state.selectedRunIds}
        specificationNames={data.specificationNames}
        totalRunCount={props.index.runs.length}
        onClearFilters={() =>
          props.onNavigate({ kind: 'runs', filters: {} }, true)
        }
        onFilterChange={handleFilterChange}
        onOpenRunAttempt={state.openRunAttempt}
        onPinRun={state.setPinned}
        onRerun={props.onRerun}
        onSelectionChange={state.setSelection}
      />
      {state.comparison ? (
        <RunComparison comparison={state.comparison} />
      ) : null}
      <RunStorage index={props.index} onDeleteEligible={state.deleteEligible} />
    </section>
  )
}

function useRunsDashboardData(props: RunsDashboardProps): RunsDashboardData {
  const filters = props.route.filters
  const { activeIds, allItems, specificationNames } = useRunCollections(props)
  const activeItems = useMemo(
    () =>
      (props.index?.activeRunIds ?? []).map((runId) =>
        activeRunListItem(
          runId,
          props.inspections.get(runId),
          allItems.find((item) => item.summary.id === runId)?.summary,
        ),
      ),
    [allItems, props.index?.activeRunIds, props.inspections],
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

  return {
    filterOptions: optionsFrom(props.index?.runs ?? [], props.project),
    filters,
    items,
    pinnedRunIds: new Set(props.index?.storage.pinnedRunIds ?? []),
    specificationNames,
    visibleActiveRunIds,
  }
}

function useRunCollections(props: RunsDashboardProps) {
  const specificationNames = useMemo(
    () =>
      new Map(
        props.project.specifications.map((specification) => [
          specification.uri,
          specification.name,
        ]),
      ),
    [props.project.specifications],
  )
  const activeIds = useMemo(
    () => new Set(props.index?.activeRunIds ?? []),
    [props.index?.activeRunIds],
  )
  const allItems = useMemo(
    () => runListItems(props.index?.runs ?? [], activeIds),
    [activeIds, props.index?.runs],
  )
  return { activeIds, allItems, specificationNames }
}

function useRunsDashboardState(props: RunsDashboardProps): RunsDashboardState {
  const [error, setError] = useState<string>()
  const [openingRunId, setOpeningRunId] = useState<string>()
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])
  const [comparison, setComparison] = useState<TestRunComparison>()

  function setSelection(runId: string, selected: boolean) {
    setSelectedRunIds((current) =>
      selected
        ? [...current, runId]
        : current.filter((currentRunId) => currentRunId !== runId),
    )
  }

  return {
    comparison,
    compareSelected: () =>
      compareSelectedRuns(props.api, selectedRunIds, setComparison, setError),
    deleteEligible: () =>
      void deleteEligibleRuns(
        props.api,
        props.reloadIndex,
        selectedRunIds,
        setSelectedRunIds,
        setComparison,
        setError,
      ),
    error,
    importArchive: (file) =>
      void importRunArchive(props.api, props.reloadIndex, file, setError),
    openingRunId,
    openRunAttempt: (runId) =>
      void openRunAttempt(
        props.api,
        props.onNavigate,
        runId,
        setOpeningRunId,
        setError,
      ),
    selectedRunIds,
    setPinned: (runId, pinned) =>
      void setRunPinned(props.api, props.reloadIndex, runId, pinned, setError),
    setSelection,
  }
}

function RunsLoading() {
  return (
    <section className="min-h-0 flex-1 overflow-auto p-4">
      <LedgerLoadingSkeleton label="Loading Runs" />
    </section>
  )
}

type RunsHeaderProps = {
  selectedRunCount: number
  onCompareSelected: () => Promise<void>
  onImportArchive: (file?: File) => void
}

function RunsHeader(props: RunsHeaderProps) {
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
      <div className="space-y-1">
        <h1 id="runs-title" className="studio-display text-lg sm:text-xl">
          Runs
        </h1>
        <p className="text-sm text-muted-foreground">
          Live progress and persisted Test runs across every Specification.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="file"
          accept="application/json,.json"
          aria-label="Import run archive"
          className="max-w-64"
          onChange={(event) =>
            props.onImportArchive(event.currentTarget.files?.[0])
          }
        />
        <Button
          type="button"
          variant="outline"
          disabled={props.selectedRunCount !== 2}
          onClick={() => void props.onCompareSelected()}
        >
          Compare selected runs
        </Button>
      </div>
    </header>
  )
}

type ActiveRunsProps = {
  runIds: readonly string[]
  inspections: ReadonlyMap<string, LiveResultInspection>
  onCancel: (runId: string) => void
  onOpen: (runId: string) => void
}

function ActiveRuns(props: ActiveRunsProps) {
  if (props.runIds.length === 0) return null
  return (
    <section className="space-y-2" aria-labelledby="active-runs-title">
      <h2 id="active-runs-title" className="studio-display text-sm">
        Active Runs
      </h2>
      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {props.runIds.map((runId) => {
          const inspection = props.inspections.get(runId)
          const progress = inspection ? runProgress(inspection) : undefined
          return (
            <div
              key={runId}
              className="flex flex-wrap items-center justify-between gap-3 p-3"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="running">
                    <ResultMark state="running" /> running
                  </Badge>
                  <span className="truncate font-mono text-xs">{runId}</span>
                </div>
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {progress
                    ? `${progress.completed} of ${progress.scheduled || 'unknown'} results complete · ${progress.running} running · ${progress.failed} failed`
                    : 'Connecting to live progress…'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => props.onOpen(runId)}
                >
                  Open Run
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => props.onCancel(runId)}
                >
                  Cancel Test run
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
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
