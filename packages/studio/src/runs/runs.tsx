import type {
  TestRunComparison,
  TestRunManifest,
  TestRunSummary,
} from '@pickle-spec/runner'
import { useMemo, useState } from 'react'
import {
  type RunsFilters,
  runFilterStates,
  type StudioRoute,
  studioRouteHref,
} from '../app/studio-route'
import { LedgerLoadingSkeleton } from '../components/loading-skeletons'
import { Badge } from '../components/ui/badge'
import { Button, buttonVariants } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { Input } from '../components/ui/input'
import { ResultMark } from '../components/ui/result-mark'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import { toast } from '../components/ui/toast'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../components/ui/tooltip'
import { useVirtualWindow } from '../hooks/use-virtual-window'
import type {
  StudioProject,
  StudioRunRequest,
  StudioRunsIndex,
} from '../server/server'
import type { LiveResultInspection } from './result/live-result-inspection'
import { ResultInspector } from './result/result-inspector'
import { reasonMessage, resultBadgeVariant } from './result/result-presentation'
import { RunComparison } from './run-comparison'
import { RunDetail } from './run-detail'
import { durationLabel, resultCountLabel } from './run-format'
import { RunStorage } from './run-storage'
import {
  activeRunListItem,
  filterRuns,
  type RunListItem,
  runListItems,
  runProgress,
} from './runs-model'
import { useActiveRuns } from './use-active-runs'
import { VirtualTableSpacer } from './virtual-table-spacer'

type StudioApi = <Value>(path: string, init?: RequestInit) => Promise<Value>

type RunsAreaProps = {
  api: StudioApi
  index?: StudioRunsIndex
  project: StudioProject
  route: Extract<StudioRoute, { kind: 'runs' | 'run' | 'result' }>
  runsBlocked: boolean
  onCancel: (runId: string) => void
  onError: (message: string) => void
  onNavigate: (route: StudioRoute, replace?: boolean) => void
  onRerun: (request: StudioRunRequest) => Promise<void>
  reloadIndex: () => Promise<StudioRunsIndex>
}

const runRowHeight = 68
const noActiveRuns: readonly string[] = []

export function RunsArea(props: RunsAreaProps) {
  const activeRunIds = props.index?.activeRunIds ?? noActiveRuns
  const inspections = useActiveRuns({
    api: props.api,
    runIds: activeRunIds,
    onError: props.onError,
    onFinished: () => void props.reloadIndex(),
  })

  if (props.route.kind === 'result') {
    const location = props.route.location
    const live = inspections.get(location.runId)
    return (
      <ResultInspector
        api={props.api}
        location={location}
        snapshot={live?.snapshot}
        connection={live?.connection}
        onBack={() => props.onNavigate({ kind: 'run', runId: location.runId })}
        onTabChange={(tab) =>
          props.onNavigate(
            {
              kind: 'result',
              location: { ...location, tab },
            },
            true,
          )
        }
      />
    )
  }
  if (props.route.kind === 'run') {
    return (
      <RunDetail
        api={props.api}
        runId={props.route.runId}
        live={inspections.get(props.route.runId)}
        runsBlocked={props.runsBlocked}
        onBack={() => props.onNavigate({ kind: 'runs', filters: {} })}
        onCancel={props.onCancel}
        onInspectResult={(location) =>
          props.onNavigate({ kind: 'result', location })
        }
        onRerun={async (request) => {
          await props.onRerun(request)
          props.onNavigate({ kind: 'runs', filters: {} })
        }}
      />
    )
  }
  return (
    <RunsDashboard
      key={studioRouteHref(props.route)}
      {...props}
      route={props.route}
      inspections={inspections}
    />
  )
}

type RunsDashboardProps = RunsAreaProps & {
  route: Extract<StudioRoute, { kind: 'runs' }>
  inspections: ReadonlyMap<string, LiveResultInspection>
}

