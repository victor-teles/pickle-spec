import { BrowserIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '../../components/ui/accordion'
import { Badge } from '../../components/ui/badge'
import { Button, ButtonLink } from '../../components/ui/button'
import { ResultMark } from '../../components/ui/result-mark'
import { Spinner } from '../../components/ui/spinner'
import { Switch } from '../../components/ui/switch'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../components/ui/table'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../components/ui/tabs'
import type {
  StudioRunRequest,
  StudioScenario,
  StudioSpecification,
} from '../../server/contracts'
import type { ResultInspectorTab } from '../runs/result/result-inspection'
import { ResultViewportSurface } from '../runs/result/result-inspector'
import { resultBadgeVariant } from '../runs/result/result-presentation'
import { durationLabel } from '../runs/run-format'
import { studioRouteHref } from '../studio/studio-route'
import type {
  BatchWorkbenchModel,
  SpecificationsWorkbenchModel,
} from './specifications-workbench-model'

export type WorkbenchEvidenceProps = {
  model: SpecificationsWorkbenchModel
  onPauseFollowing: () => void
  onResumeFollowing: () => void
  onSelectInspectorTab: (tab: ResultInspectorTab) => void
}

export function WorkbenchPreview(props: {
  model: SpecificationsWorkbenchModel
  selectedScenario?: StudioScenario
}) {
  const focus = props.model.kind === 'batch' ? props.model.focus : undefined
  const scenarioName =
    focus?.inspected.result.scenario.name ??
    props.selectedScenario?.name ??
    'Scenario'
  return (
    <section
      aria-labelledby="workbench-preview-title"
      className="flex min-h-0 min-w-0 flex-col overflow-hidden"
    >
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 id="workbench-preview-title" className="text-sm font-medium">
          Preview
        </h2>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <HugeiconsIcon icon={BrowserIcon} strokeWidth={2} aria-hidden />
          <span>
            {props.model.kind === 'batch'
              ? viewportLabel(props.model)
              : 'Browser preview'}
          </span>
        </div>
      </header>
      {props.model.kind === 'batch' && props.model.viewport ? (
        <div className="min-h-72 flex-1 overflow-hidden bg-muted/40 p-1 xl:min-h-0">
          <ResultViewportSurface
            liveViewport={props.model.viewport}
            scenarioName={scenarioName}
            size="workbench"
          />
        </div>
      ) : (
        <div className="flex min-h-72 flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground xl:min-h-0">
          {previewEmptyMessage(props.model)}
        </div>
      )}
    </section>
  )
}

function previewEmptyMessage(model: SpecificationsWorkbenchModel): string {
  if (model.kind === 'browse') {
    return 'Run a Scenario to open its live browser preview here.'
  }
  return model.phase === 'running'
    ? 'The browser preview will appear when the focused Scenario opens a page.'
    : 'No live browser frame is available for this completed attempt.'
}

export function EvidenceDock(props: WorkbenchEvidenceProps) {
  const focus = props.model.kind === 'batch' ? props.model.focus : undefined
  const tab = evidenceTab(focus?.activeTab)
  return (
    <section className="min-h-0 min-w-0 overflow-hidden border-t border-border">
      <Tabs
        value={tab}
        onValueChange={(value) =>
          props.onSelectInspectorTab(value as ResultInspectorTab)
        }
        className="h-full min-h-0 gap-0 overflow-hidden"
      >
        <header className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-2">
          <TabsList variant="line" aria-label="Focused Scenario evidence">
            <TabsTrigger value="timeline">Timeline</TabsTrigger>
            <TabsTrigger value="artifacts">
              Artifacts {focus?.artifacts.length ?? 0}
            </TabsTrigger>
            <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
          </TabsList>
          <label
            htmlFor="workbench-follow"
            className="ml-auto flex items-center gap-2 text-xs text-muted-foreground"
          >
            Follow
            <Switch
              id="workbench-follow"
              size="sm"
              checked={
                props.model.kind === 'batch' ? props.model.following : false
              }
              disabled={props.model.kind === 'browse'}
              onCheckedChange={(checked) =>
                checked ? props.onResumeFollowing() : props.onPauseFollowing()
              }
            />
          </label>
          {props.model.kind === 'batch' && props.model.phase === 'running' ? (
            <Badge variant="running">Live</Badge>
          ) : null}
        </header>
        <TabsContent value="timeline" className="min-h-0 overflow-auto">
          <CompactTimeline model={props.model} />
        </TabsContent>
        <TabsContent value="artifacts" className="min-h-0 overflow-auto p-3">
          <CompactArtifacts model={props.model} />
        </TabsContent>
        <TabsContent value="diagnostics" className="min-h-0 overflow-auto p-3">
          <CompactDiagnostics model={props.model} />
        </TabsContent>
      </Tabs>
    </section>
  )
}

function CompactTimeline(props: { model: SpecificationsWorkbenchModel }) {
  if (props.model.kind === 'browse') return <EmptyTimeline />
  const focus = props.model.focus
  if (!focus) return <EmptyFocus />
  const steps = focus.inspected.attempt.steps
  if (steps.length === 0) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No steps have been recorded for this Scenario attempt yet.
      </p>
    )
  }
  return (
    <Table aria-label="Focused Scenario timeline">
      <TableHeader>
        <TableRow>
          <TableHead className="w-14">Step</TableHead>
          <TableHead>Action</TableHead>
          <TableHead className="w-24">Time</TableHead>
          <TableHead className="w-28">Status</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {steps.map((step, index) => {
          const running = focus.inProgress && index === steps.length - 1
          const state = running ? 'running' : step.state
          return (
            <TableRow
              key={step.index}
              data-state={running ? 'selected' : undefined}
            >
              <TableCell>{step.index + 1}</TableCell>
              <TableCell className="max-w-0 truncate">
                {step.step.keyword.trim()} {step.step.text}
              </TableCell>
              <TableCell className="font-mono">
                {durationLabel(step.durationMs)}
              </TableCell>
              <TableCell>
                <span className="flex items-center gap-1.5">
                  {state === 'running' ? (
                    <Spinner className="text-primary" />
                  ) : (
                    <ResultMark state={state} />
                  )}
                  <span className={stateLabelClass(state)}>{state}</span>
                </span>
              </TableCell>
            </TableRow>
          )
        })}
      </TableBody>
    </Table>
  )
}

