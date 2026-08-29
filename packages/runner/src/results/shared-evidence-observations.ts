import type {
  DiagnosticEntry,
  RunEvent,
  SharedEvidenceCacheDecisionType,
  SharedEvidenceObservation,
  SharedEvidenceTiming,
  SharedEvidenceVersionObservation,
  TestArtifact,
  TestResultState,
  TraceEntry,
} from '../execution/run-scenario-types'
import {
  sharedEvidenceObservationVersion,
  testRunSchemaVersion,
} from '../execution/run-scenario-types'
import type {
  ExecutionCacheKey,
  ExecutionCacheUncacheableReason,
} from '../execution-cache/execution-cache'

function contractVersionObservation(): SharedEvidenceVersionObservation {
  return {
    subject: 'contract',
    label: 'run-event-schema',
    value: String(testRunSchemaVersion),
  }
}

function cacheVersionObservations(
  cacheKey: ExecutionCacheKey | undefined,
): SharedEvidenceVersionObservation[] | undefined {
  if (!cacheKey) return undefined
  return [
    contractVersionObservation(),
    {
      subject: 'scenario',
      label: 'revision',
      value: cacheKey.scenarioRevision,
    },
    {
      subject: 'application',
      label: 'revision',
      value: cacheKey.applicationRevision,
    },
    {
      subject: 'adapter',
      label: 'cache-schema',
      value: cacheKey.adapterCacheSchemaVersion,
    },
  ]
}

function timing(input: SharedEvidenceTiming): SharedEvidenceTiming {
  return input
}

function stepOutcomeSummary(stepText: string, state: TestResultState) {
  return `${stepText} ${state}`
}

function attemptOutcomeSummary(
  scenarioName: string,
  state: TestResultState,
  executionMode: string | undefined,
) {
  if (!executionMode) return `${scenarioName} ${state}`
  return `${scenarioName} ${state} in ${executionMode} mode`
}

function cacheDecisionSummary(
  type: SharedEvidenceCacheDecisionType,
  reason: ExecutionCacheUncacheableReason | undefined,
) {
  if (type === 'cache-uncacheable' && reason) {
    return `Execution cache uncacheable: ${reason}`
  }
  return type
    .split('-')
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(' ')
}

function observation(
  input: Omit<SharedEvidenceObservation, 'version'>,
): SharedEvidenceObservation {
  return {
    version: sharedEvidenceObservationVersion,
    ...input,
  }
}

function diagnosticObservation(
  diagnostic: DiagnosticEntry,
  precision: SharedEvidenceTiming['precision'],
): SharedEvidenceObservation {
  return observation({
    kind: 'diagnostic',
    summary: diagnostic.message,
    timing: timing({
      occurredAt: diagnostic.occurredAt,
      precision,
      causalAt: diagnostic.causalAt,
    }),
    outcome: {
      level: diagnostic.level,
      message: diagnostic.message,
    },
  })
}

function traceObservation(
  entry: TraceEntry,
  stepTiming: {
    startedAt: string
    finishedAt: string
    durationMs: number
  },
): SharedEvidenceObservation {
  return observation({
    kind: 'activity',
    summary: entry.description,
    timing: timing({
      occurredAt: entry.occurredAt,
      precision: 'exact',
      startedAt: stepTiming.startedAt,
      finishedAt: stepTiming.finishedAt,
      durationMs: stepTiming.durationMs,
      causalAt: entry.causalAt,
    }),
    activity: {
      kind: entry.kind,
      description: entry.description,
    },
  })
}

function resolvedActionObservation(
  description: string,
  stepTiming: {
    occurredAt: string
    startedAt: string
    finishedAt: string
    durationMs: number
  },
): SharedEvidenceObservation {
  return observation({
    kind: 'activity',
    summary: description,
    timing: timing({
      occurredAt: stepTiming.occurredAt,
      precision: 'step-finish',
      startedAt: stepTiming.startedAt,
      finishedAt: stepTiming.finishedAt,
      durationMs: stepTiming.durationMs,
    }),
    activity: {
      kind: 'resolved-action',
      description,
    },
  })
}

function artifactObservation(
  artifact: TestArtifact,
  occurredAt: string,
  precision: SharedEvidenceTiming['precision'],
): SharedEvidenceObservation {
  return observation({
    kind: 'artifact',
    summary: `Captured ${artifact.kind}`,
    timing: timing({
      occurredAt,
      precision,
    }),
    artifact,
  })
}

function stepOutcomeObservation(
  event: Extract<RunEvent, { type: 'step-finished' }>,
) {
  const stepText = `${event.result.step.keyword.trim()} ${event.result.step.text}`
  return observation({
    kind: 'outcome',
    summary: stepOutcomeSummary(stepText, event.result.state),
    timing: timing({
      occurredAt: event.result.finishedAt,
      precision: 'step-finish',
      startedAt: event.result.startedAt,
      finishedAt: event.result.finishedAt,
      durationMs: event.result.durationMs,
    }),
    outcome: {
      state: event.result.state,
      message: event.result.message,
    },
  })
}

