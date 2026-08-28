import type { StudioApi } from '../app/studio-api'
import type { LiveResultInspection } from '../runs/result/live-result-inspection'
import type { ResultInspectorTab } from '../runs/result/result-inspection'
import { ResultInspector } from '../runs/result/result-inspector'
import type { MatrixCell } from '../runs/result/run-view'
import type { RunOrigin } from '../runs/run-origin'
import type {
  StudioRunRequest,
  StudioScenario,
  StudioSpecification,
} from '../server/server'
import { AttentionList } from './attention-list'
import { ScenarioTable } from './scenario-table'

type SpecificationResultsProps = {
  api: StudioApi
  cells: readonly MatrixCell[]
  focusRequest: number
  focusedScenarioId?: string
  focusTargetId?: string
  live?: LiveResultInspection
  onPauseFollowing: () => void
  onPinSelection: (cell: MatrixCell) => void
  onResumeFollowing: () => void
  onSelectScenario: (scenario: StudioScenario) => void
  onRun: (request: StudioRunRequest) => void
  onSelectInspectorTab: (tab: ResultInspectorTab) => void
  origin?: RunOrigin
  profiles: readonly string[]
  running: boolean
  selectedResult?: MatrixCell
  specification: StudioSpecification
}

export function SpecificationResults(props: SpecificationResultsProps) {
  function handleRunScenario(scenario: StudioScenario) {
    props.onSelectScenario(scenario)
    props.onRun({
      paths: [props.specification.uri],
      scenarioId: scenario.id,
    })
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-hidden px-3 py-4 sm:px-5">
      <ScenarioTable
        profiles={props.profiles}
        scenarios={props.specification.scenarios}
        cells={props.cells}
        selected={props.selectedResult}
        focusedScenarioId={props.focusedScenarioId}
        focusTargetId={props.focusTargetId}
        focusRequest={props.focusRequest}
        origin={props.origin}
        running={props.running}
        onSelect={props.onPinSelection}
        onRun={handleRunScenario}
      />
      <AttentionList
        cells={props.cells}
        selected={props.selectedResult}
        onSelect={props.onPinSelection}
      />
      {props.live?.location && props.live.snapshot ? (
        <ResultInspector
          api={props.api}
          location={props.live.location}
          snapshot={props.live.snapshot}
          connection={props.live.connection}
          following={props.live.following}
          followedEntryId={props.live.followedEntryId}
          onResumeFollowing={props.onResumeFollowing}
          onPauseFollowing={props.onPauseFollowing}
          onTabChange={props.onSelectInspectorTab}
        />
      ) : null}
    </div>
  )
}