function CompactArtifacts(props: { model: SpecificationsWorkbenchModel }) {
  if (props.model.kind === 'browse') return <EmptyArtifacts />
  const artifacts = props.model.focus?.artifacts ?? []
  if (artifacts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No artifacts retained.</p>
    )
  }
  return (
    <ul className="space-y-2">
      {artifacts.map((evidence) => (
        <li
          key={evidence.index}
          className="flex items-center justify-between gap-3 border-b border-border pb-2 text-sm"
        >
          <span className="min-w-0 truncate">{evidence.stepText}</span>
          <Badge>{evidence.artifact.kind}</Badge>
        </li>
      ))}
    </ul>
  )
}

function CompactDiagnostics(props: { model: SpecificationsWorkbenchModel }) {
  if (props.model.kind === 'browse') return <EmptyDiagnostics />
  const diagnostics = props.model.focus?.diagnostics ?? []
  if (diagnostics.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No diagnostics retained.</p>
    )
  }
  return (
    <ol className="space-y-2">
      {diagnostics.map((diagnostic) => (
        <li key={diagnostic.id} className="border-b border-border pb-2 text-xs">
          <p className="font-medium">{diagnostic.source}</p>
          <p className="break-words text-muted-foreground">
            {diagnostic.message}
          </p>
        </li>
      ))}
    </ol>
  )
}

