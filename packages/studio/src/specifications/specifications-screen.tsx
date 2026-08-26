import type { RefObject } from 'react'
import type { StudioApi } from '../app/studio-api'
import { cn } from '../lib/utils'
import type { LiveResultInspection } from '../runs/result/live-result-inspection'
import type { ResultInspectorTab } from '../runs/result/result-inspection'
import type { MatrixCell } from '../runs/result/run-view'
import type { RunOrigin } from '../runs/run-origin'
import type {
  StudioProject,
  StudioRunRequest,
  StudioScenario,
  StudioSpecification,
} from '../server/server'
import { SpecificationHeader } from './specification-header'
import { SpecificationList } from './specification-list'
import { SpecificationResults } from './specification-results'

type SpecificationSelection = {
  currentScenarioId?: string
  focusRequest: number
  focusTargetId?: string
  headingRef: RefObject<HTMLHeadingElement | null>
  onRememberScenario: (scenario: StudioScenario) => void
  onSelect: (id: string) => void
  onSelectCreated: (
    specifications: readonly StudioSpecification[],
    uri: string,
  ) => void
  selected?: StudioSpecification
}

type SpecificationRun = {
  cells: readonly MatrixCell[]
  live?: LiveResultInspection
  onCancel: () => void
  onPauseFollowing: () => void
  onPinSelection: (cell: MatrixCell) => void
  onResumeFollowing: () => void
  onRun: (request: StudioRunRequest) => void
  onSelectInspectorTab: (tab: ResultInspectorTab) => void
  origin?: RunOrigin
  runId?: string
  running: boolean
  selectedResult?: MatrixCell
}

type SpecificationsScreenProps = {
  api: StudioApi
  authoring: boolean
  error?: string
  onAuthoringChange: (authoring: boolean) => void
  onError: (message: string | undefined) => void
  onReloadProject: () => Promise<StudioProject>
  project: StudioProject
  run: SpecificationRun
  selection: SpecificationSelection
}

export function SpecificationsScreen(props: SpecificationsScreenProps) {
  const canRunAll = props.project.readiness?.ready ?? true

  function handleRunAll() {
    props.run.onRun({})
  }

  return (
    <div
      className={cn(
        'studio-stage min-h-0 flex-1',
        props.authoring ? 'flex' : 'grid lg:grid-cols-[16rem_1fr]',
      )}
    >
      {props.authoring ? null : (
        <SpecificationList
          specifications={props.project.specifications}
          selectedId={props.selection.selected?.id}
          origin={props.run.origin}
          running={props.run.running}
          canRun={canRunAll}
          onSelect={props.selection.onSelect}
          onRunAll={handleRunAll}
        />
      )}
      <SpecificationDetail {...props} canRunAll={canRunAll} />
    </div>
  )
}

type SpecificationDetailProps = SpecificationsScreenProps & {
  canRunAll: boolean
}

function SpecificationDetail(props: SpecificationDetailProps) {
  const { selected } = props.selection
  if (!selected) {
    return (
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <p className="p-5 text-sm text-muted-foreground">
          No Specifications found. Add a feature file matching the project
          configuration.
        </p>
      </main>
    )
  }

  const specification = selected
  const canRun = specification.canRun ?? props.canRunAll
  const runReasons =
    specification.runReasons ?? props.project.readiness?.reasons

  async function handleCatalogChange() {
    await props.onReloadProject()
  }

  function handleCreated(uri: string) {
    void props.onReloadProject().then((project) => {
      props.selection.onSelectCreated(project.specifications, uri)
    })
  }

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col">
      {props.error ? (
        <p role="alert" className="px-5 pt-4 text-sm text-destructive">
          {props.error}
        </p>
      ) : null}
      <SpecificationHeader
        api={props.api}
        authoring={props.authoring}
        canRun={canRun}
        headingRef={props.selection.headingRef}
        linkTemplates={props.project.links}
        namespaces={Object.keys(props.project.links ?? {})}
        onAuthoringChange={props.onAuthoringChange}
        onCancelRun={props.run.onCancel}
        onCatalogChange={handleCatalogChange}
        onCreated={handleCreated}
        onError={props.onError}
        onRun={props.run.onRun}
        origin={props.run.origin}
        runId={props.run.runId}
        running={props.run.running}
        runReasons={runReasons}
        specification={specification}
      />
      {props.authoring ? null : (
        <SpecificationResults
          api={props.api}
          cells={props.run.cells}
          focusedScenarioId={props.selection.currentScenarioId}
          focusTargetId={props.selection.focusTargetId}
          focusRequest={props.selection.focusRequest}
          live={props.run.live}
          onPauseFollowing={props.run.onPauseFollowing}
          onPinSelection={props.run.onPinSelection}
          onRememberScenario={props.selection.onRememberScenario}
          onResumeFollowing={props.run.onResumeFollowing}
          onRun={props.run.onRun}
          onSelectInspectorTab={props.run.onSelectInspectorTab}
          origin={props.run.origin}
          profiles={props.project.profiles}
          running={props.run.running}
          selectedResult={props.run.selectedResult}
          specification={specification}
        />
      )}
    </main>
  )
}
