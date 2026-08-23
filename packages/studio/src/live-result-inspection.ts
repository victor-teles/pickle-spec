import type {
  RunEvent,
  ScenarioAttempt,
  TestResult,
  TestResultState,
  TestStepResult,
} from '@pickle-spec/runner'
import {
  defaultResultInspectorTab,
  findInspectedResult,
  timelineFor,
} from './result-evidence'
import type { ResultInspectionLocation } from './result-inspection'
import { type MatrixCell, resultPriority } from './run-view'
import type { StudioRunSnapshot } from './server'

export type LiveStreamEvent =
  | RunEvent
  | { type: 'run-finished'; run: { id: string } }

export type LiveConnectionStatus =
  | { kind: 'connected' }
  | { kind: 'disconnected'; message: string }
  | {
      kind: 'event-loss'
      lastReceivedSequence: number
      receivedSequence: number
    }

export type LiveResultInspection = {
  specificationUri: string
  runId: string
  phase: 'idle' | 'running' | 'finished'
  events: RunEvent[]
  snapshot?: StudioRunSnapshot
  connection: LiveConnectionStatus
  following: boolean
  pinned: boolean
  location?: ResultInspectionLocation
  followedEntryId?: string
}

type StartLiveInspectionInput = {
  specificationUri: string
  runId: string
}

type AttemptKey = {
  scenarioId: string
  examplesRowId?: string
  profileId: string
  attempt: number
}

export const liveAttemptIncompleteMessage =
  'This Scenario attempt is still running.'

const liveEvidenceKinds = [
  'screenshot',
  'trace',
  'recording',
  'device-log',
  'diagnostics',
] as const

function liveEvidenceAvailability(
  steps: readonly TestStepResult[],
): ScenarioAttempt['evidenceAvailability'] {
  const artifactKinds = new Set(
    steps.flatMap((step) =>
      (step.artifacts ?? []).map((artifact) => artifact.kind),
    ),
  )
  const diagnosticsAvailable = steps.some((step) => Boolean(step.message))
  return liveEvidenceKinds.map((kind) => {
    if (kind === 'diagnostics') {
      return diagnosticsAvailable
        ? { kind, state: 'available' as const }
        : {
            kind,
            state: 'missing' as const,
            message: liveAttemptIncompleteMessage,
          }
    }
    return artifactKinds.has(kind)
      ? { kind, state: 'available' as const }
      : {
          kind,
          state: 'missing' as const,
          message: liveAttemptIncompleteMessage,
        }
  })
}

const stateRank: Record<TestResultState, number> = {
  skipped: 0,
  passed: 1,
  cancelled: 2,
  failed: 3,
  'infrastructure-error': 4,
}

export function startLiveInspection(
  input: StartLiveInspectionInput,
): LiveResultInspection {
  return {
    specificationUri: input.specificationUri,
    runId: input.runId,
    phase: 'running',
    events: [],
    connection: { kind: 'connected' },
    following: true,
    pinned: false,
  }
}

export function pauseLiveFollowing(
  inspection: LiveResultInspection,
): LiveResultInspection {
  return { ...inspection, following: false }
}

export function resumeLiveFollowing(
  inspection: LiveResultInspection,
): LiveResultInspection {
  return withProjectedSnapshot({ ...inspection, following: true })
}

export function pinLiveInvestigation(
  inspection: LiveResultInspection,
  location: ResultInspectionLocation,
): LiveResultInspection {
  return {
    ...inspection,
    location,
    pinned: true,
  }
}

export function isAttemptInProgress(attempt: ScenarioAttempt): boolean {
  return attempt.evidenceAvailability.some(
    (item) =>
      item.state === 'missing' && item.message === liveAttemptIncompleteMessage,
  )
}

export function displayedAttemptState(
  attempt: ScenarioAttempt,
): TestResultState | 'running' {
  return isAttemptInProgress(attempt) ? 'running' : attempt.state
}

export function cellsFromLiveInspection(
  inspection: LiveResultInspection,
): MatrixCell[] {
  return (inspection.snapshot?.manifest?.results ?? []).map((result) => {
    const attempt = result.attempts.at(-1)
    return {
      scenarioId: result.scenario.id ?? result.scenario.name,
      scenarioName: result.scenario.name,
      profileId: result.executionTargetProfile.id,
      state: attempt ? displayedAttemptState(attempt) : 'running',
    }
  })
}

type LiveCellIdentity = {
  scenarioId: string
  profileId: string
}

export function pinLiveCell(
  inspection: LiveResultInspection,
  cell: LiveCellIdentity,
): LiveResultInspection {
  const match = inspection.snapshot?.manifest?.results.find(
    (result) =>
      (result.scenario.id ?? result.scenario.name) === cell.scenarioId &&
      result.executionTargetProfile.id === cell.profileId,
  )
  const attempt = match?.attempts.at(-1)
  if (!match || !attempt) return { ...inspection, pinned: true }
  return pinLiveInvestigation(
    inspection,
    locationFrom(inspection.specificationUri, inspection.runId, match, attempt),
  )
}

