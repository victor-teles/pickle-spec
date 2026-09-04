import type { RefObject } from 'react'
import type { StudioApi } from '../../lib/studio-api'
import type {
  StudioProject,
  StudioRunRequest,
  StudioScenario,
  StudioSpecification,
} from '../../server/contracts'
import type {
  ResultInspectionLocation,
  ResultInspectorTab,
} from '../runs/result/result-inspection'
import type { RunOrigin } from '../runs/run-origin'
import { SpecificationHeader } from './specification-header'
import { SpecificationsWorkbench } from './specifications-workbench'
import type { SpecificationsWorkbenchModel } from './specifications-workbench-model'
import type { MissingSpecificationSelection } from './use-specification-selection'

type SpecificationSelection = {
  currentScenario?: StudioScenario
  headingRef: RefObject<HTMLHeadingElement | null>
  missing?: MissingSpecificationSelection
  onSelectScenario: (
    specification: StudioSpecification,
    scenario: StudioScenario,
  ) => void
  onSelect: (id: string) => void
  onSelectCreated: (
    specifications: readonly StudioSpecification[],
    uri: string,
  ) => void
  selected?: StudioSpecification
}

type SpecificationRun = {
  onCancel: () => void
  onDismissFinishedRun: () => void
  onInspectLocation: (location: ResultInspectionLocation) => void
  onInspectTimelineEntry: (entryId: string) => void
  onPauseFollowing: () => void
  onResumeFollowing: () => void
  onRun: (request: StudioRunRequest) => void
  onSelectInspectorTab: (tab: ResultInspectorTab) => void
  origin?: RunOrigin
  runId?: string
  running: boolean
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
  workbench: SpecificationsWorkbenchModel
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

  return (
    <div className="studio-stage flex min-h-0 flex-1 overflow-hidden">
      <SpecificationsWorkbench
        alertMessage={
          props.error ?? missingSpecificationMessage(props.selection.missing)
        }
        canRunAll={canRunAll}
        model={props.workbench}
        onCancel={props.run.onCancel}
        onDismissFinishedRun={props.run.onDismissFinishedRun}
        onInspectLocation={props.run.onInspectLocation}
        onInspectTimelineEntry={props.run.onInspectTimelineEntry}
        onPauseFollowing={props.run.onPauseFollowing}
        onEditSpecification={() => props.onAuthoringChange(true)}
        onResumeFollowing={props.run.onResumeFollowing}
        onRun={props.run.onRun}
        onSelectInspectorTab={props.run.onSelectInspectorTab}
        onSelectScenario={props.selection.onSelectScenario}
        onSelectSpecification={props.selection.onSelect}
        selectedScenario={props.selection.currentScenario}
        selectedSpecificationId={props.selection.selected?.id}
        selectedSpecification={props.selection.selected}
        running={props.run.running}
      />
    </div>
  )
}

type SpecificationDetailProps = SpecificationsScreenProps & {
  canRunAll: boolean
}

function MissingSpecification(props: {
  missing: NonNullable<SpecificationDetailProps['selection']['missing']>
}) {
  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden p-5">
      <p role="alert" className="text-sm text-destructive">
        {missingSpecificationMessage(props.missing)}
      </p>
    </main>
  )
}

function missingSpecificationMessage(
  missing: MissingSpecificationSelection | undefined,
): string | undefined {
  if (!missing) return undefined
  const label =
    missing.kind === 'scenario'
      ? `Scenario ${missing.scenarioId}`
      : `Specification ${missing.specificationId}`
  return `${label} was not found in this project.`
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