export type WorkbenchDetailsProps = {
  canRun: boolean
  model: SpecificationsWorkbenchModel
  onEditSpecification: () => void
  onRun: (request: StudioRunRequest) => void
  running: boolean
  selectedScenario?: StudioScenario
  selectedSpecification?: StudioSpecification
}

export function WorkbenchDetails(props: WorkbenchDetailsProps) {
  if (props.model.kind === 'browse') return <BrowseDetails {...props} />

  const focus = props.model.focus
  return (
    <aside className="min-h-0 min-w-0 border-t border-border xl:overflow-auto xl:border-t-0 xl:border-l">
      {focus ? (
        <>
          <header className="space-y-1 border-b border-border p-4">
            <h2 className="text-base font-semibold">
              {focus.inspected.result.specification.name}
            </h2>
            <p className="text-sm text-muted-foreground">
              {focus.inspected.result.scenario.name}
            </p>
          </header>
          <div className="space-y-5 p-4">
            <FocusedMetadata model={props.model} />
            <CurrentStep model={props.model} />
            <EvidenceCounts model={props.model} />
          </div>
        </>
      ) : (
        <EmptyFocus />
      )}
    </aside>
  )
}

function BrowseDetails(props: WorkbenchDetailsProps) {
  const specification = props.selectedSpecification
  if (!specification) return <EmptyFocus />

  const handleRunSpecification = () => {
    props.onRun({ paths: [specification.uri] })
  }

  const handleRunScenario = () => {
    if (!props.selectedScenario) return
    props.onRun({
      paths: [specification.uri],
      scenarioId: props.selectedScenario.id,
    })
  }

  return (
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-auto">
      <header className="space-y-1 border-b border-border p-4">
        <h2 className="text-base font-semibold">{specification.name}</h2>
        <p className="truncate font-mono text-xs text-muted-foreground">
          {specification.uri}
        </p>
      </header>
      <div className="space-y-4 p-4">
        {props.selectedScenario ? (
          <section
            aria-labelledby="selected-scenario-title"
            className="space-y-2"
          >
            <p className="text-xs text-muted-foreground">Selected Scenario</p>
            <h3 id="selected-scenario-title" className="text-sm font-medium">
              {props.selectedScenario.name}
            </h3>
            <Button
              type="button"
              className="w-full"
              disabled={
                props.running ||
                !props.canRun ||
                specification.canRun === false ||
                props.selectedScenario.canRun === false
              }
              onClick={handleRunScenario}
            >
              Run Scenario
            </Button>
          </section>
        ) : null}
        <Button
          type="button"
          variant={props.selectedScenario ? 'outline' : 'default'}
          className="w-full"
          disabled={
            props.running || !props.canRun || specification.canRun === false
          }
          onClick={handleRunSpecification}
        >
          Run Specification
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="w-full"
          onClick={props.onEditSpecification}
        >
          Edit Specification
        </Button>
      </div>
    </aside>
  )
}

function FocusedMetadata(props: { model: BatchWorkbenchModel }) {
  const focus = props.model.focus
  if (!focus || !props.model.location) return null
  const { attempt, result } = focus.inspected
  const runHref = studioRouteHref({ kind: 'run', runId: props.model.runId })
  return (
    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-3 text-xs">
      <dt className="text-muted-foreground">Status</dt>
      <dd className="justify-self-end">
        <Badge
          variant={
            focus.displayState === 'running'
              ? 'running'
              : resultBadgeVariant(focus.displayState)
          }
        >
          {focus.displayState === 'running' ? (
            <Spinner className="text-primary" />
          ) : (
            <ResultMark state={focus.displayState} />
          )}
          {focus.displayState}
        </Badge>
      </dd>
      <dt className="text-muted-foreground">Started</dt>
      <dd className="text-right">
        {new Date(attempt.startedAt).toLocaleString()}
      </dd>
      <dt className="text-muted-foreground">Duration</dt>
      <dd className="text-right font-mono">
        {durationLabel(attempt.durationMs)}
      </dd>
      <dt className="text-muted-foreground">Profile</dt>
      <dd className="truncate text-right">
        {result.executionTargetProfile.id}
      </dd>
      <dt className="text-muted-foreground">Run</dt>
      <dd className="justify-self-end">
        <ButtonLink
          variant="ghost"
          size="sm"
          href={runHref}
          className="h-5 px-1"
        >
          {props.model.runId}
        </ButtonLink>
      </dd>
      <dt className="text-muted-foreground">Spec file</dt>
      <dd className="min-w-0 break-all text-right font-mono">
        {result.specification.uri}
        {focus.currentStep?.sourceLine
          ? `:${focus.currentStep.sourceLine}`
          : ''}
      </dd>
      <dt className="text-muted-foreground">Attempts</dt>
      <dd className="text-right">{result.attempts.length}</dd>
    </dl>
  )
}

