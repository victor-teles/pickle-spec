import type { StudioApi } from '../../app/studio-api'
import type { StudioRoute } from '../../app/studio-route'
import { LedgerLoadingSkeleton } from '../../components/loading-skeletons'
import type {
  StudioProject,
  StudioRunRequest,
  StudioRunsIndex,
} from '../../server/server'
import type { LiveResultInspection } from '../result/live-result-inspection'
import { RunComparison } from '../run-comparison'
import { RunStorage } from '../run-storage'
import { useRunsDashboard } from '../hooks/use-runs-dashboard'
import { ActiveRuns } from './active-runs'
import { RunHistory } from './run-history'
import { RunsHeader } from './runs-header'

type RunsDashboardProps = {
  api: StudioApi
  index?: StudioRunsIndex
  inspections: ReadonlyMap<string, LiveResultInspection>
  project: StudioProject
  route: Extract<StudioRoute, { kind: 'runs' }>
  runsBlocked: boolean
  onCancel: (runId: string) => void
  onNavigate: (route: StudioRoute, replace?: boolean) => void
  onRerun: (request: StudioRunRequest) => Promise<void>
  reloadIndex: () => Promise<StudioRunsIndex>
}

export function RunsDashboard(props: RunsDashboardProps) {
  const dashboard = useRunsDashboard(props)
  if (!props.index) return <RunsLoading />
  return (
    <section
      aria-labelledby="runs-title"
      className="min-h-0 flex-1 space-y-5 overflow-auto px-3 py-4 sm:px-5"
    >
      <RunsHeader
        selectedRunCount={dashboard.selectedRunIds.length}
        onCompareSelected={dashboard.compareSelected}
        onImportArchive={dashboard.importArchive}
      />
      <ActiveRuns
        runIds={dashboard.visibleActiveRunIds}
        inspections={props.inspections}
        onCancel={props.onCancel}
        onOpen={(runId) => props.onNavigate({ kind: 'run', runId })}
      />
      <RunHistory
        {...dashboard}
        index={props.index}
        runsBlocked={props.runsBlocked}
        onRerun={props.onRerun}
      />
      {dashboard.comparison ? (
        <RunComparison comparison={dashboard.comparison} />
      ) : null}
      <RunStorage
        index={props.index}
        onDeleteEligible={dashboard.deleteEligible}
      />
    </section>
  )
}

function RunsLoading() {
  return (
    <section className="min-h-0 flex-1 overflow-auto p-4">
      <LedgerLoadingSkeleton label="Loading Runs" />
    </section>
  )
}
