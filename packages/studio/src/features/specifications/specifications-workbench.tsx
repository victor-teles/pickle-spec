/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 · macrostructure: Workbench · theme: Pickle Spec Studio */
import {
  PanelBottomCloseIcon,
  PanelLeftIcon,
  PanelRightIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { ButtonGroup } from '../../components/ui/button-group'
import { Spinner } from '../../components/ui/spinner'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip'
import type {
  StudioRunRequest,
  StudioScenario,
  StudioSpecification,
} from '../../server/contracts'
import { RunReportMenu } from '../history/run-report-menu'
import type {
  ResultInspectionLocation,
  ResultInspectorTab,
} from '../runs/result/result-inspection'
import {
  EvidenceDock,
  WorkbenchDetails,
  WorkbenchPreview,
} from './specifications-workbench-focus'
import {
  useWorkbenchOrientation,
  WorkbenchLayout,
  type WorkbenchOrientation,
  type WorkbenchPanelVisibility,
} from './specifications-workbench-layout'
import type { SpecificationsWorkbenchModel } from './specifications-workbench-model'
import { WorkbenchRail } from './specifications-workbench-rail'

type SpecificationsWorkbenchProps = {
  alertMessage?: string
  canRunAll: boolean
  model: SpecificationsWorkbenchModel
  onCancel: () => void
  onDismissFinishedRun: () => void
  onInspectLocation: (location: ResultInspectionLocation) => void
  onInspectTimelineEntry: (entryId: string) => void
  onPauseFollowing: () => void
  onEditSpecification: () => void
  onResumeFollowing: () => void
  onRun: (request: StudioRunRequest) => void
  onSelectInspectorTab: (tab: ResultInspectorTab) => void
  onSelectScenario: (
    specification: StudioSpecification,
    scenario: StudioScenario,
  ) => void
  onSelectSpecification: (id: string) => void
  selectedScenario?: StudioScenario
  selectedSpecificationId?: string
  selectedSpecification?: StudioSpecification
  running: boolean
}

export function SpecificationsWorkbench(props: SpecificationsWorkbenchProps) {
  const orientation = useWorkbenchOrientation()
  const [visibility, setVisibility] = useState<WorkbenchPanelVisibility>({
    bottom: true,
    left: true,
    right: false,
  })

  useEffect(() => {
    setVisibility(
      orientation === 'horizontal'
        ? { bottom: true, left: true, right: false }
        : { bottom: false, left: false, right: false },
    )
  }, [orientation])

  return (
    <main className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
      <WorkbenchActionBar
        {...props}
        visibility={visibility}
        onVisibilityChange={setVisibility}
      />
      {props.alertMessage ? (
        <p
          role="alert"
          className="shrink-0 border-b border-border px-4 py-2 text-sm text-destructive"
        >
          {props.alertMessage}
        </p>
      ) : null}
      <WorkbenchPanels
        {...props}
        orientation={orientation}
        visibility={visibility}
      />
    </main>
  )
}

type WorkbenchPanelsProps = SpecificationsWorkbenchProps & {
  orientation: WorkbenchOrientation
  visibility: WorkbenchPanelVisibility
}

function WorkbenchPanels(props: WorkbenchPanelsProps) {
  return (
    <WorkbenchLayout
      orientation={props.orientation}
      visibility={props.visibility}
      left={
        <WorkbenchRail
          canRun={props.canRunAll}
          model={props.model}
          onCancel={props.onCancel}
          onInspectLocation={props.onInspectLocation}
          onRun={props.onRun}
          onSelectScenario={props.onSelectScenario}
          onSelectSpecification={props.onSelectSpecification}
          running={props.running}
          selectedScenarioId={props.selectedScenario?.id}
          selectedSpecificationId={props.selectedSpecificationId}
        />
      }
      center={
        <WorkbenchPreview
          model={props.model}
          selectedScenario={props.selectedScenario}
        />
      }
      bottom={
        <EvidenceDock
          model={props.model}
          onInspectTimelineEntry={props.onInspectTimelineEntry}
          onPauseFollowing={props.onPauseFollowing}
          onResumeFollowing={props.onResumeFollowing}
          onSelectInspectorTab={props.onSelectInspectorTab}
        />
      }
      right={
        <WorkbenchDetails
          canRun={props.canRunAll}
          model={props.model}
          onEditSpecification={props.onEditSpecification}
          onRun={props.onRun}
          running={props.running}
          selectedScenario={props.selectedScenario}
          selectedSpecification={props.selectedSpecification}
        />
      }
    />
  )
}

type WorkbenchActionBarProps = SpecificationsWorkbenchProps & {
  onVisibilityChange: (visibility: WorkbenchPanelVisibility) => void
  visibility: WorkbenchPanelVisibility
}

function WorkbenchActionBar(props: WorkbenchActionBarProps) {
  const running =
    props.model.kind === 'batch' && props.model.phase === 'running'
  const canRerunFailures =
    props.model.kind === 'batch' &&
    !running &&
    props.model.totals.failed + props.model.totals.infrastructureError > 0

  function handleRerunFailures() {
    if (props.model.kind !== 'batch') return
    props.onRun({ rerunId: props.model.runId, failures: true })
  }

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        {props.model.kind === 'batch' &&
        props.model.report.state === 'available' ? (
          <RunReportMenu runId={props.model.report.runId} />
        ) : null}
        {props.model.kind === 'batch' &&
        props.model.report.state === 'preparing' ? (
          <Button type="button" variant="outline" disabled>
            <Spinner />
            Preparing report
          </Button>
        ) : null}
        {canRerunFailures ? (
          <Button type="button" variant="outline" onClick={handleRerunFailures}>
            Rerun failed
          </Button>
        ) : null}
        {props.model.kind === 'batch' && !running ? (
          <Button
            type="button"
            variant="ghost"
            onClick={props.onDismissFinishedRun}
          >
            Back to Specifications
          </Button>
        ) : null}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <p className="hidden text-xs text-muted-foreground lg:block">
          {workbenchSummary(props.model)}
        </p>
        <WorkbenchPanelToggles
          visibility={props.visibility}
          onVisibilityChange={props.onVisibilityChange}
        />
      </div>
    </header>
  )
}

