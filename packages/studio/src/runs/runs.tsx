import type { StudioApi } from '../app/studio-api'
import {
  type RunsFilters,
  type StudioRoute,
  studioRouteHref,
} from '../app/studio-route'
import type {
  StudioProject,
  StudioRunRequest,
  StudioRunsIndex,
} from '../server/contracts'
import {
  type LiveResultInspection,
  liveViewportFor,
} from './result/live-result-inspection'
import { ResultInspector } from './result/result-inspector'
import { RunDetail } from './run-detail'
import { RunsDashboard } from './runs-dashboard'
import { useActiveRuns } from './use-active-runs'

type RunsAreaProps = {
  api: StudioApi
  index?: StudioRunsIndex
  project: StudioProject
  route: Extract<StudioRoute, { kind: 'runs' | 'run' | 'result' | 'artifact' }>
  runsBlocked: boolean
  onCancel: (runId: string) => void
  onError: (message: string) => void
  onNavigate: (route: StudioRoute, replace?: boolean) => void
  onRerun: (request: StudioRunRequest) => Promise<void>
  reloadIndex: () => Promise<StudioRunsIndex>
}

const noActiveRuns: readonly string[] = []

export function RunsArea(props: RunsAreaProps) {
  const activeRunIds = props.index?.activeRunIds ?? noActiveRuns
  const inspections = useActiveRuns({
    api: props.api,
    runIds: activeRunIds,
    onError: props.onError,
    onFinished: () => void props.reloadIndex(),
  })

  if (props.route.kind === 'result' || props.route.kind === 'artifact') {
    return <RunInspectionRoute {...props} inspections={inspections} />
  }
  if (props.route.kind === 'run') {
    return <SingleRunRoute {...props} inspections={inspections} />
  }
  return (
    <RunsDashboard {...props} route={props.route} inspections={inspections} />
  )
}

function RunInspectionRoute(
  props: RunsAreaProps & {
    inspections: ReadonlyMap<string, LiveResultInspection>
  },
) {
  if (props.route.kind !== 'result' && props.route.kind !== 'artifact')
    return null
  const location =
    props.route.kind === 'result'
      ? props.route.location
      : props.route.location.result
  const live = props.inspections.get(location.runId)
  return (
    <ResultInspector
      api={props.api}
      artifactIndex={
        props.route.kind === 'artifact'
          ? props.route.location.artifactIndex
          : undefined
      }
      location={location}
      snapshot={live?.snapshot}
      connection={live?.connection}
      liveViewport={live ? liveViewportFor(live, location) : undefined}
      onBack={() => props.onNavigate({ kind: 'run', runId: location.runId })}
      onBackToResult={() => props.onNavigate({ kind: 'result', location })}
      onOpenArtifact={(artifactIndex) =>
        props.onNavigate({
          kind: 'artifact',
          location: { result: location, artifactIndex },
        })
      }
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

function SingleRunRoute(
  props: RunsAreaProps & {
    inspections: ReadonlyMap<string, LiveResultInspection>
  },
) {
  if (props.route.kind !== 'run') return null
  const onRerun = async (request: StudioRunRequest) => {
    await props.onRerun(request)
    props.onNavigate({ kind: 'runs', filters: {} })
  }
  return (
    <RunDetail
      api={props.api}
      runId={props.route.runId}
      live={props.inspections.get(props.route.runId)}
      runsBlocked={props.runsBlocked}
      onBack={() => props.onNavigate({ kind: 'runs', filters: {} })}
      onCancel={props.onCancel}
      onInspectResult={(location) =>
        props.onNavigate({ kind: 'result', location })
      }
      onRerun={onRerun}
    />
  )
}

export function runsHref(filters: RunsFilters = {}) {
  return studioRouteHref({ kind: 'runs', filters })
}