function RunsDashboard(props: RunsDashboardProps) {
  const [error, setError] = useState<string>()
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])
  const [comparison, setComparison] = useState<TestRunComparison>()
  const filters = props.route.filters
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
  const runWindow = useVirtualWindow<HTMLDivElement>({
    count: items.length,
    itemSize: runRowHeight,
  })

  if (!props.index) {
    return (
      <section className="min-h-0 flex-1 overflow-auto p-4">
        <LedgerLoadingSkeleton label="Loading Runs" />
      </section>
    )
  }

  const pinnedRunIds = new Set(props.index.storage.pinnedRunIds)
  const filterOptions = optionsFrom(props.index.runs, props.project)

  async function compareSelected() {
    if (selectedRunIds.length !== 2) return
    setError(undefined)
    try {
      setComparison(
        await props.api<TestRunComparison>('/api/history/compare', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            baselineRunId: selectedRunIds[1],
            candidateRunId: selectedRunIds[0],
          }),
        }),
      )
    } catch (reason) {
      setError(reasonMessage(reason))
    }
  }

  async function importArchive(file: File | undefined) {
    if (!file) return
    setError(undefined)
    try {
      const manifest = await props.api<TestRunManifest>('/api/history/import', {
        method: 'POST',
        body: file,
      })
      await props.reloadIndex()
      toast.add({
        type: 'success',
        title: 'Test run imported',
        description: `Test run ${manifest.id} is now available in Runs.`,
      })
    } catch (reason) {
      setError(reasonMessage(reason))
    }
  }

  async function setPinned(runId: string, pinned: boolean) {
    setError(undefined)
    try {
      await props.api(`/api/history/${encodeURIComponent(runId)}/pin`, {
        method: pinned ? 'POST' : 'DELETE',
      })
      await props.reloadIndex()
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

  async function deleteEligible() {
    setError(undefined)
    try {
      const result = await props.api<{ removed: string[] }>(
        '/api/history/retention',
        { method: 'POST' },
      )
      setSelectedRunIds((current) =>
        current.filter((runId) => !result.removed.includes(runId)),
      )
      if (selectedRunIds.some((runId) => result.removed.includes(runId))) {
        setComparison(undefined)
      }
      await props.reloadIndex()
      toast.add({
        type: result.removed.length === 0 ? 'info' : 'success',
        title:
          result.removed.length === 0
            ? 'No Test runs deleted'
            : 'Run retention applied',
        description:
          result.removed.length === 0
            ? 'No local Test runs matched the configured retention policy.'
            : `Deleted ${result.removed.length} local Test runs.`,
      })
    } catch (reason) {
      setError(reasonMessage(reason))
    }
  }

  function updateFilters(patch: Partial<RunsFilters>) {
    props.onNavigate({ kind: 'runs', filters: { ...filters, ...patch } }, true)
  }

  return (
    <section
      aria-labelledby="runs-title"
      className="min-h-0 flex-1 space-y-5 overflow-auto px-3 py-4 sm:px-5"
    >
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
              void importArchive(event.currentTarget.files?.[0])
            }
          />
          <Button
            type="button"
            variant="outline"
            disabled={selectedRunIds.length !== 2}
            onClick={() => void compareSelected()}
          >
            Compare selected runs
          </Button>
        </div>
      </header>

      <ActiveRuns
        runIds={visibleActiveRunIds}
        inspections={props.inspections}
        onCancel={props.onCancel}
        onOpen={(runId) => props.onNavigate({ kind: 'run', runId })}
      />

      <section className="space-y-3" aria-labelledby="run-history-title">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-56 flex-1 space-y-1">
            <label
              htmlFor="run-search"
              className="text-xs text-muted-foreground"
            >
              Search Runs
            </label>
            <Input
              id="run-search"
              type="search"
              value={filters.q ?? ''}
              placeholder="Run ID, suite, Specification, or target"
              onChange={(event) =>
                updateFilters({ q: event.currentTarget.value || undefined })
              }
            />
          </div>
          <FilterMenu
            label="State"
            value={filters.state}
            options={runFilterStates.map((value) => ({ value, label: value }))}
            onValue={(state) =>
              updateFilters({ state: state as RunsFilters['state'] })
            }
          />
          <FilterMenu
            label="Specification"
            value={filters.specification}
            options={filterOptions.specifications}
            onValue={(specification) => updateFilters({ specification })}
          />
          <FilterMenu
            label="Target"
            value={filters.profile}
            options={filterOptions.profiles}
            onValue={(profile) => updateFilters({ profile })}
          />
          <FilterMenu
            label="Suite"
            value={filters.suite}
            options={filterOptions.suites}
            onValue={(suite) => updateFilters({ suite })}
          />
          <Button
            type="button"
            variant="ghost"
            disabled={Object.keys(filters).length === 0}
            onClick={() =>
              props.onNavigate({ kind: 'runs', filters: {} }, true)
            }
          >
            Clear filters
          </Button>
        </div>

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <h2 id="run-history-title" className="sr-only">
          Test run history
        </h2>
        {items.length === 0 && visibleActiveRunIds.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
            {props.index.runs.length === 0
              ? 'No Test runs have been recorded yet.'
              : 'No Test runs match these filters.'}
          </div>
        ) : (
          <RunTable
            items={items}
            window={runWindow}
            selectedRunIds={selectedRunIds}
            pinnedRunIds={pinnedRunIds}
            specificationNames={specificationNames}
            runsBlocked={props.runsBlocked}
            onOpen={(runId) => props.onNavigate({ kind: 'run', runId })}
            onPin={(runId, pinned) => void setPinned(runId, pinned)}
            onRerun={props.onRerun}
            onSelect={setSelectedRunIds}
          />
        )}
      </section>

      {comparison ? <RunComparison comparison={comparison} /> : null}
      <RunStorage
        index={props.index}
        onDeleteEligible={() => void deleteEligible()}
      />
    </section>
  )
}

