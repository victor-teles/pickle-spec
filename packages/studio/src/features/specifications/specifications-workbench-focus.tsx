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
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible'
import { ResultMark } from '../../components/ui/result-mark'
import { Spinner } from '../../components/ui/spinner'
import { Switch } from '../../components/ui/switch'
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
import { ArtifactViewer } from '../runs/result/artifact-viewer'
import {
  artifactDownloadUrl,
  type TimelineEntry,
  timelineEntriesOfKinds,
} from '../runs/result/result-evidence'
import type { ResultInspectorTab } from '../runs/result/result-inspection'
import { ResultViewportSurface } from '../runs/result/result-inspector'
import { resultBadgeVariant } from '../runs/result/result-presentation'
import { TimelineEvidenceDetail } from '../runs/result/timeline-evidence-detail'
import { TimelineWaterfall } from '../runs/result/timeline-waterfall'
import { durationLabel } from '../runs/run-format'
import { studioRouteHref } from '../studio/studio-route'
import {
  EmptyArtifacts,
  EmptyDiagnostics,
  EmptyFocus,
  EmptyTimeline,
  PreviewEmptyState,
} from './specifications-workbench-empty'
import type {
  BatchWorkbenchModel,
  SpecificationsWorkbenchModel,
} from './specifications-workbench-model'
import { workbenchBrowserFrame } from './workbench-browser-frame'

export type WorkbenchEvidenceProps = {
  model: SpecificationsWorkbenchModel
  onInspectTimelineEntry: (entryId: string) => void
  onPauseFollowing: () => void
  onResumeFollowing: () => void
  onSelectInspectorTab: (tab: ResultInspectorTab) => void
}

type WorkbenchPreviewContentProps = {
  model: SpecificationsWorkbenchModel
  scenarioName: string
  selectedScenario?: StudioScenario
}

function WorkbenchPreviewContent(props: WorkbenchPreviewContentProps) {
  if (
    props.model.kind === 'batch' &&
    props.model.following &&
    props.model.viewport
  ) {
    return (
      <div className="min-h-72 flex-1 overflow-hidden bg-muted/20 p-2 xl:min-h-0">
        <ResultViewportSurface
          liveViewport={props.model.viewport}
          scenarioName={props.scenarioName}
          size="workbench"
        />
      </div>
    )
  }
  const selectedEntry = selectedWorkbenchTimelineEntry(props.model)
  if (props.model.kind === 'batch' && props.model.focus && selectedEntry) {
    const frame = workbenchBrowserFrame(
      props.model.focus.timeline,
      selectedEntry,
    )
    if (!frame) {
      return (
        <PreviewEmptyState
          model={props.model}
          selectedScenario={props.selectedScenario}
        />
      )
    }
    return (
      <div className="flex min-h-72 flex-1 items-center overflow-hidden bg-muted/20 p-2 xl:min-h-0">
        <ArtifactViewer
          artifact={frame.artifact}
          scenarioName={props.scenarioName}
          resultState={props.model.focus.resultState}
          stepText={
            frame.exact
              ? selectedEntry.title
              : `Nearest browser frame to ${selectedEntry.title}`
          }
        />
      </div>
    )
  }
  return (
    <PreviewEmptyState
      model={props.model}
      selectedScenario={props.selectedScenario}
    />
  )
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
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 sm:px-4">
        <div className="flex items-center gap-2">
          <HugeiconsIcon icon={BrowserIcon} strokeWidth={1} aria-hidden />
          <h2 id="workbench-preview-title" className="text-sm font-semibold">
            Browser preview
          </h2>
        </div>
        <div className="flex items-center gap-2">
          {props.model.kind === 'batch' &&
          props.model.following &&
          props.model.viewport ? (
            <span className="text-xs text-muted-foreground">
              {viewportLabel(props.model)}
            </span>
          ) : null}
          <Badge
            variant={
              props.model.kind === 'batch' &&
              props.model.phase === 'running' &&
              props.model.following &&
              props.model.viewport
                ? 'running'
                : 'default'
            }
          >
            {previewStateLabel(props.model)}
          </Badge>
        </div>
      </header>
      <WorkbenchPreviewContent
        model={props.model}
        scenarioName={scenarioName}
        selectedScenario={props.selectedScenario}
      />
    </section>
  )
}

