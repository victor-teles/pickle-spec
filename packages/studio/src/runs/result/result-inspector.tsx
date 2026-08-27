import { useEffect, useState } from 'react'
import type { StudioApi } from '../../app/studio-api'
import { LedgerLoadingSkeleton } from '../../components/loading-skeletons'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { ResultMark } from '../../components/ui/result-mark'
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../../components/ui/tabs'
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
  location: ResultInspectionLocation
  onBack?: () => void
  onTabChange: (tab: ResultInspectorTab) => void
  snapshot?: StudioRunSnapshot
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

function InspectedResultView(
  props: ResultInspectorProps & {
    snapshot: StudioRunSnapshot
    inspected: NonNullable<ReturnType<typeof findInspectedResult>>
  },
) {
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
  return (
    <section
      aria-labelledby="result-inspector-title"
      className="min-h-0 flex-1 overflow-auto px-3 py-4 sm:px-5"
    >
      <header className="sticky top-0 z-10 -mx-3 mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border bg-background px-3 pb-4 sm:-mx-5 sm:px-5">
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
                displayState === 'running'
                  ? 'running'
                  : resultBadgeVariant(displayState)
              }
            >
              <ResultMark state={displayState} />
              {displayState}
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
      <Tabs
        value={activeTab}
        onValueChange={(value) =>
          props.onTabChange(value as ResultInspectorTab)
        }
      >
        <TabsList variant="line" aria-label="Test result evidence">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="artifacts">Artifacts</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <ResultOverview {...inspected} inProgress={inProgress} />
        </TabsContent>
        <TabsContent value="timeline">
          <ResultEvidenceTimeline
            entries={timeline}
            startedAt={inspected.attempt.startedAt}
            durationMs={inspected.attempt.durationMs}
            state={displayState}
            scenarioName={inspected.result.scenario.name}
            resultState={resultState}
            follow={props.following}
            followedEntryId={props.followedEntryId}
            onPauseFollowing={props.onPauseFollowing}
          />
        </TabsContent>
        <TabsContent value="artifacts">
          <ResultArtifacts
            artifacts={artifacts}
            availability={inspected.attempt.evidenceAvailability}
            scenarioName={inspected.result.scenario.name}
            resultState={resultState}
          />
        </TabsContent>
        <TabsContent value="diagnostics">
          <ResultDiagnostics
            diagnostics={diagnostics}
            availability={inspected.attempt.evidenceAvailability}
            applicationOutputAvailability={
              inspected.attempt.applicationOutputAvailability
            }
          />
        </TabsContent>
      </Tabs>
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
