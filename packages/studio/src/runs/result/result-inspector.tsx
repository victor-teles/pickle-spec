import type { TestResultState } from '@pickle-spec/runner'
import { useEffect, useState } from 'react'
import type { StudioApi } from '../../app/studio-api'
import { LedgerLoadingSkeleton } from '../../components/loading-skeletons'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { ResultMark } from '../../components/ui/result-mark'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../components/ui/tabs'
import type { StudioLiveViewport } from '../../live-viewport'
import type { StudioRunSnapshot } from '../../server/server'
import {
  displayedAttemptState,
  isAttemptInProgress,
  type LiveConnectionStatus,
} from './live-result-inspection'
import {
  artifactsFor,
  defaultResultInspectorTab,
  diagnosticsFor,
  findInspectedResult,
  timelineFor,
} from './result-evidence'
import {
  ResultArtifact,
  ResultArtifacts,
  ResultDiagnostics,
  ResultOverview,
} from './result-evidence-panels'
import { ResultEvidenceTimeline } from './result-evidence-timeline'
import type {
  ResultInspectionLocation,
  ResultInspectorTab,
} from './result-inspection'
import { reasonMessage, resultBadgeVariant } from './result-presentation'

type ResultInspectorProps = {
  api: StudioApi
  artifactIndex?: number
  location: ResultInspectionLocation
  onBack?: () => void
  onBackToResult?: () => void
  onOpenArtifact?: (artifactIndex: number) => void
  onTabChange: (tab: ResultInspectorTab) => void
  snapshot?: StudioRunSnapshot
  liveViewport?: StudioLiveViewport
  connection?: LiveConnectionStatus
  following?: boolean
  followedEntryId?: string
  onResumeFollowing?: () => void
  onPauseFollowing?: () => void
}

function useFetchedRunSnapshot(props: ResultInspectorProps) {
  const [snapshot, setSnapshot] = useState<StudioRunSnapshot>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (props.snapshot) return
    let cancelled = false
    setSnapshot(undefined)
    setError(undefined)
    void props
      .api<StudioRunSnapshot>(
        `/api/runs/${encodeURIComponent(props.location.runId)}`,
      )
      .then(
        (value) => {
          if (!cancelled) setSnapshot(value)
        },
        (reason: unknown) => {
          if (!cancelled) setError(reasonMessage(reason))
        },
      )
    return () => {
      cancelled = true
    }
  }, [props.api, props.location.runId, props.snapshot])
  return { snapshot, error }
}

export function ResultInspector(props: ResultInspectorProps) {
  const fetched = useFetchedRunSnapshot(props)
  const snapshot = props.snapshot ?? fetched.snapshot
  const inspected = snapshot
    ? findInspectedResult(snapshot, props.location)
    : undefined

  if (fetched.error) {
    return (
      <div className="p-4">
        <p role="alert" className="text-sm text-destructive">
          {fetched.error}
        </p>
      </div>
    )
  }
  if (!snapshot) {
    return (
      <div className="p-4">
        <LedgerLoadingSkeleton label="Opening Test result" />
      </div>
    )
  }
  if (!inspected) {
    return (
      <div className="space-y-3 p-4">
        <p role="alert" className="text-sm text-destructive">
          This Scenario attempt is not available in test run {snapshot.id}.
        </p>
        {props.onBack ? (
          <Button type="button" variant="outline" onClick={props.onBack}>
            Back to run
          </Button>
        ) : null}
      </div>
    )
  }
  return (
    <InspectedResultView {...props} snapshot={snapshot} inspected={inspected} />
  )
}

type InspectedResultViewProps = ResultInspectorProps & {
  snapshot: StudioRunSnapshot
  inspected: NonNullable<ReturnType<typeof findInspectedResult>>
}