function attemptOutcomeObservation(
  event: Extract<RunEvent, { type: 'scenario-finished' }>,
): SharedEvidenceObservation {
  return observation({
    kind: 'outcome',
    summary: attemptOutcomeSummary(
      event.scenario.name,
      event.attempt.state,
      event.attempt.executionMode,
    ),
    timing: timing({
      occurredAt: event.attempt.finishedAt,
      precision: 'attempt-finish',
      startedAt: event.attempt.startedAt,
      finishedAt: event.attempt.finishedAt,
      durationMs: event.attempt.durationMs,
    }),
    versions: [contractVersionObservation()],
    outcome: {
      state: event.attempt.state,
      message: event.attempt.message,
    },
    cost: {
      inferenceCount: event.attempt.inferenceCount ?? 0,
    },
    execution: {
      mode: event.attempt.executionMode,
      cacheOutcome: event.attempt.cacheOutcome,
    },
  })
}

function cacheObservation(
  event:
    | Extract<
        RunEvent,
        {
          type:
            | 'cache-hit'
            | 'cache-miss'
            | 'cache-refresh'
            | 'replay-diverged'
            | 'adaptive-fallback-started'
            | 'cache-written'
        }
      >
    | Extract<RunEvent, { type: 'cache-uncacheable' }>,
): SharedEvidenceObservation {
  return observation({
    kind: 'cache',
    summary: cacheDecisionSummary(
      event.type,
      event.type === 'cache-uncacheable' ? event.reason : undefined,
    ),
    timing: timing({
      occurredAt: event.occurredAt,
      precision: 'exact',
    }),
    versions: cacheVersionObservations(
      'cacheKey' in event ? event.cacheKey : undefined,
    ),
    execution: {
      cacheDecision: {
        type: event.type,
        reason: event.type === 'cache-uncacheable' ? event.reason : undefined,
        cacheKey: 'cacheKey' in event ? event.cacheKey : undefined,
      },
    },
  })
}

function inferenceObservation(
  event: Extract<RunEvent, { type: 'inference-count-updated' }>,
): SharedEvidenceObservation {
  return observation({
    kind: 'outcome',
    summary: `Inference count updated to ${event.inferenceCount}`,
    timing: timing({
      occurredAt: event.occurredAt,
      precision: 'exact',
    }),
    versions: [contractVersionObservation()],
    cost: {
      inferenceCount: event.inferenceCount,
    },
  })
}

function stepActivityObservations(
  event: Extract<RunEvent, { type: 'step-finished' }>,
): SharedEvidenceObservation[] {
  if (event.result.trace?.length) {
    return event.result.trace.map((entry) =>
      traceObservation(entry, {
        startedAt: event.result.startedAt,
        finishedAt: event.result.finishedAt,
        durationMs: event.result.durationMs,
      }),
    )
  }
  return event.result.resolvedActions.map((action) =>
    resolvedActionObservation(action.description, {
      occurredAt: event.result.finishedAt,
      startedAt: event.result.startedAt,
      finishedAt: event.result.finishedAt,
      durationMs: event.result.durationMs,
    }),
  )
}

function stepArtifactObservations(
  artifacts: readonly TestArtifact[] | undefined,
  event: Extract<RunEvent, { type: 'step-finished' }>,
): SharedEvidenceObservation[] {
  return (artifacts ?? []).map((artifact) =>
    artifactObservation(
      artifact,
      artifact.capturedAt ?? event.result.finishedAt,
      artifact.capturedAt ? 'exact' : 'step-finish',
    ),
  )
}

function attemptDiagnosticObservations(
  diagnostics: readonly DiagnosticEntry[] | undefined,
): SharedEvidenceObservation[] {
  return (diagnostics ?? []).map((entry) =>
    diagnosticObservation(entry, 'attempt-finish'),
  )
}

function stepDiagnosticObservations(
  diagnostics: readonly DiagnosticEntry[] | undefined,
): SharedEvidenceObservation[] {
  return (diagnostics ?? []).map((entry) =>
    diagnosticObservation(entry, 'exact'),
  )
}

export function sharedEvidenceObservationsForEvent(
  event: RunEvent,
): SharedEvidenceObservation[] | undefined {
  switch (event.type) {
    case 'step-finished':
      return [
        stepOutcomeObservation(event),
        ...stepActivityObservations(event),
        ...stepDiagnosticObservations(event.result.diagnostics),
        ...stepArtifactObservations(event.result.artifacts, event),
      ]
    case 'scenario-finished':
      return [
        attemptOutcomeObservation(event),
        ...attemptDiagnosticObservations(event.attempt.diagnostics),
      ]
    case 'cache-hit':
    case 'cache-miss':
    case 'cache-refresh':
    case 'replay-diverged':
    case 'adaptive-fallback-started':
    case 'cache-written':
    case 'cache-uncacheable':
      return [cacheObservation(event)]
    case 'inference-count-updated':
      return [inferenceObservation(event)]
    default:
      return undefined
  }
}

export function withSharedEvidenceObservations(event: RunEvent): RunEvent {
  const observations = sharedEvidenceObservationsForEvent(event)
  if (!observations?.length) return event
  return {
    ...event,
    observations,
  }
}
