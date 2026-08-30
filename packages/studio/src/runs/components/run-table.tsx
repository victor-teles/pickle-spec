import type { TestRunSummary } from '@pickle-spec/runner'
import type { Dispatch, SetStateAction } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button, buttonVariants } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { ResultMark } from '../../components/ui/result-mark'
import { Spinner } from '../../components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip'
import { useVirtualWindow } from '../../hooks/use-virtual-window'
import type { StudioRunRequest } from '../../server/contracts'
import { resultBadgeVariant } from '../result/result-presentation'
import { durationLabel, resultCountLabel } from '../run-format'
import type { RunListItem } from '../runs-model'
import { VirtualTableSpacer } from '../virtual-table-spacer'

const runRowHeight = 68

type RunTableProps = {
  items: readonly RunListItem[]
  selectedRunIds: readonly string[]
  pinnedRunIds: ReadonlySet<string>
  specificationNames: ReadonlyMap<string, string>
  runsBlocked: boolean
  openingRunId?: string
  onOpen: (runId: string) => void
  onPin: (runId: string, pinned: boolean) => void
  onRerun: (request: StudioRunRequest) => Promise<void>
  onSelect: Dispatch<SetStateAction<string[]>>
}

export function RunTable(props: RunTableProps) {
  const runWindow = useVirtualWindow<HTMLDivElement>({
    count: props.items.length,
    itemSize: runRowHeight,
  })
  const visibleItems = props.items.slice(runWindow.start, runWindow.end)

  return (
    <section
      ref={runWindow.containerRef}
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
          <VirtualTableSpacer height={runWindow.before} colSpan={10} />
          {visibleItems.map((item) => (
            <RunTableRow {...props} {...item} key={item.summary.id} />
          ))}
          <VirtualTableSpacer height={runWindow.after} colSpan={10} />
        </TableBody>
      </Table>
    </section>
  )
}

function RunTableRow(props: Omit<RunTableProps, 'items'> & RunListItem) {
  const { summary, state } = props
  const selected = props.selectedRunIds.includes(summary.id)
  const pinned = props.pinnedRunIds.has(summary.id)
  const opening = props.openingRunId === summary.id

  function handleSelectionChange(checked: boolean) {
    props.onSelect((current) =>
      checked
        ? [...current, summary.id]
        : current.filter((id) => id !== summary.id),
    )
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

function RunIdentity(props: {
  summary: TestRunSummary
  opening: boolean
  onOpen: (runId: string) => void
}) {
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

function RunTableActions(props: {
  summary: TestRunSummary
  runsBlocked: boolean
  onRerun: (request: StudioRunRequest) => Promise<void>
}) {
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
