import { useEffect, useState } from 'react'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { ResultMark } from './components/ui/result-mark'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
import {
  displayedAttemptState,
  isAttemptInProgress,
  type LiveConnectionStatus,
} from './live-result-inspection'
import { LedgerLoadingSkeleton } from './loading-skeletons'
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
import type { StudioRunSnapshot } from './server'

type StudioApi = <Value>(path: string, init?: RequestInit) => Promise<Value>

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

export function ResultInspector(props: ResultInspectorProps) {
  const [fetched, setFetched] = useState<StudioRunSnapshot>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (props.snapshot) return
    let cancelled = false
    setFetched(undefined)
    setError(undefined)
    props
      .api<StudioRunSnapshot>(
        `/api/runs/${encodeURIComponent(props.location.runId)}`,
      )
      .then(
        (value) => {
          if (!cancelled) setFetched(value)
        },
        (reason: unknown) => {
          if (!cancelled) setError(reasonMessage(reason))
        },
      )
    return () => {
      cancelled = true
    }
  }, [props.api, props.location.runId, props.snapshot])

  const snapshot = props.snapshot ?? fetched
  const inspected = snapshot
    ? findInspectedResult(snapshot, props.location)
    : undefined

  if (error) {
    return (
      <div className="p-6">
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      </div>
    )
  }
  if (!snapshot) {
    return (
      <div className="p-6">
        <LedgerLoadingSkeleton label="Opening Test result" />
      </div>
    )
  }
  if (!inspected) {
    return (
      <div className="space-y-3 p-6">
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

  const displayState = displayedAttemptState(inspected.attempt)
  const inProgress = isAttemptInProgress(inspected.attempt)
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
      className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-6"
    >
      <header className="sticky top-0 z-10 -mx-4 mb-4 flex flex-wrap items-start justify-between gap-3 border-b border-border bg-background px-4 pb-4 sm:-mx-6 sm:px-6">
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
            <h3 id="result-inspector-title" className="text-lg font-medium">
              {inspected.result.scenario.name} · {displayState} ·{' '}
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
            state={displayState}
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
            resultState={
              displayState === 'running'
                ? inspected.attempt.state
                : displayState
            }
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