function ResultInspectorHeader(
  props: InspectedResultViewProps & {
    displayState: ReturnType<typeof displayedAttemptState>
  },
) {
  const { inspected, snapshot } = props
  return (
    <header className="mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
      <div className="min-w-0 space-y-2">
        {props.onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={props.onBack}
          >
            Back to run
          </Button>
        ) : null}
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h3 id="result-inspector-title" className="studio-display text-sm">
            {inspected.result.scenario.name} ·{' '}
            {inspected.result.executionTargetProfile.id}
          </h3>
          <Badge
            variant={
              props.displayState === 'running'
                ? 'running'
                : resultBadgeVariant(props.displayState)
            }
          >
            <ResultMark state={props.displayState} />
            {props.displayState}
          </Badge>
        </div>
        <p className="font-mono text-xs text-muted-foreground">
          Test run {snapshot.id} · Attempt {inspected.attempt.attempt}
        </p>
        <ConnectionStatus connection={props.connection} />
      </div>
      {props.following === false && props.onResumeFollowing ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={props.onResumeFollowing}
        >
          Resume following
        </Button>
      ) : null}
    </header>
  )
}

function ResultInspectorTabs(
  props: InspectedResultViewProps & {
    activeTab: ResultInspectorTab
    artifacts: ReturnType<typeof artifactsFor>
    diagnostics: ReturnType<typeof diagnosticsFor>
    displayState: ReturnType<typeof displayedAttemptState>
    inProgress: boolean
    resultState: TestResultState
    timeline: ReturnType<typeof timelineFor>
  },
) {
  const { inspected } = props
  const evidenceTimeline = (
    <ResultEvidenceTimeline
      entries={props.timeline}
      startedAt={inspected.attempt.startedAt}
      durationMs={inspected.attempt.durationMs}
      state={props.displayState}
      scenarioName={inspected.result.scenario.name}
      resultState={props.resultState}
      follow={props.following}
      followedEntryId={props.followedEntryId}
      onPauseFollowing={props.onPauseFollowing}
    />
  )
  return (
    <Tabs
      value={props.activeTab}
      onValueChange={(value) => props.onTabChange(value as ResultInspectorTab)}
    >
      <TabsList variant="line" aria-label="Test result evidence">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="timeline">Timeline</TabsTrigger>
        <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
        <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
        <TabsTrigger value="viewport">Viewport</TabsTrigger>
      </TabsList>
      <TabsContent value="overview">
        <ResultOverview {...inspected} inProgress={props.inProgress} />
      </TabsContent>
      <TabsContent value="timeline">
        {props.liveViewport?.kind === 'device-frame' ? (
          <div className="grid min-w-0 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,24rem)]">
            {evidenceTimeline}
            <ResultViewportPanel
              liveViewport={props.liveViewport}
              scenarioName={inspected.result.scenario.name}
              compact
            />
          </div>
        ) : (
          evidenceTimeline
        )}
      </TabsContent>
      <TabsContent value="artifacts">
        <ResultArtifacts
          artifacts={props.artifacts}
          availability={inspected.attempt.evidenceAvailability}
          onOpenArtifact={props.onOpenArtifact}
          resultLocation={props.location}
          scenarioName={inspected.result.scenario.name}
          resultState={props.resultState}
        />
      </TabsContent>
      <TabsContent value="diagnostics">
        <ResultDiagnostics
          diagnostics={props.diagnostics}
          availability={inspected.attempt.evidenceAvailability}
          applicationOutputAvailability={
            inspected.attempt.applicationOutputAvailability
          }
        />
      </TabsContent>
      <TabsContent value="viewport">
        <ResultViewportPanel
          liveViewport={props.liveViewport}
          scenarioName={inspected.result.scenario.name}
        />
      </TabsContent>
    </Tabs>
  )
}

function InspectedResultView(props: InspectedResultViewProps) {
  const { snapshot, inspected } = props
  const displayState = displayedAttemptState(inspected.attempt)
  const inProgress = isAttemptInProgress(inspected.attempt)
  const resultState =
    displayState === 'running' ? inspected.attempt.state : displayState
  const activeTab =
    props.location.tab ?? defaultResultInspectorTab(inspected.attempt.state)
  const artifacts = artifactsFor(inspected.attempt)
  const diagnostics = diagnosticsFor(inspected.attempt)
  const timeline = timelineFor(
    snapshot.events,
    inspected.attempt,
    props.location,
  )
  if (props.artifactIndex !== undefined) {
    const artifact = artifacts[props.artifactIndex]
    return (
      <ArtifactPage
        artifact={artifact}
        artifactIndex={props.artifactIndex}
        onBack={props.onBackToResult}
        resultState={resultState}
        scenarioName={inspected.result.scenario.name}
        snapshot={snapshot}
      />
    )
  }
  return (
    <section
      aria-labelledby="result-inspector-title"
      className="min-h-0 flex-1 overflow-auto px-3 py-4 sm:px-5"
    >
      <ResultInspectorHeader {...props} displayState={displayState} />
      <ResultInspectorTabs
        {...props}
        activeTab={activeTab}
        artifacts={artifacts}
        diagnostics={diagnostics}
        displayState={displayState}
        inProgress={inProgress}
        resultState={resultState}
        timeline={timeline}
      />
    </section>
  )
}

