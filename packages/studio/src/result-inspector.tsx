import { useEffect, useState } from 'react'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { LoadingState } from './components/ui/loading-state'
import { ResultMark } from './components/ui/result-mark'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs'
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
  onBack: () => void
  onTabChange: (tab: ResultInspectorTab) => void
}

export function ResultInspector(props: ResultInspectorProps) {
  const [snapshot, setSnapshot] = useState<StudioRunSnapshot>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    setSnapshot(undefined)
    setError(undefined)
    props
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
  }, [props.api, props.location.runId])

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
        <LoadingState label="Opening Test result" />
      </div>
    )
  }
  if (!inspected) {
    return (
      <div className="space-y-3 p-6">
        <p role="alert" className="text-sm text-destructive">
          This Scenario attempt is not available in test run {snapshot.id}.
        </p>
        <Button type="button" variant="outline" onClick={props.onBack}>
          Back to run
        </Button>
      </div>
    )
  }

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
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={props.onBack}
          >
            Back to run
          </Button>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h3 id="result-inspector-title" className="text-lg font-medium">
              {inspected.result.scenario.name} · {inspected.attempt.state} ·{' '}
              {inspected.result.executionTargetProfile.id}
            </h3>
            <Badge variant={resultBadgeVariant(inspected.attempt.state)}>
              <ResultMark state={inspected.attempt.state} />
              {inspected.attempt.state}
            </Badge>
          </div>
          <p className="font-mono text-xs text-muted-foreground">
            Test run {snapshot.id} · Attempt {inspected.attempt.attempt}
          </p>
        </div>
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
          <ResultOverview {...inspected} />
        </TabsContent>
        <TabsContent value="timeline">
          <ResultEvidenceTimeline
            entries={timeline}
            startedAt={inspected.attempt.startedAt}
            state={inspected.attempt.state}
          />
        </TabsContent>
        <TabsContent value="artifacts">
          <ResultArtifacts
            artifacts={artifacts}
            scenarioName={inspected.result.scenario.name}
            resultState={inspected.attempt.state}
          />
        </TabsContent>
        <TabsContent value="diagnostics">
          <ResultDiagnostics
            diagnostics={diagnostics}
            availability={inspected.attempt.evidenceAvailability}
          />
        </TabsContent>
      </Tabs>
    </section>
  )
}