export function EvidenceDock(props: WorkbenchEvidenceProps) {
  const focus = props.model.kind === 'batch' ? props.model.focus : undefined
  const tab = evidenceTab(focus?.activeTab)
  return (
    <section className="min-h-0 min-w-0 overflow-hidden">
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
        <TabsContent value="timeline" className="min-h-0 overflow-hidden">
          <WorkbenchTimeline
            model={props.model}
            onInspectTimelineEntry={props.onInspectTimelineEntry}
            onPauseFollowing={props.onPauseFollowing}
          />
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

function WorkbenchTimeline(props: {
  model: SpecificationsWorkbenchModel
  onInspectTimelineEntry: (entryId: string) => void
  onPauseFollowing: () => void
}) {
  if (props.model.kind === 'browse') return <EmptyTimeline />
  const focus = props.model.focus
  if (!focus) return <EmptyFocus />
  const entries = workbenchTimelineEntries(focus.timeline)
  const selectedEntry = selectedWorkbenchTimelineEntry(props.model)
  if (!selectedEntry) {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        No steps or actions have been recorded for this Scenario attempt yet.
      </p>
    )
  }
  return (
    <section className="h-full min-h-0 overflow-auto bg-background/20">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Execution timeline</h3>
          <p className="text-xs text-muted-foreground">
            Select a step or action to inspect the evidence captured then.
          </p>
        </div>
        <span
          role="status"
          aria-live="polite"
          className="font-mono text-[0.6875rem] text-muted-foreground tabular-nums"
        >
          {durationLabel(focus.inspected.attempt.durationMs)} · {entries.length}{' '}
          {entries.length === 1 ? 'entry' : 'entries'}
        </span>
      </div>
      <div className="grid min-w-0 items-start lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
        <TimelineWaterfall
          entries={entries}
          attemptStartedAt={focus.inspected.attempt.startedAt}
          durationMs={focus.inspected.attempt.durationMs}
          selectedEntryId={selectedEntry.id}
          followedEntryId={selectedEntry.id}
          following={props.model.following}
          onSelect={props.onInspectTimelineEntry}
          onPauseFollowing={props.onPauseFollowing}
        />
        <TimelineEvidenceDetail
          entry={selectedEntry}
          attemptStartedAt={focus.inspected.attempt.startedAt}
          scenarioName={focus.inspected.result.scenario.name}
          resultState={focus.resultState}
        />
      </div>
    </section>
  )
}

function workbenchTimelineEntries(
  entries: readonly TimelineEntry[],
): readonly TimelineEntry[] {
  return timelineEntriesOfKinds(entries, ['Step', 'Resolved action'])
}

function selectedWorkbenchTimelineEntry(
  model: SpecificationsWorkbenchModel,
): TimelineEntry | undefined {
  if (model.kind === 'browse' || !model.focus) return undefined
  const entries = workbenchTimelineEntries(model.focus.timeline)
  return (
    entries.find((entry) => entry.id === model.followedEntryId) ??
    entries.at(-1)
  )
}

function CompactArtifacts(props: { model: SpecificationsWorkbenchModel }) {
  if (props.model.kind === 'browse') return <EmptyArtifacts />
  const focus = props.model.focus
  if (!focus || focus.artifacts.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No artifacts retained.</p>
    )
  }
  const artifacts = focus.artifacts
  return (
    <ul className="space-y-2">
      {artifacts.map((evidence) => {
        const downloadHref = artifactDownloadUrl(
          evidence.artifact.path,
          evidence.artifact.name,
        )
        return (
          <li key={evidence.index} className="border-b border-border pb-2">
            <Collapsible>
              <div className="flex items-center gap-2 text-sm">
                <CollapsibleTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Preview ${evidence.artifact.kind} artifact from ${evidence.stepText}`}
                      className="min-w-0 flex-1 justify-between gap-3 px-2"
                    />
                  }
                >
                  <span className="min-w-0 truncate text-left">
                    {evidence.stepText}
                  </span>
                  <Badge>{evidence.artifact.kind}</Badge>
                </CollapsibleTrigger>
                <ButtonLink
                  variant="outline"
                  size="sm"
                  href={downloadHref}
                  download={evidence.artifact.name ?? true}
                  aria-label={`Download ${evidence.artifact.kind} artifact from ${evidence.stepText}`}
                >
                  Download
                </ButtonLink>
              </div>
              <CollapsibleContent className="pt-2">
                <ArtifactViewer
                  artifact={evidence.artifact}
                  scenarioName={focus.inspected.result.scenario.name}
                  resultState={focus.resultState}
                  stepText={evidence.stepText}
                />
              </CollapsibleContent>
            </Collapsible>
          </li>
        )
      })}
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
    <aside className="min-h-0 min-w-0 overflow-auto bg-muted/10">
      {focus ? (
        <>
          <header className="space-y-1 border-b border-border p-4">
            <h2 className="text-xl font-semibold tracking-tight">
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
    <aside className="flex h-full min-h-0 min-w-0 flex-col overflow-auto bg-muted/10">
      <header className="space-y-1 border-b border-border p-4">
        <h2 className="text-xl font-semibold tracking-tight">
          {specification.name}
        </h2>
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
            <p className="text-[0.6875rem] font-semibold tracking-[0.04em] text-muted-foreground uppercase">
              Selected Scenario
            </p>
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
        ) : (
          <p className="text-sm leading-relaxed text-muted-foreground">
            Select a Scenario in the sidebar to inspect it or run it directly.
          </p>
        )}
        <Button
          type="button"
          variant="outline"
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
          title={props.model.runId}
          className="h-5 max-w-full truncate px-1 font-mono"
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

function evidenceTab(tab: ResultInspectorTab | undefined) {
  return tab === 'artifacts' || tab === 'diagnostics' ? tab : 'timeline'
}

function viewportLabel(model: BatchWorkbenchModel): string {
  const viewport = model.viewport
  if (!viewport) return ''
  if (viewport.kind === 'browserbase') return 'Browser session'
  if (viewport.width && viewport.height) {
    return `${viewport.width}×${viewport.height}`
  }
  return viewport.kind === 'device-frame' ? 'Device frame' : 'Browser frame'
}

function previewStateLabel(model: SpecificationsWorkbenchModel): string {
  if (model.kind === 'browse') return 'Idle'
  if (!model.following) return 'Historical'
  if (!model.viewport && model.focus) return 'Recorded'
  return model.phase === 'running' ? 'Live' : 'Finished'
}
