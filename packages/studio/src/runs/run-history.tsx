import type { TestRunSummary } from '@pickle-spec/runner'
import { type RunsFilters, runFilterStates } from '../app/studio-route'
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
import { Spinner } from '../components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../components/ui/tooltip'
import { useVirtualWindow } from '../hooks/use-virtual-window'
import type { StudioRunRequest } from '../server/server'
import { resultBadgeVariant } from './result/result-presentation'
import { durationLabel, resultCountLabel } from './run-format'
import type { RunListItem } from './runs-model'
import { VirtualTableSpacer } from './virtual-table-spacer'

const runRowHeight = 68

type FilterOption = {
  value: string
  label: string
}

export type RunFilterOptions = {
  specifications: readonly FilterOption[]
  profiles: readonly FilterOption[]
  suites: readonly FilterOption[]
}

type RunHistoryProps = {
  error?: string
  filters: RunsFilters
  filterOptions: RunFilterOptions
  hasVisibleActiveRuns: boolean
  items: readonly RunListItem[]
  openingRunId?: string
  pinnedRunIds: ReadonlySet<string>
  runsBlocked: boolean
  selectedRunIds: readonly string[]
  specificationNames: ReadonlyMap<string, string>
  totalRunCount: number
  onClearFilters: () => void
  onFilterChange: (patch: Partial<RunsFilters>) => void
  onOpenRunAttempt: (runId: string) => void
  onPinRun: (runId: string, pinned: boolean) => void
  onRerun: (request: StudioRunRequest) => Promise<void>
  onSelectionChange: (runId: string, selected: boolean) => void
}

export function RunHistory(props: RunHistoryProps) {
  const runWindow = useVirtualWindow<HTMLDivElement>({
    count: props.items.length,
    itemSize: runRowHeight,
  })

  return (
    <section className="space-y-3" aria-labelledby="run-history-title">
      <RunFilters
        filters={props.filters}
        filterOptions={props.filterOptions}
        onClear={props.onClearFilters}
        onChange={props.onFilterChange}
      />
      {props.error ? (
        <p role="alert" className="text-sm text-destructive">
          {props.error}
        </p>
      ) : null}
      <h2 id="run-history-title" className="sr-only">
        Test run history
      </h2>
      {props.items.length === 0 && !props.hasVisibleActiveRuns ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
          {props.totalRunCount === 0
            ? 'No Test runs have been recorded yet.'
            : 'No Test runs match these filters.'}
        </div>
      ) : (
        <RunTable
          items={props.items}
          window={runWindow}
          selectedRunIds={props.selectedRunIds}
          pinnedRunIds={props.pinnedRunIds}
          specificationNames={props.specificationNames}
          runsBlocked={props.runsBlocked}
          openingRunId={props.openingRunId}
          onOpen={props.onOpenRunAttempt}
          onPin={props.onPinRun}
          onRerun={props.onRerun}
          onSelectionChange={props.onSelectionChange}
        />
      )}
    </section>
  )
}

type RunFiltersProps = {
  filters: RunsFilters
  filterOptions: RunFilterOptions
  onChange: (patch: Partial<RunsFilters>) => void
  onClear: () => void
}

function RunFilters(props: RunFiltersProps) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="min-w-56 flex-1 space-y-1">
        <label htmlFor="run-search" className="text-xs text-muted-foreground">
          Search Runs
        </label>
        <Input
          id="run-search"
          type="search"
          value={props.filters.q ?? ''}
          placeholder="Run ID, suite, Specification, or target"
          onChange={(event) =>
            props.onChange({ q: event.currentTarget.value || undefined })
          }
        />
      </div>
      <FilterMenu
        label="State"
        value={props.filters.state}
        options={runFilterStates.map((value) => ({ value, label: value }))}
        onValue={(state) =>
          props.onChange({ state: state as RunsFilters['state'] })
        }
      />
      <FilterMenu
        label="Specification"
        value={props.filters.specification}
        options={props.filterOptions.specifications}
        onValue={(specification) => props.onChange({ specification })}
      />
      <FilterMenu
        label="Target"
        value={props.filters.profile}
        options={props.filterOptions.profiles}
        onValue={(profile) => props.onChange({ profile })}
      />
      <FilterMenu
        label="Suite"
        value={props.filters.suite}
        options={props.filterOptions.suites}
        onValue={(suite) => props.onChange({ suite })}
      />
      <Button
        type="button"
        variant="ghost"
        disabled={Object.keys(props.filters).length === 0}
        onClick={props.onClear}
      >
        Clear filters
      </Button>
    </div>
  )
}