type ArtifactPageProps = {
  artifact: ReturnType<typeof artifactsFor>[number] | undefined
  artifactIndex: number
  onBack?: () => void
  resultState: TestResultState
  scenarioName: string
  snapshot: StudioRunSnapshot
}

function ArtifactPage(props: ArtifactPageProps) {
  if (!props.artifact) {
    return (
      <section className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
        <p role="alert" className="text-sm text-destructive">
          Test artifact {props.artifactIndex} is not available in test run{' '}
          {props.snapshot.id}.
        </p>
        {props.onBack ? (
          <Button type="button" variant="outline" onClick={props.onBack}>
            Back to Test result
          </Button>
        ) : null}
      </section>
    )
  }
  return (
    <section
      aria-labelledby="artifact-page-title"
      className="min-h-0 flex-1 space-y-4 overflow-auto px-3 py-4 sm:px-5"
    >
      <header className="space-y-2 border-b border-border pb-4">
        {props.onBack ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={props.onBack}
          >
            Back to Test result
          </Button>
        ) : null}
        <h3 id="artifact-page-title" className="studio-display text-sm">
          {props.artifact.artifact.kind} · {props.scenarioName}
        </h3>
        <p className="font-mono text-xs text-muted-foreground">
          Test run {props.snapshot.id} · Artifact {props.artifactIndex}
        </p>
      </header>
      <ResultArtifact
        evidence={props.artifact}
        resultState={props.resultState}
        scenarioName={props.scenarioName}
      />
    </section>
  )
}

function ConnectionStatus(props: { connection?: LiveConnectionStatus }) {
  if (props.connection?.kind === 'disconnected') {
    return (
      <p role="alert" className="text-sm text-destructive">
        Disconnected from the live event stream. {props.connection.message}{' '}
        Evidence received so far is still shown.
      </p>
    )
  }
  if (props.connection?.kind === 'event-loss') {
    return (
      <p role="alert" className="text-sm text-destructive">
        Run events after sequence {props.connection.lastReceivedSequence} were
        not received before sequence {props.connection.receivedSequence}. Later
        evidence is still shown.
      </p>
    )
  }
  return null
}

export function ResultViewportPanel(props: {
  liveViewport?: StudioLiveViewport
  scenarioName: string
  compact?: boolean
}) {
  if (!props.liveViewport) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Live viewport</CardTitle>
          <CardDescription>
            No live viewport is currently available for this Scenario attempt.
          </CardDescription>
        </CardHeader>
      </Card>
    )
  }
  if (props.liveViewport.kind === 'browserbase') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Live viewport</CardTitle>
          <CardDescription>
            Streaming the remote Browserbase session for {props.scenarioName}.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="overflow-hidden rounded-xl border border-border bg-muted">
            <iframe
              title={`Browserbase live session for ${props.scenarioName}`}
              src={props.liveViewport.url}
              sandbox="allow-same-origin allow-scripts"
              allow="clipboard-read; clipboard-write"
              className="h-[640px] w-full bg-background"
            />
          </div>
        </CardContent>
      </Card>
    )
  }
  const deviceFrame = props.liveViewport.kind === 'device-frame'
  return (
    <Card>
      <CardHeader>
        <CardTitle>Live viewport</CardTitle>
        <CardDescription>
          Latest {deviceFrame ? 'device' : 'browser'} frame streamed for{' '}
          {props.scenarioName}.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-hidden rounded-xl border border-border bg-muted">
          <img
            alt={`Live ${deviceFrame ? 'device' : 'browser'} viewport for ${props.scenarioName}`}
            src={`data:${props.liveViewport.mimeType};base64,${props.liveViewport.data}`}
            className={
              props.compact ? 'max-h-[36rem] w-full object-contain' : 'w-full'
            }
          />
        </div>
      </CardContent>
    </Card>
  )
}