export function disconnectLiveInspection(
  inspection: LiveResultInspection,
  message: string,
): LiveResultInspection {
  return {
    ...inspection,
    connection: { kind: 'disconnected', message },
  }
}

export function hydrateLiveInspection(
  inspection: LiveResultInspection,
  snapshot: StudioRunSnapshot,
): LiveResultInspection {
  const next = {
    ...inspection,
    events: snapshot.events,
    snapshot,
    phase: 'finished' as const,
    connection: { kind: 'connected' as const },
  }
  const location = nextLocation(next, snapshot)
  return {
    ...next,
    location,
    followedEntryId: nextFollowedEntryId(next, snapshot, location),
  }
}

export function receiveLiveStreamEvent(
  inspection: LiveResultInspection,
  event: LiveStreamEvent,
): LiveResultInspection {
  if (event.type === 'run-finished') {
    return withProjectedSnapshot({ ...inspection, phase: 'finished' })
  }
  const events = insertRunEvent(inspection.events, event)
  return withProjectedSnapshot({
    ...inspection,
    events,
    connection: connectionFrom(events),
  })
}

function insertRunEvent(
  events: readonly RunEvent[],
  event: RunEvent,
): RunEvent[] {
  if (events.some((item) => item.sequence === event.sequence))
    return [...events]
  return [...events, event].sort(
    (left, right) => left.sequence - right.sequence,
  )
}

function connectionFrom(events: readonly RunEvent[]): LiveConnectionStatus {
  const gap = sequenceGap(events)
  if (gap) {
    return {
      kind: 'event-loss',
      lastReceivedSequence: gap.lastReceivedSequence,
      receivedSequence: gap.receivedSequence,
    }
  }
  return { kind: 'connected' }
}

function sequenceGap(events: readonly RunEvent[]):
  | {
      lastReceivedSequence: number
      receivedSequence: number
    }
  | undefined {
  const first = events[0]
  if (first && first.sequence !== 1) {
    return {
      lastReceivedSequence: 0,
      receivedSequence: first.sequence,
    }
  }
  for (let index = 1; index < events.length; index++) {
    const previous = events[index - 1]
    const current = events[index]
    if (!previous || !current) continue
    if (current.sequence !== previous.sequence + 1) {
      return {
        lastReceivedSequence: previous.sequence,
        receivedSequence: current.sequence,
      }
    }
  }
  return undefined
}

function withProjectedSnapshot(
  inspection: LiveResultInspection,
): LiveResultInspection {
  const snapshot = projectSnapshot(inspection)
  const location = nextLocation(inspection, snapshot)
  return {
    ...inspection,
    snapshot,
    location,
    followedEntryId: nextFollowedEntryId(inspection, snapshot, location),
  }
}

function nextFollowedEntryId(
  inspection: LiveResultInspection,
  snapshot: StudioRunSnapshot,
  location: ResultInspectionLocation | undefined,
): string | undefined {
  if (!inspection.following) return inspection.followedEntryId
  if (!location) return inspection.followedEntryId
  const inspected = findInspectedResult(snapshot, location)
  if (!inspected) return inspection.followedEntryId
  const entries = timelineFor(snapshot.events, inspected.attempt, location)
  const causal = entries.find((entry) => entry.causal)
  return causal?.id ?? entries.at(-1)?.id ?? inspection.followedEntryId
}

function projectSnapshot(inspection: LiveResultInspection): StudioRunSnapshot {
  const results = projectResults(inspection)
  const started = inspection.events.find(
    (event) => event.type === 'run-started',
  )
  const startedAt =
    started?.type === 'run-started'
      ? started.run.startedAt
      : (inspection.events[0]?.occurredAt ?? new Date(0).toISOString())
  const lastOccurredAt = inspection.events.at(-1)?.occurredAt
  return {
    id: inspection.runId,
    events: inspection.events,
    manifest: {
      schemaVersion: 2,
      id: inspection.runId,
      startedAt,
      finishedAt: inspection.phase === 'finished' ? lastOccurredAt : undefined,
      state: aggregateState(results),
      results,
    },
  }
}