type RunTableProps = {
  items: readonly RunListItem[]
  window: ReturnType<typeof useVirtualWindow<HTMLDivElement>>
  selectedRunIds: readonly string[]
  pinnedRunIds: ReadonlySet<string>
  specificationNames: ReadonlyMap<string, string>
  runsBlocked: boolean
  openingRunId?: string
  onOpen: (runId: string) => void
  onPin: (runId: string, pinned: boolean) => void
  onRerun: (request: StudioRunRequest) => Promise<void>
  onSelectionChange: (runId: string, selected: boolean) => void
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
            <TableHead>Run</TableHead>
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
          {visibleItems.map((item) => (
            <RunTableRow
              item={item}
              selectedRunIds={props.selectedRunIds}
              pinnedRunIds={props.pinnedRunIds}
              specificationNames={props.specificationNames}
              runsBlocked={props.runsBlocked}
              openingRunId={props.openingRunId}
              onOpen={props.onOpen}
              onPin={props.onPin}
              onRerun={props.onRerun}
              onSelectionChange={props.onSelectionChange}
              key={item.summary.id}
            />
          ))}
          <VirtualTableSpacer height={props.window.after} colSpan={10} />
        </TableBody>
      </Table>
    </section>
  )
}

type RunTableRowProps = {
  item: RunListItem
  selectedRunIds: readonly string[]
  pinnedRunIds: ReadonlySet<string>
  specificationNames: ReadonlyMap<string, string>
  runsBlocked: boolean
  openingRunId?: string
  onOpen: (runId: string) => void
  onPin: (runId: string, pinned: boolean) => void
  onRerun: (request: StudioRunRequest) => Promise<void>
  onSelectionChange: (runId: string, selected: boolean) => void
}

function RunTableRow(props: RunTableRowProps) {
  const { summary, state } = props.item
  const selected = props.selectedRunIds.includes(summary.id)
  const pinned = props.pinnedRunIds.has(summary.id)
  const opening = props.openingRunId === summary.id

  function handleSelectionChange(checked: boolean) {
    props.onSelectionChange(summary.id, checked)
  }

  function handlePin() {
    props.onPin(summary.id, !pinned)
  }

  return (
    <TableRow style={{ height: runRowHeight }}>
      <TableCell>
        <Checkbox
          aria-label={`Select ${summary.id} for comparison`}
          checked={selected}
          disabled={!selected && props.selectedRunIds.length === 2}
          onCheckedChange={handleSelectionChange}
        />
      </TableCell>
      <TableCell>
        <Tooltip>
          <TooltipTrigger
            type="button"
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
            aria-pressed={pinned}
            onClick={handlePin}
          >
            {pinned ? 'Unpin' : 'Pin'}
          </TooltipTrigger>
          <TooltipContent side="right">
            {pinned
              ? 'Allow retention to delete this Test run.'
              : 'Protect this Test run from retention deletion.'}
          </TooltipContent>
        </Tooltip>
      </TableCell>
      <TableCell>
        <RunIdentity
          summary={summary}
          opening={opening}
          onOpen={props.onOpen}
        />
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
          variant={state === 'running' ? 'running' : resultBadgeVariant(state)}
        >
          <ResultMark state={state} /> {state}
        </Badge>
      </TableCell>
      <TableCell>{resultCountLabel(summary.resultCount)}</TableCell>
      <TableCell>
        <RunTableActions
          summary={summary}
          runsBlocked={props.runsBlocked}
          onRerun={props.onRerun}
        />
      </TableCell>
    </TableRow>
  )
}

type RunIdentityProps = {
  summary: TestRunSummary
  opening: boolean
  onOpen: (runId: string) => void
}

function RunIdentity(props: RunIdentityProps) {
  function handleOpen() {
    props.onOpen(props.summary.id)
  }
  return (
    <div className="flex flex-col items-start gap-0.5">
      <Button
        type="button"
        variant="link"
        aria-label={`Open attempt for ${props.summary.id}`}
        aria-busy={props.opening}
        disabled={props.opening}
        className="h-auto gap-1.5 p-0 font-mono text-left active:opacity-65"
        onClick={handleOpen}
      >
        {props.summary.id}
        {props.opening ? <Spinner className="scale-75" /> : null}
      </Button>
      <time
        dateTime={props.summary.startedAt}
        className="text-muted-foreground"
      >
        {new Date(props.summary.startedAt).toLocaleString()}
      </time>
    </div>
  )
}

type RunTableActionsProps = {
  summary: TestRunSummary
  runsBlocked: boolean
  onRerun: (request: StudioRunRequest) => Promise<void>
}

function RunTableActions(props: RunTableActionsProps) {
  const rerunDisabled =
    props.runsBlocked ||
    (props.summary.state !== 'failed' &&
      props.summary.state !== 'infrastructure-error')
  function handleRerun() {
    void props.onRerun({ rerunId: props.summary.id, failures: true })
  }
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={rerunDisabled}
        onClick={handleRerun}
      >
        Rerun failures
      </Button>
      {props.summary.sourceRunId ? (
        <span className="mt-1 block text-muted-foreground">
          Rerun of {props.summary.sourceRunId}
        </span>
      ) : null}
    </>
  )
}

type FilterMenuProps = {
  label: string
  value?: string
  options: readonly FilterOption[]
  onValue: (value: string | undefined) => void
}

function FilterMenu(props: FilterMenuProps) {
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
