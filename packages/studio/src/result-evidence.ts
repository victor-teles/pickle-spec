import type {
  RunEvent,
  ScenarioAttempt,
  TestArtifact,
  TestResult,
  TestResultState,
} from '@pickle-spec/runner'
import type {
  ResultInspectionLocation,
  ResultInspectorTab,
} from './result-inspection'
import type { StudioRunSnapshot } from './server'

export type InspectedResult = {
  result: TestResult
  attempt: ScenarioAttempt
}

export type ArtifactEvidence = {
  artifact: TestArtifact
  stepIndex: number
  stepText: string
  capturedAt: string
}

export type DiagnosticEvidence = {
  id: string
  occurredAt: string
  message: string
  source: 'Scenario attempt' | 'Step'
  stepText?: string
}

export type TimelineEntry = {
  id: string
  occurredAt: string
  kind: 'Step' | 'Run event' | 'Diagnostic entry' | 'Test artifact'
  title: string
  detail?: string
  causal?: boolean
}

export function defaultResultInspectorTab(
  state: TestResultState,
): ResultInspectorTab {
  return state === 'failed' || state === 'infrastructure-error'
    ? 'timeline'
    : 'overview'
}

export function findInspectedResult(
  snapshot: StudioRunSnapshot,
  location: ResultInspectionLocation,
): InspectedResult | undefined {
  const result = snapshot.manifest?.results.find(
    (candidate) =>
      candidate.specification.uri === location.specificationUri &&
      (candidate.scenario.id ?? candidate.scenario.name) ===
        location.scenarioId &&
      candidate.scenario.examplesRowId === location.examplesRowId &&
      candidate.executionTargetProfile.id === location.profileId,
  )
  const attempt = result?.attempts.find(
    (candidate) => candidate.attempt === location.attempt,
  )
  return result && attempt ? { result, attempt } : undefined
}

export function relativeTimeLabel(
  occurredAt: string,
  startedAt: string,
): string {
  const elapsedMs = Math.max(0, Date.parse(occurredAt) - Date.parse(startedAt))
  return `+${(elapsedMs / 1_000).toFixed(3)} s`
}

function eventTitle(event: RunEvent): string {
  return event.type
    .split('-')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function scopedEvents(
  events: readonly RunEvent[],
  location: ResultInspectionLocation,
): RunEvent[] {
  return events.filter(
    (event) =>
      'scope' in event &&
      event.scope.scenarioId === location.scenarioId &&
      event.scope.examplesRowId === location.examplesRowId &&
      event.scope.executionTargetProfileId === location.profileId &&
      event.scope.attempt === location.attempt,
  )
}

export function artifactsFor(attempt: ScenarioAttempt): ArtifactEvidence[] {
  return attempt.steps.flatMap((step) =>
    (step.artifacts ?? []).map((artifact) => ({
      artifact,
      stepIndex: step.index,
      stepText: `${step.step.keyword.trim()} ${step.step.text}`,
      capturedAt: step.finishedAt,
    })),
  )
}

export function diagnosticsFor(attempt: ScenarioAttempt): DiagnosticEvidence[] {
  const diagnostics: DiagnosticEvidence[] = attempt.steps.flatMap((step) =>
    step.message
      ? [
          {
            id: `step-${step.index}`,
            occurredAt: step.finishedAt,
            message: step.message,
            source: 'Step' as const,
            stepText: `${step.step.keyword.trim()} ${step.step.text}`,
          },
        ]
      : [],
  )
  if (
    attempt.message &&
    !diagnostics.some((diagnostic) => diagnostic.message === attempt.message)
  ) {
    diagnostics.push({
      id: 'attempt',
      occurredAt: attempt.finishedAt,
      message: attempt.message,
      source: 'Scenario attempt',
    })
  }
  return diagnostics
}

export function timelineFor(
  events: readonly RunEvent[],
  attempt: ScenarioAttempt,
  location: ResultInspectionLocation,
): TimelineEntry[] {
  const failedStep = attempt.steps.find(
    (step) => step.state === 'failed' || step.state === 'infrastructure-error',
  )
  const causalStepId = failedStep ? `step-${failedStep.index}` : undefined
  const stepEntries: TimelineEntry[] = attempt.steps.map((step) => ({
    id: `step-${step.index}`,
    occurredAt: step.finishedAt,
    kind: 'Step',
    title: `${step.step.keyword.trim()} ${step.step.text}`,
    detail: `${step.state} · ${step.durationMs} ms`,
    causal: causalStepId === `step-${step.index}`,
  }))
  const eventEntries: TimelineEntry[] = scopedEvents(events, location).map(
    (event) => ({
      id: `event-${event.sequence}`,
      occurredAt: event.occurredAt,
      kind: 'Run event',
      title: eventTitle(event),
      detail: `Sequence ${event.sequence}`,
    }),
  )
  const diagnosticEntries: TimelineEntry[] = diagnosticsFor(attempt).map(
    (diagnostic) => ({
      id: `diagnostic-${diagnostic.id}`,
      occurredAt: diagnostic.occurredAt,
      kind: 'Diagnostic entry',
      title: diagnostic.message,
      detail: diagnostic.stepText ?? diagnostic.source,
      causal: !causalStepId && diagnostic.id === 'attempt',
    }),
  )
  const artifactEntries: TimelineEntry[] = artifactsFor(attempt).map(
    (artifact, index) => ({
      id: `artifact-${artifact.stepIndex}-${index}`,
      occurredAt: artifact.capturedAt,
      kind: 'Test artifact',
      title: artifact.artifact.kind,
      detail: artifact.stepText,
    }),
  )
  const kindOrder: Record<TimelineEntry['kind'], number> = {
    Step: 0,
    'Run event': 1,
    'Diagnostic entry': 2,
    'Test artifact': 3,
  }
  const entries = [
    ...stepEntries,
    ...eventEntries,
    ...diagnosticEntries,
    ...artifactEntries,
  ].sort(
    (left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      kindOrder[left.kind] - kindOrder[right.kind] ||
      left.id.localeCompare(right.id),
  )
  return entries
}

export function artifactUrl(path: string): string {
  return `/api/artifact?path=${encodeURIComponent(path)}`
}