function WorkbenchPanelToggles(props: {
  onVisibilityChange: (visibility: WorkbenchPanelVisibility) => void
  visibility: WorkbenchPanelVisibility
}) {
  function toggle(panel: keyof WorkbenchPanelVisibility) {
    props.onVisibilityChange({
      ...props.visibility,
      [panel]: !props.visibility[panel],
    })
  }

  return (
    <ButtonGroup
      aria-label="Workbench panels"
      className="gap-0.5"
      orientation={null}
    >
      <PanelToggle
        icon={PanelLeftIcon}
        label="Left sidebar"
        visible={props.visibility.left}
        onToggle={() => toggle('left')}
      />
      <PanelToggle
        icon={PanelBottomCloseIcon}
        label="Bottom panel"
        visible={props.visibility.bottom}
        onToggle={() => toggle('bottom')}
      />
      <PanelToggle
        icon={PanelRightIcon}
        label="Right sidebar"
        visible={props.visibility.right}
        onToggle={() => toggle('right')}
      />
    </ButtonGroup>
  )
}

type PanelToggleProps = {
  icon: typeof PanelLeftIcon
  label: string
  onToggle: () => void
  visible: boolean
}

function PanelToggle(props: PanelToggleProps) {
  const action = `${props.visible ? 'Hide' : 'Show'} ${props.label}`
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="aria-pressed:border-transparent aria-pressed:bg-secondary aria-pressed:text-foreground aria-pressed:focus-visible:border-current/40"
            aria-label={action}
            aria-pressed={props.visible}
            onClick={props.onToggle}
          />
        }
      >
        <HugeiconsIcon icon={props.icon} strokeWidth={1.5} aria-hidden />
      </TooltipTrigger>
      <TooltipContent>{action}</TooltipContent>
    </Tooltip>
  )
}

function workbenchSummary(model: SpecificationsWorkbenchModel): string {
  if (model.kind === 'batch') {
    return `${countLabel(model.totals.scheduled, 'Scenario')} · ${model.environmentLabel}`
  }
  const scenarioCount = model.specifications.reduce(
    (total, specification) => total + specification.scenarios.length,
    0,
  )
  return `${countLabel(model.specifications.length, 'Specification')} · ${countLabel(scenarioCount, 'Scenario')}`
}

function countLabel(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}
