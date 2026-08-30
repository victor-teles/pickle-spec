import type {
  DiagnosticLevel,
  DiagnosticOrigin,
  EvidenceAvailability,
  RunEvent,
  ScenarioAttempt,
  TestArtifact,
  TestResult,
  TestResultState,
} from '@pickle-spec/runner'
import type { StudioRunSnapshot } from '../../../server/contracts'
import type {
  ResultInspectionLocation,
  ResultInspectorTab,
} from './result-inspection'
import type { TimeTravelAction } from './time-travel-inspection'

export type InspectedResult = {
  result: TestResult
  attempt: ScenarioAttempt
}

export type ArtifactEvidence = {
  artifact: TestArtifact
  index: number
  stepIndex: number
  stepText: string
  capturedAt: string
}

export type ArtifactViewerKind = 'image' | 'video' | 'text' | 'download'

export type DiagnosticEvidence = {
  id: string
  occurredAt: string
  timingPrecision: 'exact' | 'step-finish' | 'attempt-finish'
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

export type TimelineEntryKind =
  | 'Step'
  | 'Resolved action'
  | 'Browser activity'
  | 'Run event'
  | 'Diagnostic entry'
  | 'Test artifact'

export type TimelineEntryAttribute = {
  label: string
  value: string
}

export type TimelineEntry = {
  id: string
  startedAt: string
  finishedAt?: string
  timingPrecision: 'exact' | 'step-finish' | 'attempt-finish'
  kind: TimelineEntryKind
  title: string
  context?: string
  state?: TestResultState | DiagnosticLevel
  causalAt?: string
  causal?: boolean
  attributes: readonly TimelineEntryAttribute[]
  artifact?: TestArtifact
  artifacts?: readonly TestArtifact[]
  action?: TimeTravelAction
}

export type TimelineDensity = 'essential' | 'verbose'

type TimelineDensityEntry = Pick<TimelineEntry, 'kind' | 'causal'>

export function isEssentialTimelineEntry(entry: TimelineDensityEntry): boolean {
  switch (entry.kind) {
    case 'Step':
    case 'Diagnostic entry':
    case 'Test artifact':
      return true
    case 'Resolved action':
      return entry.causal === true
    case 'Browser activity':
    case 'Run event':
      return false
    default: {
      const exhaustive: never = entry.kind
      return exhaustive
    }
  }
}

export function visibleTimelineEntries<Entry extends TimelineDensityEntry>(
  entries: readonly Entry[],
  density: TimelineDensity,
): readonly Entry[] {
  switch (density) {
    case 'verbose':
      return entries
    case 'essential':
      return entries.filter(isEssentialTimelineEntry)
    default: {
      const exhaustive: never = density
      return exhaustive
    }
  }
}

export function timelineEntriesOfKinds<Entry extends TimelineDensityEntry>(
  entries: readonly Entry[],
  kinds: readonly TimelineEntryKind[],
): readonly Entry[] {
  const includedKinds = new Set(kinds)
  return entries.filter((entry) => includedKinds.has(entry.kind))
}

export function causalTimelineEntry(
  entries: readonly TimelineEntry[],
): TimelineEntry | undefined {
  return entries
    .filter((entry) => entry.causal)
    .sort((left, right) => {
      const leftDistance = Math.abs(
        Date.parse(left.startedAt) -
          Date.parse(left.causalAt ?? left.startedAt),
      )
      const rightDistance = Math.abs(
        Date.parse(right.startedAt) -
          Date.parse(right.causalAt ?? right.startedAt),
      )
      return leftDistance - rightDistance
    })[0]
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
  return attempt.steps
    .flatMap((step) =>
      (step.artifacts ?? []).map((artifact) => ({
        artifact,
        stepIndex: step.index,
        stepText: `${step.step.keyword.trim()} ${step.step.text}`,
        capturedAt: artifact.capturedAt ?? step.finishedAt,
      })),
    )
    .map((evidence, index) => ({ ...evidence, index }))
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

function appendStepMessages(
  diagnostics: DiagnosticEvidence[],
  attempt: ScenarioAttempt,
): void {
  for (const step of attempt.steps) {
    if (
      !step.message ||
      diagnostics.some(
        (diagnostic) =>
          diagnostic.message === step.message &&
          diagnostic.stepIndex === step.index,
      )
    ) {
      continue
    }
    diagnostics.push({
      id: `step-${step.index}-message`,
      occurredAt: step.finishedAt,
      timingPrecision: 'step-finish',
      level: 'error',
      origin: 'adapter',
      message: step.message,
      source: 'Step',
      stepIndex: step.index,
      stepText: `${step.step.keyword.trim()} ${step.step.text}`,
    })
  }
}

function appendAttemptMessage(
  diagnostics: DiagnosticEvidence[],
  attempt: ScenarioAttempt,
): void {
  if (
    !attempt.message ||
    diagnostics.some((diagnostic) => diagnostic.message === attempt.message)
  ) {
    return
  }
  diagnostics.push({
    id: 'attempt-message',
    occurredAt: attempt.finishedAt,
    timingPrecision: 'attempt-finish',
    level: 'error',
    origin: 'runner',
    message: attempt.message,
    source: 'Scenario attempt',
  })
}

export function diagnosticsFor(attempt: ScenarioAttempt): DiagnosticEvidence[] {
  const attemptDiagnostics: DiagnosticEvidence[] = (
    attempt.diagnostics ?? []
  ).map((entry, index) => ({
    ...entry,
    id: `attempt-${index}`,
    timingPrecision: 'exact',
    source: 'Scenario attempt',
  }))
  const stepDiagnostics: DiagnosticEvidence[] = attempt.steps.flatMap((step) =>
    (step.diagnostics ?? []).map((entry, index) => ({
      ...entry,
      id: `step-${step.index}-${index}`,
      timingPrecision: 'exact',
      source: 'Step' as const,
      stepIndex: entry.stepIndex ?? step.index,
      stepText:
        entry.stepText ?? `${step.step.keyword.trim()} ${step.step.text}`,
    })),
  )
  const diagnostics = [...attemptDiagnostics, ...stepDiagnostics]
  appendStepMessages(diagnostics, attempt)
  appendAttemptMessage(diagnostics, attempt)
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

function diagnosticTimelineEntry(
  diagnostic: DiagnosticEvidence,
  causalAt: string | undefined,
  entryId: (suffix: string) => string,
): TimelineEntry {
  return {
    id: entryId(`diagnostic-${diagnostic.id}`),
    startedAt: diagnostic.occurredAt,
    timingPrecision: diagnostic.timingPrecision,
    kind: 'Diagnostic entry',
    title: diagnostic.message,
    context: diagnostic.stepText ?? diagnostic.source,
    state: diagnostic.level,
    causalAt: diagnostic.causalAt,
    causal: Boolean(causalAt && diagnostic.causalAt === causalAt),
    attributes: [
      { label: 'Origin', value: diagnostic.origin },
      { label: 'Source', value: diagnostic.source },
      ...(diagnostic.stream
        ? [{ label: 'Stream', value: diagnostic.stream }]
        : []),
      ...(diagnostic.scenarioId
        ? [{ label: 'Scenario ID', value: diagnostic.scenarioId }]
        : []),
      ...(diagnostic.scenarioName
        ? [{ label: 'Scenario', value: diagnostic.scenarioName }]
        : []),
      ...(diagnostic.stepIndex === undefined
        ? []
        : [{ label: 'Step index', value: String(diagnostic.stepIndex) }]),
      ...(diagnostic.executionTargetProfileId
        ? [
            {
              label: 'Execution target',
              value: diagnostic.executionTargetProfileId,
            },
          ]
        : []),
    ],
  }
}

function artifactTimelineEntry(
  step: ScenarioAttempt['steps'][number],
  artifact: TestArtifact,
  index: number,
  entryId: (suffix: string) => string,
): TimelineEntry {
  return {
    id: entryId(`artifact-${step.index}-${index}`),
    startedAt: artifact.capturedAt ?? step.finishedAt,
    timingPrecision: artifact.capturedAt ? 'exact' : 'step-finish',
    kind: 'Test artifact',
    title: artifact.kind,
    context: `${step.step.keyword.trim()} ${step.step.text}`,
    artifact,
    attributes: [
      { label: 'Artifact kind', value: artifact.kind },
      { label: 'Step index', value: String(step.index) },
      ...(artifact.name ? [{ label: 'Name', value: artifact.name }] : []),
      ...(artifact.mediaType
        ? [{ label: 'Media type', value: artifact.mediaType }]
        : []),
      ...(artifact.sizeBytes === undefined
        ? []
        : [{ label: 'Size', value: `${artifact.sizeBytes} bytes` }]),
    ],
  }
}

interface TimelineContext {
  entryId: (suffix: string) => string
  causalStepId?: string
  causalAt?: string
  attemptRecordings: TestArtifact[]
}

function timelineContext(
  attempt: ScenarioAttempt,
  location: ResultInspectionLocation,
): TimelineContext {
  const scopeId = [
    location.runId,
    location.specificationUri,
    location.scenarioId,
    location.examplesRowId ?? '',
    location.profileId,
    location.attempt,
  ].join(':')
  const entryId = (suffix: string) => `${scopeId}:${suffix}`
  const failedStep = attempt.steps.find(
    (step) => step.state === 'failed' || step.state === 'infrastructure-error',
  )
  const causalEvidence = [
    ...(attempt.diagnostics ?? []),
    ...attempt.steps.flatMap((step) => [
      ...(step.diagnostics ?? []),
      ...(step.trace ?? []),
    ]),
  ]
    .filter((entry) => entry.causalAt)
    .sort(
      (left, right) =>
        Date.parse(left.occurredAt) - Date.parse(right.occurredAt),
    )
    .at(-1)
  return {
    entryId,
    causalStepId: failedStep ? entryId(`step-${failedStep.index}`) : undefined,
    causalAt: causalEvidence?.causalAt,
    attemptRecordings: artifactsFor(attempt)
      .filter((evidence) => evidence.artifact.kind === 'recording')
      .map((evidence) => evidence.artifact),
  }
}

function stepTimelineEntries(
  attempt: ScenarioAttempt,
  context: TimelineContext,
): TimelineEntry[] {
  return attempt.steps.map((step) => {
    const id = context.entryId(`step-${step.index}`)
    const own = step.artifacts ?? []
    const linked = [
      ...own,
      ...context.attemptRecordings.filter(
        (recording) =>
          (recording.evidenceLink === undefined ||
            recording.evidenceLink.stepIndex === step.index) &&
          !own.some((artifact) => artifact.path === recording.path),
      ),
    ]
    return {
      id,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      timingPrecision: 'exact' as const,
      kind: 'Step' as const,
      title: `${step.step.keyword.trim()} ${step.step.text}`,
      state: step.state,
      causalAt: context.causalStepId === id ? context.causalAt : undefined,
      causal: context.causalStepId === id && !context.causalAt,
      attributes: [{ label: 'Step index', value: String(step.index) }],
      artifacts: linked.length > 0 ? linked : undefined,
    }
  })
}

function traceTimelineEntry(
  step: ScenarioAttempt['steps'][number],
  entry: NonNullable<ScenarioAttempt['steps'][number]['trace']>[number],
  index: number,
  context: TimelineContext,
): TimelineEntry {
  return {
    id: context.entryId(`trace-${step.index}-${index}`),
    startedAt: entry.occurredAt,
    timingPrecision: 'exact',
    kind:
      entry.kind === 'resolved-action' ? 'Resolved action' : 'Browser activity',
    title: entry.description,
    context: `${step.step.keyword.trim()} ${step.step.text}`,
    causalAt: entry.causalAt,
    causal: Boolean(context.causalAt && entry.causalAt === context.causalAt),
    attributes: [{ label: 'Step index', value: String(step.index) }],
  }
}

function legacyActionEntries(
  step: ScenarioAttempt['steps'][number],
  context: TimelineContext,
): TimelineEntry[] {
  const stepId = context.entryId(`step-${step.index}`)
  return step.resolvedActions.map((action, index) => ({
    id: context.entryId(`trace-${step.index}-${index}`),
    startedAt: step.finishedAt,
    timingPrecision: 'step-finish',
    kind: 'Resolved action',
    title: action.description,
    context: `${step.step.keyword.trim()} ${step.step.text}`,
    causalAt: context.causalStepId === stepId ? context.causalAt : undefined,
    causal: context.causalStepId === stepId && !context.causalAt,
    attributes: [{ label: 'Step index', value: String(step.index) }],
  }))
}

function actionTimelineEntries(
  step: ScenarioAttempt['steps'][number],
  actions: readonly TimeTravelAction[],
  context: TimelineContext,
): TimelineEntry[] {
  const stepId = context.entryId(`step-${step.index}`)
  const resolvedTrace = (step.trace ?? []).filter(
    (entry) => entry.kind === 'resolved-action',
  )
  return actions.map((action) => {
    const evidence = action.evidence
    const causalAt = resolvedTrace[action.ordinal]?.causalAt
    return {
      id: context.entryId(`trace-${step.index}-${action.ordinal}`),
      startedAt: evidence?.startedAt ?? step.finishedAt,
      finishedAt: evidence?.finishedAt,
      timingPrecision: evidence ? 'exact' : 'step-finish',
      kind: 'Resolved action',
      title: action.description,
      context: `${step.step.keyword.trim()} ${step.step.text}`,
      state: evidence?.state,
      causalAt,
      causal: causalAt
        ? Boolean(context.causalAt && causalAt === context.causalAt)
        : context.causalStepId === stepId && !context.causalAt,
      attributes: [{ label: 'Step index', value: String(step.index) }],
      action,
    }
  })
}

function stepTraceTimelineEntries(
  step: ScenarioAttempt['steps'][number],
  actions: readonly TimeTravelAction[],
  context: TimelineContext,
): TimelineEntry[] {
  if (!step.trace && actions.length === 0) {
    return legacyActionEntries(step, context)
  }
  if (actions.length === 0) {
    return (step.trace ?? []).map((entry, index) =>
      traceTimelineEntry(step, entry, index, context),
    )
  }
  const browserEntries = (step.trace ?? []).flatMap((entry, index) =>
    entry.kind === 'resolved-action'
      ? []
      : [traceTimelineEntry(step, entry, index, context)],
  )
  return [...actionTimelineEntries(step, actions, context), ...browserEntries]
}

function traceTimelineEntries(
  attempt: ScenarioAttempt,
  context: TimelineContext,
  actions: readonly TimeTravelAction[],
): TimelineEntry[] {
  return attempt.steps.flatMap((step) =>
    stepTraceTimelineEntries(
      step,
      actions.filter((action) => action.scope.stepIndex === step.index),
      context,
    ),
  )
}

export function timelineFor(
  events: readonly RunEvent[],
  attempt: ScenarioAttempt,
  location: ResultInspectionLocation,
  actions: readonly TimeTravelAction[] = [],
): TimelineEntry[] {
  const context = timelineContext(attempt, location)
  const stepEntries = stepTimelineEntries(attempt, context)
  const eventEntries: TimelineEntry[] = scopedEvents(events, location).map(
    (event) => ({
      id: context.entryId(`event-${event.sequence}`),
      startedAt: event.occurredAt,
      timingPrecision: 'exact',
      kind: 'Run event',
      title: eventTitle(event),
      attributes: [{ label: 'Sequence', value: String(event.sequence) }],
    }),
  )
  const traceEntries = traceTimelineEntries(attempt, context, actions)
  const diagnosticEntries: TimelineEntry[] = diagnosticsFor(attempt).map(
    (diagnostic) =>
      diagnosticTimelineEntry(diagnostic, context.causalAt, context.entryId),
  )
  const artifactEntries: TimelineEntry[] = attempt.steps.flatMap((step) =>
    (step.artifacts ?? []).map((artifact, index) =>
      artifactTimelineEntry(step, artifact, index, context.entryId),
    ),
  )
  const kindOrder: Record<TimelineEntry['kind'], number> = {
    Step: 0,
    'Resolved action': 1,
    'Browser activity': 2,
    'Run event': 3,
    'Diagnostic entry': 4,
    'Test artifact': 5,
  }
  const entries = [
    ...stepEntries,
    ...traceEntries,
    ...eventEntries,
    ...diagnosticEntries,
    ...artifactEntries,
  ].sort(
    (left, right) =>
      Date.parse(left.startedAt) - Date.parse(right.startedAt) ||
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