function projectResults(inspection: LiveResultInspection): TestResult[] {
  const finishedKeys = new Set<string>()
  const finished: TestResult[] = []
  for (const event of inspection.events) {
    if (event.type !== 'scenario-finished') continue
    const key = attemptKey({
      scenarioId: event.scope.scenarioId,
      examplesRowId: event.scope.examplesRowId,
      profileId: event.scope.executionTargetProfileId,
      attempt: event.scope.attempt,
    })
    finishedKeys.add(key)
    const existing = finished.find(
      (result) => resultKey(result) === resultIdentity(event),
    )
    if (existing) {
      const attempts = [...existing.attempts, event.attempt].sort(
        (left, right) => left.attempt - right.attempt,
      )
      const final = attempts.at(-1)
      if (!final) continue
      finished[finished.indexOf(existing)] = {
        ...existing,
        attempts,
        state: final.state,
        finishedAt: final.finishedAt,
        durationMs: Math.max(
          0,
          Date.parse(final.finishedAt) - Date.parse(existing.startedAt),
        ),
      }
      continue
    }
    finished.push({
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
  for (const event of inspection.events) {
    if (event.type !== 'scenario-started') continue
    const key = attemptKey({
      scenarioId: event.scope.scenarioId,
      examplesRowId: event.scope.examplesRowId,
      profileId: event.scope.executionTargetProfileId,
      attempt: event.scope.attempt,
    })
    if (finishedKeys.has(key)) continue
    const steps = inProgressSteps(inspection.events, event)
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
        name: inspection.specificationUri,
        uri: inspection.specificationUri,
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
        },
      ],
    })
  }
  return [...finished, ...inProgress]
}

function inProgressSteps(
  events: readonly RunEvent[],
  started: Extract<RunEvent, { type: 'scenario-started' }>,
): TestStepResult[] {
  return events.flatMap((event) =>
    event.type === 'step-finished' &&
    event.scope.scenarioId === started.scope.scenarioId &&
    event.scope.examplesRowId === started.scope.examplesRowId &&
    event.scope.executionTargetProfileId ===
      started.scope.executionTargetProfileId &&
    event.scope.attempt === started.scope.attempt
      ? [event.result]
      : [],
  )
}

function nextLocation(
  inspection: LiveResultInspection,
  snapshot: StudioRunSnapshot,
): ResultInspectionLocation | undefined {
  if (inspection.pinned && inspection.location) {
    return withFollowedTab(inspection.location, snapshot, inspection.following)
  }
  const candidates = snapshot.manifest?.results.flatMap((result) =>
    result.attempts.map((attempt) =>
      locationFrom(
        inspection.specificationUri,
        inspection.runId,
        result,
        attempt,
      ),
    ),
  )
  if (!candidates?.length) return inspection.location
  const attention = [...candidates].sort((left, right) => {
    const leftResult = findInspectedResult(snapshot, left)
    const rightResult = findInspectedResult(snapshot, right)
    return (
      resultPriority(leftResult?.attempt.state ?? 'running') -
        resultPriority(rightResult?.attempt.state ?? 'running') ||
      (leftResult?.result.scenario.name ?? '').localeCompare(
        rightResult?.result.scenario.name ?? '',
      )
    )
  })
  const [worst] = attention
  const worstState = worst
    ? findInspectedResult(snapshot, worst)?.attempt.state
    : undefined
  if (
    worst &&
    (worstState === 'failed' || worstState === 'infrastructure-error')
  ) {
    return withFollowedTab(worst, snapshot, inspection.following)
  }
  if (!inspection.following && inspection.location) {
    return inspection.location
  }
  const selected = candidates.at(-1) ?? inspection.location
  return selected
    ? withFollowedTab(selected, snapshot, inspection.following)
    : inspection.location
}

function withFollowedTab(
  location: ResultInspectionLocation,
  snapshot: StudioRunSnapshot,
  following: boolean,
): ResultInspectionLocation {
  if (!following) return location
  const inspected = findInspectedResult(snapshot, location)
  if (!inspected) return location
  return {
    ...location,
    tab: isAttemptInProgress(inspected.attempt)
      ? 'timeline'
      : defaultResultInspectorTab(inspected.attempt.state),
  }
}

function locationFrom(
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

function attemptKey(input: AttemptKey): string {
  return [
    input.scenarioId,
    input.examplesRowId ?? '',
    input.profileId,
    String(input.attempt),
  ].join('\u0000')
}

function resultKey(result: TestResult): string {
  return [
    result.scenario.id ?? result.scenario.name,
    result.scenario.examplesRowId ?? '',
    result.executionTargetProfile.id,
  ].join('\u0000')
}

function resultIdentity(
  event: Extract<RunEvent, { type: 'scenario-finished' }>,
): string {
  return [
    event.scope.scenarioId,
    event.scope.examplesRowId ?? '',
    event.scope.executionTargetProfileId,
  ].join('\u0000')
}

function aggregateState(results: readonly TestResult[]): TestResultState {
  return results.reduce<TestResultState>(
    (state, result) =>
      stateRank[result.state] > stateRank[state] ? result.state : state,
    'skipped',
  )
}
