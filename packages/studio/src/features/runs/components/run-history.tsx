import type {
  StudioRunRequest,
  StudioRunsIndex,
} from '../../../server/contracts'
import type { RunsDashboardModel } from '../hooks/use-runs-dashboard'
import { RunFilters } from './run-filters'
import { RunTable } from './run-table'

type RunHistoryProps = Pick<
  RunsDashboardModel,
  | 'clearFilters'
  | 'error'
  | 'filterOptions'
  | 'filters'
  | 'items'
  | 'openingRunId'
  | 'openRunAttempt'
  | 'pinnedRunIds'
  | 'selectedRunIds'
  | 'setFilters'
  | 'setPinned'
  | 'setSelectedRunIds'
  | 'specificationNames'
  | 'visibleActiveRunIds'
> & {
  index: StudioRunsIndex
  runsBlocked: boolean
  onRerun: (request: StudioRunRequest) => Promise<void>
}

export function RunHistory(props: RunHistoryProps) {
  return (
    <section className="space-y-3" aria-labelledby="run-history-title">
      <RunFilters
        filters={props.filters}
        options={props.filterOptions}
        onClearFilters={props.clearFilters}
        onUpdateFilters={props.setFilters}
      />
      {props.error ? (
        <p role="alert" className="text-sm text-destructive">
          {props.error}
        </p>
      ) : null}
      <h2 id="run-history-title" className="sr-only">
        Test run history
      </h2>
      {props.items.length === 0 && props.visibleActiveRunIds.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
          {props.index.runs.length === 0
            ? 'No Test runs have been recorded yet.'
            : 'No Test runs match these filters.'}
        </div>
      ) : (
        <RunTable
          items={props.items}
          selectedRunIds={props.selectedRunIds}
          pinnedRunIds={props.pinnedRunIds}
          specificationNames={props.specificationNames}
          runsBlocked={props.runsBlocked}
          openingRunId={props.openingRunId}
          onOpen={props.openRunAttempt}
          onPin={props.setPinned}
          onRerun={props.onRerun}
          onSelect={props.setSelectedRunIds}
        />
      )}
    </section>
  )
}