function CurrentStep(props: { model: BatchWorkbenchModel }) {
  const currentStep = props.model.focus?.currentStep
  if (!currentStep) return null
  return (
    <section
      aria-labelledby="current-step-title"
      className="border-t border-border pt-4"
    >
      <div className="flex items-center justify-between gap-3">
        <h3 id="current-step-title" className="font-medium">
          Current step
        </h3>
        <span className="text-xs text-muted-foreground">
          Step {currentStep.index + 1}
        </span>
      </div>
      <p className="mt-2 text-sm">{currentStep.text}</p>
    </section>
  )
}

function EvidenceCounts(props: { model: BatchWorkbenchModel }) {
  const focus = props.model.focus
  if (!focus) return null
  return (
    <Accordion
      multiple
      defaultValue={['evidence']}
      className="rounded-none border-x-0"
    >
      <AccordionItem value="evidence">
        <AccordionTrigger className="px-0">Evidence</AccordionTrigger>
        <AccordionContent className="px-0">
          <dl className="space-y-3 text-xs">
            <EvidenceCount
              label="Diagnostics"
              value={focus.diagnostics.length}
            />
            <EvidenceCount label="Console" value={focus.consoleCount} />
            <EvidenceCount label="Logs" value={focus.logCount} />
            <EvidenceCount label="Screenshots" value={focus.screenshotCount} />
          </dl>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  )
}

function EvidenceCount(props: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt>{props.label}</dt>
      <dd className="text-muted-foreground">{props.value}</dd>
    </div>
  )
}

function EmptyFocus() {
  return (
    <p className="p-4 text-sm text-muted-foreground">
      Waiting for the first Scenario to start.
    </p>
  )
}

function EmptyTimeline() {
  return (
    <p className="p-4 text-sm text-muted-foreground">
      Run a Scenario to see each browser action on the timeline.
    </p>
  )
}

function EmptyArtifacts() {
  return (
    <p className="p-4 text-sm text-muted-foreground">
      Screenshots and recordings from the selected Scenario will appear here.
    </p>
  )
}

function EmptyDiagnostics() {
  return (
    <p className="p-4 text-sm text-muted-foreground">
      Console, network, and runner diagnostics will appear here.
    </p>
  )
}

function evidenceTab(tab: ResultInspectorTab | undefined) {
  return tab === 'artifacts' || tab === 'diagnostics' ? tab : 'timeline'
}

function viewportLabel(model: BatchWorkbenchModel): string {
  const viewport = model.viewport
  if (!viewport) return 'Waiting'
  if (viewport.kind === 'browserbase') return 'Browser session'
  if (viewport.width && viewport.height) {
    return `${viewport.width}×${viewport.height}`
  }
  return viewport.kind === 'device-frame' ? 'Device frame' : 'Browser frame'
}

function stateLabelClass(state: string): string {
  if (state === 'passed') return 'text-passed'
  if (state === 'failed' || state === 'infrastructure-error') {
    return 'text-destructive'
  }
  return 'text-muted-foreground'
}
