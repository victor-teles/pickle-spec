import type {
  DiagnosticEntry,
  RunEvent,
  ScheduledTestResult,
} from '@pickle-spec/runner'
import type {
  StudioLiveDiagnosticEvent,
  StudioRunSnapshot,
} from '../../../server/contracts'
import {
  liveViewportTargetKey,
  type StudioLiveViewport,
  type StudioLiveViewportEvent,
} from '../live-viewport'
import { nextFollowedEntryId, nextLiveLocation } from './live-result-follow'
import {
  cellsFromLiveSnapshot,
  locationFromResult,
  projectLiveSnapshot,
} from './live-result-projection'
import type {
  ResultInspectionLocation,
  ResultInspectorTab,
} from './result-inspection'
import type { MatrixCell } from './run-view'

export {
  displayedAttemptState,
  isAttemptInProgress,
  liveAttemptIncompleteMessage,
} from './live-result-projection'

export type LiveStreamEvent =
  | RunEvent
  | StudioLiveViewportEvent
  | StudioLiveDiagnosticEvent
  | { type: 'run-scheduled'; schedule: readonly ScheduledTestResult[] }
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
  schedule: readonly ScheduledTestResult[]
  liveDiagnostics: Array<{
    profileId: string
    scope?: StudioLiveDiagnosticEvent['scope']
    diagnostic: DiagnosticEntry
  }>
  liveViewports: ReadonlyMap<string, StudioLiveViewport>
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

type LiveCellIdentity = {
  scenarioId: string
  profileId: string
}

export function startLiveInspection(
  input: StartLiveInspectionInput,
): LiveResultInspection {
  return {
    specificationUri: input.specificationUri,
    runId: input.runId,
    phase: 'running',
    events: [],
    schedule: [],
    liveDiagnostics: [],
    liveViewports: new Map(),
    connection: { kind: 'connected' },
    following: true,
    pinned: false,
  }
}

export function liveInspectionFromSnapshot(
  snapshot: StudioRunSnapshot,
  specificationUri: string,
): LiveResultInspection {
  let inspection = startLiveInspection({
    runId: snapshot.id,
    specificationUri,
  })
  if (snapshot.schedule) {
    inspection = receiveLiveStreamEvent(inspection, {
      type: 'run-scheduled',
      schedule: snapshot.schedule,
    })
  }
  for (const event of snapshot.events) {
    inspection = receiveLiveStreamEvent(inspection, event)
  }
  return inspection
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
    followedEntryId: inspection.snapshot
      ? nextFollowedEntryId({ following: true }, inspection.snapshot, location)
      : undefined,
    location,
    pinned: true,
  }
}

export function inspectLiveTimelineEntry(
  inspection: LiveResultInspection,
  entryId: string,
): LiveResultInspection {
  if (!inspection.location) return inspection
  return {
    ...inspection,
    followedEntryId: entryId,
    following: false,
    pinned: true,
  }
}

export function selectLiveInspectorTab(
  inspection: LiveResultInspection,
  tab: ResultInspectorTab,
): LiveResultInspection {
  if (!inspection.location) return inspection
  return pauseLiveFollowing({
    ...inspection,
    location: { ...inspection.location, tab },
  })
}

export function cellsFromLiveInspection(
  inspection: LiveResultInspection,
): MatrixCell[] {
  return cellsFromLiveSnapshot(inspection.snapshot)
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
    locationFromResult(
      inspection.specificationUri,
      inspection.runId,
      match,
      attempt,
    ),
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
  return withSnapshot(
    {
      ...inspection,
      events: snapshot.events,
      liveDiagnostics: [],
      liveViewports: new Map(),
      phase: 'finished',
      connection: { kind: 'connected' },
    },
    snapshot,
  )
}

export function receiveLiveStreamEvent(
  inspection: LiveResultInspection,
  event: LiveStreamEvent,
): LiveResultInspection {
  if (event.type === 'run-finished') {
    return withProjectedSnapshot({
      ...inspection,
      phase: 'finished',
      liveViewports: new Map(),
    })
  }
  if (event.type === 'run-scheduled') {
    return withProjectedSnapshot({ ...inspection, schedule: event.schedule })
  }
  if (event.type === 'diagnostic-recorded') {
    return withProjectedSnapshot({
      ...inspection,
      liveDiagnostics: [
        ...inspection.liveDiagnostics,
        {
          profileId: event.profileId,
          scope: event.scope,
          diagnostic: event.diagnostic,
        },
      ],
    })
  }
  if (event.type === 'viewport-updated') {
    const liveViewports = new Map(inspection.liveViewports)
    liveViewports.set(liveViewportTargetKey(event.target), event.viewport)
    return { ...inspection, liveViewports }
  }
  if (event.type === 'viewport-closed') {
    const liveViewports = new Map(inspection.liveViewports)
    liveViewports.delete(liveViewportTargetKey(event.target))
    return { ...inspection, liveViewports }
  }
  const events = insertRunEvent(inspection.events, event)
  return withProjectedSnapshot({
    ...inspection,
    events,
    connection: connectionFrom(events),
  })
}

export function liveViewportFor(
  inspection: LiveResultInspection,
  location: ResultInspectionLocation,
): StudioLiveViewport | undefined {
  return inspection.liveViewports.get(
    liveViewportTargetKey({
      scenarioId: location.scenarioId,
      examplesRowId: location.examplesRowId,
      profileId: location.profileId,
    }),
  )
}

function insertRunEvent(
  events: readonly RunEvent[],
  event: RunEvent,
): RunEvent[] {
  if (events.some((item) => item.sequence === event.sequence)) {
    return [...events]
  }
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
  return withSnapshot(
    inspection,
    projectLiveSnapshot({ ...inspection, schedule: inspection.schedule }),
  )
}

function withSnapshot(
  inspection: LiveResultInspection,
  snapshot: StudioRunSnapshot,
): LiveResultInspection {
  const location = nextLiveLocation(inspection, snapshot)
  return {
    ...inspection,
    snapshot,
    location,
    followedEntryId: nextFollowedEntryId(inspection, snapshot, location),
  }
}
