import type {
  DiagnosticLevel,
  DiagnosticOrigin,
  RunEvent,
  ScenarioAttempt,
  TestArtifact,
  TestResult,
  TestResultState,
  TraceEntry,
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
  causalAt?: string
  message: string
  source: 'Scenario attempt' | 'Step'
  level: DiagnosticLevel
  origin: DiagnosticOrigin
  scenarioId?: string
  scenarioName?: string
  stepIndex?: number
  stepText?: string
  executionTargetProfileId?: string
}

export type DiagnosticFilter = {
  level?: DiagnosticLevel
  origin?: DiagnosticOrigin
  scenarioId?: string
  stepIndex?: number
  executionTargetProfileId?: string
}

export type TimelineEntry = {
  id: string
  occurredAt: string
  kind: 'Step' | 'Trace' | 'Run event' | 'Diagnostic entry' | 'Test artifact'
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
  const attemptDiagnostics: DiagnosticEvidence[] = (
    attempt.diagnostics ?? []
  ).map((entry, index) => ({
    ...entry,
    id: `attempt-${index}`,
    source: 'Scenario attempt',
  }))
  const stepDiagnostics: DiagnosticEvidence[] = attempt.steps.flatMap((step) =>
    (step.diagnostics ?? []).map((entry, index) => ({
      ...entry,
      id: `step-${step.index}-${index}`,
      source: 'Step' as const,
      stepIndex: entry.stepIndex ?? step.index,
      stepText:
        entry.stepText ?? `${step.step.keyword.trim()} ${step.step.text}`,
    })),
  )
  const diagnostics = [...attemptDiagnostics, ...stepDiagnostics]
  for (const step of attempt.steps) {
    if (
      step.message &&
      !diagnostics.some(
        (diagnostic) =>
          diagnostic.message === step.message &&
          diagnostic.stepIndex === step.index,
      )
    ) {
      diagnostics.push({
        id: `step-${step.index}-message`,
        occurredAt: step.finishedAt,
        level: 'error',
        origin: 'adapter',
        message: step.message,
        source: 'Step',
        stepIndex: step.index,
        stepText: `${step.step.keyword.trim()} ${step.step.text}`,
      })
    }
  }
  if (
    attempt.message &&
    !diagnostics.some((diagnostic) => diagnostic.message === attempt.message)
  ) {
    diagnostics.push({
      id: 'attempt-message',
      occurredAt: attempt.finishedAt,
      level: 'error',
      origin: 'runner',
      message: attempt.message,
      source: 'Scenario attempt',
    })
  }
  return diagnostics.sort(
    (left, right) =>
      Date.parse(left.occurredAt) - Date.parse(right.occurredAt) ||
      left.id.localeCompare(right.id),
  )
}

export function filterDiagnostics(
  diagnostics: readonly DiagnosticEvidence[],
  filter: DiagnosticFilter,
): DiagnosticEvidence[] {
  return diagnostics.filter(
    (entry) =>
      (filter.level === undefined || entry.level === filter.level) &&
      (filter.origin === undefined || entry.origin === filter.origin) &&
      (filter.scenarioId === undefined ||
        entry.scenarioId === filter.scenarioId) &&
      (filter.stepIndex === undefined ||
        entry.stepIndex === filter.stepIndex) &&
      (filter.executionTargetProfileId === undefined ||
        entry.executionTargetProfileId === filter.executionTargetProfileId),
  )
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
  const causalAt = failedStep
    ? (failedStep.diagnostics?.findLast((entry) => entry.causalAt)?.causalAt ??
      failedStep.trace?.findLast((entry) => entry.causalAt)?.causalAt)
    : undefined
  const stepEntries: TimelineEntry[] = attempt.steps.map((step) => ({
    id: `step-${step.index}`,
    occurredAt:
      causalStepId === `step-${step.index}` && causalAt
        ? causalAt
        : step.finishedAt,
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
  const traceEntries: TimelineEntry[] = attempt.steps.flatMap((step) => {
    const trace: TraceEntry[] =
      step.trace ??
      step.resolvedActions.map((action) => ({
        occurredAt: step.finishedAt,
        kind: 'resolved-action' as const,
        description: action.description,
      }))
    return trace.map((entry, index) => ({
      id: `trace-${step.index}-${index}`,
      occurredAt: entry.causalAt ?? entry.occurredAt,
      kind: 'Trace' as const,
      title: entry.description,
      detail:
        entry.kind === 'resolved-action'
          ? `${step.step.keyword.trim()} ${step.step.text}`
          : 'Browser activity',
      causal: causalStepId === `step-${step.index}`,
    }))
  })
  const diagnosticEntries: TimelineEntry[] = diagnosticsFor(attempt).map(
    (diagnostic) => ({
      id: `diagnostic-${diagnostic.id}`,
      occurredAt: diagnostic.causalAt ?? diagnostic.occurredAt,
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
    Trace: 1,
    'Run event': 2,
    'Diagnostic entry': 3,
    'Test artifact': 4,
  }
  const entries = [
    ...stepEntries,
    ...traceEntries,
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
