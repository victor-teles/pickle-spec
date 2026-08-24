import type {
  DiagnosticLevel,
  DiagnosticOrigin,
  EvidenceAvailability,
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

export type ArtifactViewerKind = 'image' | 'video' | 'text' | 'download'

export type DiagnosticEvidence = {
  id: string
  occurredAt: string
  causalAt?: string
  message: string
  source: 'Scenario attempt' | 'Step'
  level: DiagnosticLevel
  origin: DiagnosticOrigin
  stream?: 'stdout' | 'stderr'
  scenarioId?: string
  scenarioName?: string
  stepIndex?: number
  stepText?: string
  executionTargetProfileId?: string
}

export type DiagnosticFilter = {
  query?: string
  level?: DiagnosticLevel
  origin?: DiagnosticOrigin
  scenarioId?: string
  stepIndex?: number
  executionTargetProfileId?: string
}

export type DiagnosticPage = {
  entries: readonly DiagnosticEvidence[]
  page: number
  pageCount: number
  first: number
  last: number
}

export type ArtifactLoadFailure = 'missing' | 'corrupt' | 'load-failed'

const evidenceRecoveryGuidance: Record<
  Exclude<EvidenceAvailability['state'], 'available'>,
  string
> = {
  'not-requested': 'Request this evidence before the next Test run.',
  'not-supported':
    'Choose an execution target that supports this evidence, then run the Scenario again.',
  'not-retained':
    'Change the evidence retention policy, then run the Scenario again.',
  'capture-failed':
    'Review Diagnostics for the capture error, then run the Scenario again.',
  missing:
    'Restore or re-import the archived artifact, or run the Scenario again.',
}

const artifactLoadGuidance: Record<ArtifactLoadFailure, string> = {
  missing:
    'The retained file could not be found. Restore or re-import the archive, or run the Scenario again.',
  corrupt:
    'The retained file could not be decoded and may be corrupt. Download the original file or run the Scenario again.',
  'load-failed':
    'The preview could not be loaded. Retry the preview, then download the original file if the problem continues.',
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
      capturedAt: artifact.capturedAt ?? step.finishedAt,
    })),
  )
}

export function artifactViewerKind(
  artifact: Pick<TestArtifact, 'kind' | 'mediaType'>,
): ArtifactViewerKind {
  if (
    artifact.mediaType?.startsWith('image/') ||
    artifact.kind === 'screenshot'
  )
    return 'image'
  if (artifact.mediaType?.startsWith('video/') || artifact.kind === 'recording')
    return 'video'
  if (artifact.mediaType?.startsWith('text/') || artifact.kind === 'device-log')
    return 'text'
  return 'download'
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
  const query = filter.query?.trim().toLocaleLowerCase()
  return diagnostics.filter(
    (entry) =>
      (!query ||
        [
          entry.message,
          entry.source,
          entry.occurredAt,
          entry.level,
          entry.origin,
          entry.stream,
          entry.scenarioId,
          entry.scenarioName,
          entry.stepIndex,
          entry.stepText,
          entry.executionTargetProfileId,
        ]
          .filter(Boolean)
          .join('\n')
          .toLocaleLowerCase()
          .includes(query)) &&
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

export function diagnosticPage(
  diagnostics: readonly DiagnosticEvidence[],
  requestedPage: number,
  pageSize = 100,
): DiagnosticPage {
  const safePageSize = Math.max(1, Math.floor(pageSize))
  const pageCount = Math.max(1, Math.ceil(diagnostics.length / safePageSize))
  const page = Math.min(Math.max(0, Math.floor(requestedPage)), pageCount - 1)
  const start = page * safePageSize
  const entries = diagnostics.slice(start, start + safePageSize)
  return {
    entries,
    page,
    pageCount,
    first: entries.length === 0 ? 0 : start + 1,
    last: start + entries.length,
  }
}

export function recoveryGuidance(
  state: Exclude<EvidenceAvailability['state'], 'available'>,
): string {
  return evidenceRecoveryGuidance[state]
}

export function artifactLoadFailureGuidance(
  failure: ArtifactLoadFailure,
): string {
  return artifactLoadGuidance[failure]
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

export function artifactDownloadUrl(path: string, name?: string): string {
  const query = new URLSearchParams({ path, download: 'true' })
  if (name) query.set('name', name)
  return `/api/artifact?${query.toString()}`
}
