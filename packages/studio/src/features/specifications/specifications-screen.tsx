import { type RefObject, useState } from 'react'
import type { StudioApi } from '../../lib/studio-api'
import type {
  StudioProject,
  StudioRunRequest,
  StudioScenario,
  StudioSpecification,
} from '../../server/contracts'
import type { LiveResultInspection } from '../runs/result/live-result-inspection'
import type { ResultInspectorTab } from '../runs/result/result-inspection'
import type { MatrixCell } from '../runs/result/run-view'
import type { RunOrigin } from '../runs/run-origin'
import {
  SpecificationHeader,
  SpecificationViewActions,
} from './specification-header'
import {
  filterSpecificationIndex,
  type SpecificationIndexScope,
} from './specification-index'
import { SpecificationList } from './specification-list'
import { SpecificationResults } from './specification-results'
import type { MissingSpecificationSelection } from './use-specification-selection'

type SpecificationSelection = {
  currentScenarioId?: string
  focusRequest: number
  focusTargetId?: string
  headingRef: RefObject<HTMLHeadingElement | null>
  missing?: MissingSpecificationSelection
  onSelectScenario: (scenario: StudioScenario) => void
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

  if (props.authoring) {
    return (
      <div className="studio-stage flex min-h-0 flex-1 overflow-hidden">
        <SpecificationDetail {...props} canRunAll={canRunAll} />
      </div>
    )
  }

  if (props.selection.missing) {
    return (
      <div className="studio-stage flex min-h-0 flex-1 overflow-hidden">
        <MissingSpecification missing={props.selection.missing} />
      </div>
    )
  }

  return (
    <div className="studio-stage flex min-h-0 flex-1 overflow-hidden">
      <SpecificationIndexScreen {...props} canRunAll={canRunAll} />
    </div>
  )
}

function SpecificationIndexScreen(props: SpecificationDetailProps) {
  const [scope, setScope] = useState<SpecificationIndexScope>('all')
  const [query, setQuery] = useState('')
  const entries = filterSpecificationIndex(
    props.project.specifications,
    scope,
    query,
  )
  const selected = props.selection.selected
  const selectedEntry = selected
    ? entries.find((entry) => entry.specification.id === selected.id)
    : undefined

  function handleRunAll() {
    props.run.onRun({})
  }

  return (
    <SpecificationList
      canRun={props.canRunAll}
      entries={entries}
      onQueryChange={setQuery}
      onRunAll={handleRunAll}
      onScopeChange={setScope}
      onSelect={props.selection.onSelect}
      origin={props.run.origin}
      query={query}
      running={props.run.running}
      scope={scope}
      selectedActions={
        selected ? (
          <SpecificationIndexActions {...props} specification={selected} />
        ) : null
      }
      selectedDetail={
        selected && selectedEntry ? (
          <SpecificationIndexDetail
            {...props}
            scenarios={selectedEntry.scenarios}
            specification={selected}
          />
        ) : null
      }
      selectedHeadingRef={props.selection.headingRef}
      selectedId={selected?.id}
      specifications={props.project.specifications}
    />
  )
}

type SpecificationDetailProps = SpecificationsScreenProps & {
  canRunAll: boolean
}

function MissingSpecification(props: {
  missing: NonNullable<SpecificationDetailProps['selection']['missing']>
}) {
  const label =
    props.missing.kind === 'scenario'
      ? `Scenario ${props.missing.scenarioId}`
      : `Specification ${props.missing.specificationId}`
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-5">
      <p role="alert" className="text-sm text-destructive">
        {label} was not found in this project.
      </p>
    </main>
  )
}

function EmptySpecificationSelection() {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <p className="p-5 text-sm text-muted-foreground">
        No Specifications found. Add a feature file matching the project
        configuration.
      </p>
    </main>
  )
}

function selectCreatedSpecification(
  props: SpecificationsScreenProps,
  uri: string,
): void {
  void props.onReloadProject().then((project) => {
    props.onAuthoringChange(false)
    props.selection.onSelectCreated(project.specifications, uri)
  })
}

async function reloadSpecificationCatalog(
  props: SpecificationsScreenProps,
): Promise<void> {
  await props.onReloadProject()
}

function specificationRunReasons(
  specification: StudioSpecification,
  props: SpecificationsScreenProps,
) {
  return specification.runReasons ?? props.project.readiness?.reasons
}

type SelectedSpecificationProps = SpecificationDetailProps & {
  specification: StudioSpecification
}

function SpecificationIndexActions(props: SelectedSpecificationProps) {
  const canRun = props.specification.canRun ?? props.canRunAll

  return (
    <SpecificationViewActions
      api={props.api}
      authoring={false}
      canRun={canRun}
      headingRef={props.selection.headingRef}
      linkTemplates={props.project.links}
      namespaces={Object.keys(props.project.links ?? {})}
      onAuthoringChange={props.onAuthoringChange}
      onCancelRun={props.run.onCancel}
      onCatalogChange={() => reloadSpecificationCatalog(props)}
      onCreated={(uri) => selectCreatedSpecification(props, uri)}
      onError={props.onError}
      onRun={props.run.onRun}
      origin={props.run.origin}
      runId={props.run.runId}
      running={props.run.running}
      runReasons={specificationRunReasons(props.specification, props)}
      specification={props.specification}
    />
  )
}

type SpecificationIndexDetailProps = SelectedSpecificationProps & {
  scenarios: readonly StudioScenario[]
}

function SpecificationIndexDetail(props: SpecificationIndexDetailProps) {
  const runReasons = specificationRunReasons(props.specification, props)

  return (
    <>
      {props.error ? (
        <p
          role="alert"
          className="border-t border-border px-4 pt-3 text-sm text-destructive"
        >
          {props.error}
        </p>
      ) : null}
      {props.specification.canRun === false && runReasons?.length ? (
        <p
          role="status"
          className="border-t border-border px-4 pt-3 text-sm text-muted-foreground"
        >
          {runReasons.join(' ')}
        </p>
      ) : null}
      <SpecificationResults
        api={props.api}
        cells={props.run.cells}
        focusedScenarioId={props.selection.currentScenarioId}
        focusTargetId={props.selection.focusTargetId}
        focusRequest={props.selection.focusRequest}
        live={props.run.live}
        onPauseFollowing={props.run.onPauseFollowing}
        onPinSelection={props.run.onPinSelection}
        onSelectScenario={props.selection.onSelectScenario}
        onResumeFollowing={props.run.onResumeFollowing}
        onRun={props.run.onRun}
        onSelectInspectorTab={props.run.onSelectInspectorTab}
        origin={props.run.origin}
        profiles={props.project.profiles}
        running={props.run.running}
        scenarios={props.scenarios}
        selectedResult={props.run.selectedResult}
        specification={props.specification}
      />
    </>
  )
}

function SpecificationDetail(props: SpecificationDetailProps) {
  const { selected } = props.selection
  if (props.selection.missing) {
    return <MissingSpecification missing={props.selection.missing} />
  }
  if (!selected) return <EmptySpecificationSelection />

  const specification = selected
  const canRun = specification.canRun ?? props.canRunAll
  const runReasons = specificationRunReasons(specification, props)

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
        onCatalogChange={() => reloadSpecificationCatalog(props)}
        onCreated={(uri) => selectCreatedSpecification(props, uri)}
        onError={props.onError}
        onRun={props.run.onRun}
        origin={props.run.origin}
        runId={props.run.runId}
        running={props.run.running}
        runReasons={runReasons}
        specification={specification}
      />
    </main>
  )
}