function ActiveRuns(props: {
  runIds: readonly string[]
  inspections: ReadonlyMap<string, LiveResultInspection>
  onCancel: (runId: string) => void
  onOpen: (runId: string) => void
}) {
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

type RunTableProps = {
  items: readonly RunListItem[]
  window: ReturnType<typeof useVirtualWindow<HTMLDivElement>>
  selectedRunIds: readonly string[]
  pinnedRunIds: ReadonlySet<string>
  specificationNames: ReadonlyMap<string, string>
  runsBlocked: boolean
  onOpen: (runId: string) => void
  onPin: (runId: string, pinned: boolean) => void
  onRerun: (request: StudioRunRequest) => Promise<void>
  onSelect: React.Dispatch<React.SetStateAction<string[]>>
}

function RunTable(props: RunTableProps) {
  const visibleItems = props.items.slice(props.window.start, props.window.end)
  return (
    <section
      ref={props.window.containerRef}
      aria-label="Scrollable Test run history"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users must be able to scroll a virtualized region
      tabIndex={0}
      className="max-h-[36rem] overflow-auto rounded-lg border border-border bg-card"
    >
      <Table aria-label="Test run history">
        <TableHeader>
          <TableRow>
            <TableHead>Compare</TableHead>
            <TableHead>Retention</TableHead>
            <TableHead>Started</TableHead>
            <TableHead>Specifications</TableHead>
            <TableHead>Suite</TableHead>
            <TableHead>Targets</TableHead>
            <TableHead>Duration</TableHead>
            <TableHead>State</TableHead>
            <TableHead>Results</TableHead>
            <TableHead>Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <VirtualTableSpacer height={props.window.before} colSpan={10} />
          {visibleItems.map(({ summary, state }) => (
            <TableRow key={summary.id} style={{ height: runRowHeight }}>
              <TableCell>
                <Checkbox
                  aria-label={`Select ${summary.id} for comparison`}
                  checked={props.selectedRunIds.includes(summary.id)}
                  disabled={
                    !props.selectedRunIds.includes(summary.id) &&
                    props.selectedRunIds.length === 2
                  }
                  onCheckedChange={(checked) =>
                    props.onSelect((current) =>
                      checked
                        ? [...current, summary.id]
                        : current.filter((id) => id !== summary.id),
                    )
                  }
                />
              </TableCell>
              <TableCell>
                <Tooltip>
                  <TooltipTrigger
                    type="button"
                    className={buttonVariants({
                      variant: 'outline',
                      size: 'sm',
                    })}
                    aria-pressed={props.pinnedRunIds.has(summary.id)}
                    onClick={() =>
                      props.onPin(
                        summary.id,
                        !props.pinnedRunIds.has(summary.id),
                      )
                    }
                  >
                    {props.pinnedRunIds.has(summary.id) ? 'Unpin' : 'Pin'}
                  </TooltipTrigger>
                  <TooltipContent side="right">
                    {props.pinnedRunIds.has(summary.id)
                      ? 'Allow retention to delete this Test run.'
                      : 'Protect this Test run from retention deletion.'}
                  </TooltipContent>
                </Tooltip>
              </TableCell>
              <TableCell>
                <span className="block">
                  {new Date(summary.startedAt).toLocaleString()}
                </span>
                <span className="font-mono text-muted-foreground">
                  {summary.id}
                </span>
              </TableCell>
              <TableCell>
                {summary.specificationUris
                  .map((uri) => props.specificationNames.get(uri) ?? uri)
                  .join(', ') || 'None'}
              </TableCell>
              <TableCell>{summary.suite ?? 'Ad hoc selection'}</TableCell>
              <TableCell>
                {summary.executionTargetProfileIds.join(', ') || 'None'}
              </TableCell>
              <TableCell>{durationLabel(summary.durationMs)}</TableCell>
              <TableCell>
                <Badge
                  variant={
                    state === 'running' ? 'running' : resultBadgeVariant(state)
                  }
                >
                  <ResultMark state={state} /> {state}
                </Badge>
              </TableCell>
              <TableCell>{resultCountLabel(summary.resultCount)}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => props.onOpen(summary.id)}
                  >
                    Review run
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={
                      props.runsBlocked ||
                      (summary.state !== 'failed' &&
                        summary.state !== 'infrastructure-error')
                    }
                    onClick={() =>
                      void props.onRerun({
                        rerunId: summary.id,
                        failures: true,
                      })
                    }
                  >
                    Rerun failures
                  </Button>
                </div>
                {summary.sourceRunId ? (
                  <span className="mt-1 block text-muted-foreground">
                    Rerun of {summary.sourceRunId}
                  </span>
                ) : null}
              </TableCell>
            </TableRow>
          ))}
          <VirtualTableSpacer height={props.window.after} colSpan={10} />
        </TableBody>
      </Table>
    </section>
  )
}

type FilterOption = { value: string; label: string }

function FilterMenu(props: {
  label: string
  value?: string
  options: readonly FilterOption[]
  onValue: (value: string | undefined) => void
}) {
  const allValue = '__all__'
  const selected = props.options.find((option) => option.value === props.value)
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        className={buttonVariants({ variant: 'outline' })}
      >
        {props.label}: {selected?.label ?? 'All'}
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuGroup>
          <DropdownMenuLabel>{props.label}</DropdownMenuLabel>
          <DropdownMenuRadioGroup
            value={props.value ?? allValue}
            onValueChange={(value) =>
              props.onValue(value === allValue ? undefined : value)
            }
          >
            <DropdownMenuRadioItem value={allValue}>All</DropdownMenuRadioItem>
            {props.options.map((option) => (
              <DropdownMenuRadioItem key={option.value} value={option.value}>
                {option.label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function optionsFrom(runs: readonly TestRunSummary[], project: StudioProject) {
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

export function runsHref(filters: RunsFilters = {}) {
  return studioRouteHref({ kind: 'runs', filters })
}
