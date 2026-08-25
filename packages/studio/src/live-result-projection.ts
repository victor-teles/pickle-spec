import type {
  EvidenceAvailability,
  RunEvent,
  ScenarioAttempt,
  TestResult,
  TestResultState,
  TestStepResult,
} from '@pickle-spec/runner'
import type { ResultInspectionLocation } from './result-inspection'
import type { MatrixCell } from './run-view'
import type { StudioRunSnapshot } from './server'

export const liveAttemptIncompleteMessage =
  'This Scenario attempt is still running.'

const liveEvidenceKinds = [
  'screenshot',
  'trace',
  'recording',
  'device-log',
  'diagnostics',
] as const

const unknownStartedAt = new Date(0).toISOString()

const stateRank: Record<TestResultState, number> = {
  skipped: 0,
  passed: 1,
  cancelled: 2,
  failed: 3,
  'infrastructure-error': 4,
}

type ProjectLiveSnapshotInput = {
  runId: string
  specificationUri: string
  phase: 'idle' | 'running' | 'finished'
  events: RunEvent[]
  liveDiagnostics?: Array<{
    profileId: string
    scope?: AttemptEventScope
    diagnostic: import('@pickle-spec/runner').DiagnosticEntry
  }>
}

type AttemptEventScope = Extract<
  RunEvent,
  { type: 'scenario-started' }
>['scope']

export function isAttemptInProgress(attempt: ScenarioAttempt): boolean {
  return attempt.evidenceAvailability.some(isIncompleteLiveEvidence)
}

export function displayedAttemptState(
  attempt: ScenarioAttempt,
): TestResultState | 'running' {
  return isAttemptInProgress(attempt) ? 'running' : attempt.state
}

export function cellsFromLiveSnapshot(
  snapshot: StudioRunSnapshot | undefined,
): MatrixCell[] {
  return (snapshot?.manifest?.results ?? []).map((result) => {
    const attempt = result.attempts.at(-1)
    return {
      scenarioId: result.scenario.id ?? result.scenario.name,
      scenarioName: result.scenario.name,
      profileId: result.executionTargetProfile.id,
      state: attempt ? displayedAttemptState(attempt) : 'running',
    }
  })
}

export function projectLiveSnapshot(
  input: ProjectLiveSnapshotInput,
): StudioRunSnapshot {
  const results = projectResults(input)
  const started = input.events.find((event) => event.type === 'run-started')
  const startedAt =
    started?.type === 'run-started'
      ? started.run.startedAt
      : (input.events[0]?.occurredAt ?? unknownStartedAt)
  const lastOccurredAt = input.events.at(-1)?.occurredAt
  return {
    id: input.runId,
    events: input.events,
    manifest: {
      schemaVersion: 2,
      id: input.runId,
      startedAt,
      finishedAt: input.phase === 'finished' ? lastOccurredAt : undefined,
      state: aggregateState(results),
      results,
    },
  }
}

export function locationFromResult(
  specificationUri: string,
  runId: string,
  result: TestResult,
  attempt: ScenarioAttempt,
): ResultInspectionLocation {
  return {
    specificationUri: result.specification.uri || specificationUri,
    runId,
    scenarioId: result.scenario.id ?? result.scenario.name,
    examplesRowId: result.scenario.examplesRowId,
    profileId: result.executionTargetProfile.id,
    attempt: attempt.attempt,
  }
}

function isIncompleteLiveEvidence(item: EvidenceAvailability): boolean {
  return (
    item.state === 'missing' && item.message === liveAttemptIncompleteMessage
  )
}

function liveEvidenceAvailability(
  steps: readonly TestStepResult[],
): ScenarioAttempt['evidenceAvailability'] {
  const persistedKinds = new Set(
    steps.flatMap((step) => [
      ...(step.artifacts ?? []).map((artifact) => artifact.kind),
      ...(step.diagnostics?.length ? ['diagnostics' as const] : []),
      ...(step.trace?.length ? ['trace' as const] : []),
    ]),
  )
  const diagnosticsAvailable =
    persistedKinds.has('diagnostics') ||
    steps.some((step) => Boolean(step.message))
  const traceAvailable = steps.some(
    (step) => Boolean(step.trace?.length) || step.resolvedActions.length > 0,
  )
  return liveEvidenceKinds.map((kind) => {
    const available =
      kind === 'diagnostics'
        ? diagnosticsAvailable
        : kind === 'trace'
          ? traceAvailable || persistedKinds.has(kind)
          : persistedKinds.has(kind)
    return available
      ? { kind, state: 'available' as const }
      : {
          kind,
          state: 'missing' as const,
          message: liveAttemptIncompleteMessage,
        }
  })
}

