/* Hallmark · pre-emit critique: P5 H5 E4 S5 R5 V5 · macrostructure: Workbench · theme: Pickle Spec Studio */
import {
  PanelBottomCloseIcon,
  PanelLeftIcon,
  PanelRightIcon,
  PlayCircleIcon,
} from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import { ResultMark } from '../../components/ui/result-mark'
import { Spinner } from '../../components/ui/spinner'
import { cn } from '../../lib/utils'
import type {
  StudioRunRequest,
  StudioScenario,
  StudioSpecification,
} from '../../server/contracts'
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
import type {
  BatchWorkbenchModel,
  SpecificationsWorkbenchModel,
  WorkbenchTotals,
} from './specifications-workbench-model'
import { WorkbenchRail } from './specifications-workbench-rail'

type SpecificationsWorkbenchProps = {
  alertMessage?: string
  canRunAll: boolean
  model: SpecificationsWorkbenchModel
  onCancel: () => void
  onDismissFinishedRun: () => void
  onInspectLocation: (location: ResultInspectionLocation) => void
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
    right: true,
  })

  useEffect(() => {
    setVisibility(
      orientation === 'horizontal'
        ? { bottom: true, left: true, right: true }
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
      {props.model.kind === 'batch' ? (
        <RunSummary model={props.model} onCancel={props.onCancel} />
      ) : null}
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

  function handleRunAll() {
    props.onRun({})
  }

  function handleRerunFailures() {
    if (props.model.kind !== 'batch') return
    props.onRun({ rerunId: props.model.runId, failures: true })
  }

  return (
    <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={!props.canRunAll || props.running}
          onClick={handleRunAll}
        >
          <HugeiconsIcon icon={PlayCircleIcon} strokeWidth={2} aria-hidden />
          {props.model.kind === 'batch'
            ? `Run all ${props.model.totals.scheduled}`
            : 'Run all Specifications'}
        </Button>
        {props.model.kind === 'batch' ? (
          <Button
            type="button"
            variant="outline"
            disabled={!canRerunFailures}
            onClick={handleRerunFailures}
          >
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
      <WorkbenchPanelToggles
        visibility={props.visibility}
        onVisibilityChange={props.onVisibilityChange}
      />
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
    <div className="ml-auto flex items-center gap-1">
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
    </div>
  )
}

type PanelToggleProps = {
  icon: typeof PanelLeftIcon
  label: string
  onToggle: () => void
  visible: boolean
}

function PanelToggle(props: PanelToggleProps) {
  return (
    <Button
      type="button"
      size="icon"
      variant="ghost"
      aria-label={`${props.visible ? 'Hide' : 'Show'} ${props.label}`}
      aria-pressed={props.visible}
      title={`${props.visible ? 'Hide' : 'Show'} ${props.label}`}
      onClick={props.onToggle}
    >
      <HugeiconsIcon icon={props.icon} strokeWidth={2} aria-hidden />
    </Button>
  )
}

function RunSummary(props: {
  model: BatchWorkbenchModel
  onCancel: () => void
}) {
  return (
    <footer className="flex shrink-0 flex-nowrap items-center gap-x-6 overflow-x-auto border-t border-border px-3 py-2 text-xs whitespace-nowrap sm:px-4">
      <div className="min-w-32">
        <p className="font-medium">Run {props.model.runId}</p>
        <p className="text-muted-foreground">
          Started {formatStartedAt(props.model.startedAt)}
        </p>
      </div>
      <SummaryValue label="Environment" value={props.model.environmentLabel} />
      <SummaryValue label="Total" value={props.model.totals.scheduled} />
      <SummaryState
        label="Running"
        state="running"
        value={props.model.totals.running}
      />
      <SummaryValue label="Queued" value={props.model.totals.queued} />
      <SummaryState
        label="Passed"
        state="passed"
        value={props.model.totals.passed}
      />
      <SummaryState
        label="Failed"
        state="failed"
        value={failedTotal(props.model.totals)}
      />
      {props.model.phase === 'running' ? (
        <Button type="button" variant="outline" onClick={props.onCancel}>
          Cancel run
        </Button>
      ) : null}
      {props.model.totals.running + props.model.totals.queued > 1 ? (
        <p className="text-muted-foreground">Run continues for other tests</p>
      ) : null}
    </footer>
  )
}

function SummaryValue(props: { label: string; value: number | string }) {
  return (
    <div>
      <p className="text-muted-foreground">{props.label}</p>
      <p className="font-medium">{props.value}</p>
    </div>
  )
}

function SummaryState(props: {
  label: string
  state: 'running' | 'passed' | 'failed'
  value: number
}) {
  return (
    <div>
      <p className="text-muted-foreground">{props.label}</p>
      <p
        className={cn(
          'flex items-center gap-1.5 font-medium',
          stateLabelClass(props.state),
        )}
      >
        {props.state === 'running' ? (
          <Spinner className="text-primary" />
        ) : (
          <ResultMark state={props.state} />
        )}
        {props.value}
      </p>
    </div>
  )
}

function failedTotal(totals: WorkbenchTotals): number {
  return totals.failed + totals.infrastructureError
}

function formatStartedAt(startedAt: string | undefined): string {
  return startedAt ? new Date(startedAt).toLocaleTimeString() : 'Not recorded'
}

function stateLabelClass(state: string): string {
  if (state === 'passed') return 'text-passed'
  if (state === 'failed') return 'text-destructive'
  return 'text-muted-foreground'
}