function projectResults(input: ProjectLiveSnapshotInput): TestResult[] {
  const liveDiagnostics = input.liveDiagnostics ?? []
  const finishedKeys = new Set<string>()
  const finished = new Map<string, TestResult>()
  for (const event of input.events) {
    if (event.type !== 'scenario-finished') continue
    finishedKeys.add(attemptKey(event.scope))
    const identity = resultIdentityKey(event.scope)
    const existing = finished.get(identity)
    if (existing) {
      const attempts = [...existing.attempts, event.attempt].sort(
        (left, right) => left.attempt - right.attempt,
      )
      const final = attempts.at(-1)
      if (!final) continue
      finished.set(identity, {
        ...existing,
        attempts,
        state: final.state,
        finishedAt: final.finishedAt,
        durationMs: Math.max(
          0,
          Date.parse(final.finishedAt) - Date.parse(existing.startedAt),
        ),
      })
      continue
    }
    finished.set(identity, {
      schemaVersion: 2,
      specification: event.specification,
      scenario: event.scenario,
      executionTargetProfile: event.executionTargetProfile,
      state: event.attempt.state,
      startedAt: event.attempt.startedAt,
      finishedAt: event.attempt.finishedAt,
      durationMs: event.attempt.durationMs,
      attempts: [event.attempt],
    })
  }
  const inProgress: TestResult[] = []
  for (const event of input.events) {
    if (event.type !== 'scenario-started') continue
    if (finishedKeys.has(attemptKey(event.scope))) continue
    const steps = inProgressSteps(input.events, event, liveDiagnostics)
    const latest = steps.at(-1)
    const durationMs = latest
      ? Math.max(
          0,
          Date.parse(latest.finishedAt) - Date.parse(event.occurredAt),
        )
      : 0
    const finishedAt = latest?.finishedAt ?? event.occurredAt
    inProgress.push({
      schemaVersion: 2,
      specification: {
        name: input.specificationUri,
        uri: input.specificationUri,
      },
      scenario: event.scenario,
      executionTargetProfile: event.executionTargetProfile,
      state: latest?.state ?? 'passed',
      startedAt: event.occurredAt,
      finishedAt,
      durationMs,
      attempts: [
        {
          attempt: event.scope.attempt,
          startedAt: event.occurredAt,
          finishedAt,
          durationMs,
          state: latest?.state ?? 'passed',
          steps,
          evidenceAvailability: liveEvidenceAvailability(steps),
          diagnostics: liveDiagnostics
            .filter(
              (entry) =>
                entry.scope &&
                sameAttemptScope(entry.scope, event.scope) &&
                entry.diagnostic.stepIndex === undefined,
            )
            .map((entry) => entry.diagnostic),
        },
      ],
    })
  }
  return [...finished.values(), ...inProgress]
}

function inProgressSteps(
  events: readonly RunEvent[],
  started: Extract<RunEvent, { type: 'scenario-started' }>,
  liveDiagnostics: NonNullable<ProjectLiveSnapshotInput['liveDiagnostics']>,
): TestStepResult[] {
  const completed = events.flatMap((event) =>
    event.type === 'step-finished' &&
    sameAttemptScope(event.scope, started.scope)
      ? [event.result]
      : [],
  )
  const activeStep = events.findLast(
    (event) =>
      event.type === 'step-started' &&
      sameAttemptScope(event.scope, started.scope) &&
      !completed.some(
        (step) => step.index === (event.scope.stepIndex ?? step.index),
      ),
  )
  if (activeStep?.type !== 'step-started') return completed
  const diagnostics = liveDiagnostics
    .filter(
      (entry) =>
        entry.scope &&
        sameAttemptScope(entry.scope, started.scope) &&
        entry.diagnostic.stepIndex === activeStep.scope.stepIndex,
    )
    .map((entry) => entry.diagnostic)
  const finishedAt = diagnostics.at(-1)?.occurredAt ?? activeStep.occurredAt
  return [
    ...completed,
    {
      index: activeStep.scope.stepIndex ?? completed.length,
      startedAt: activeStep.occurredAt,
      finishedAt,
      durationMs: Math.max(
        0,
        Date.parse(finishedAt) - Date.parse(activeStep.occurredAt),
      ),
      step: activeStep.step,
      state: 'passed',
      resolvedActions: [],
      diagnostics: diagnostics.length > 0 ? diagnostics : undefined,
    },
  ]
}

function sameAttemptScope(
  left: AttemptEventScope,
  right: AttemptEventScope,
): boolean {
  return (
    left.scenarioId === right.scenarioId &&
    left.examplesRowId === right.examplesRowId &&
    left.executionTargetProfileId === right.executionTargetProfileId &&
    left.attempt === right.attempt
  )
}

function attemptKey(scope: AttemptEventScope): string {
  return identityKey(
    scope.scenarioId,
    scope.examplesRowId,
    scope.executionTargetProfileId,
    String(scope.attempt),
  )
}

function resultIdentityKey(scope: AttemptEventScope): string {
  return identityKey(
    scope.scenarioId,
    scope.examplesRowId,
    scope.executionTargetProfileId,
  )
}

function identityKey(...parts: Array<string | undefined>): string {
  return parts.map((part) => part ?? '').join('\u0000')
}

function aggregateState(results: readonly TestResult[]): TestResultState {
  return results.reduce<TestResultState>(
    (state, result) =>
      stateRank[result.state] > stateRank[state] ? result.state : state,
    'skipped',
  )
}
