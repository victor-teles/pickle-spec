import type { StudioRunSnapshot } from '../../../server/contracts'
import {
  isAttemptInProgress,
  locationFromResult,
} from './live-result-projection'
import {
  causalTimelineEntry,
  defaultResultInspectorTab,
  findInspectedResult,
  timelineFor,
  visibleTimelineEntries,
} from './result-evidence'
import type { ResultInspectionLocation } from './result-inspection'
import { resultPriority } from './run-view'
import { timeTravelInspection } from './time-travel-inspection'

type LiveFollowState = {
  pinned: boolean
  following: boolean
  location?: ResultInspectionLocation
  specificationUri: string
  runId: string
}

type LiveFollowedEntryState = {
  following: boolean
  followedEntryId?: string
}

export function nextLiveLocation(
  state: LiveFollowState,
  snapshot: StudioRunSnapshot,
): ResultInspectionLocation | undefined {
  if (state.pinned && state.location) {
    return withFollowedTab(state.location, snapshot, state.following)
  }
  const candidates = candidateLocations(state, snapshot)
  if (candidates.length === 0) return state.location
  const attention = worstAttentionLocation(snapshot, candidates)
  if (attention) return withFollowedTab(attention, snapshot, state.following)
  if (!state.following && state.location) return state.location
  const selected = candidates.at(-1) ?? state.location
  return selected
    ? withFollowedTab(selected, snapshot, state.following)
    : state.location
}

export function defaultRunAttemptLocation(
  snapshot: StudioRunSnapshot,
): ResultInspectionLocation | undefined {
  return nextLiveLocation(
    {
      pinned: false,
      following: true,
      specificationUri: '',
      runId: snapshot.id,
    },
    snapshot,
  )
}

export function nextFollowedEntryId(
  state: LiveFollowedEntryState,
  snapshot: StudioRunSnapshot,
  location: ResultInspectionLocation | undefined,
): string | undefined {
  if (!state.following || !location) return state.followedEntryId
  const inspected = findInspectedResult(snapshot, location)
  if (!inspected) return state.followedEntryId
  const entries = visibleTimelineEntries(
    timelineFor(
      snapshot.events,
      inspected.attempt,
      location,
      timeTravelInspection(snapshot, location),
    ),
    'essential',
  )
  const causal = causalTimelineEntry(entries)
  return causal?.id ?? entries.at(-1)?.id ?? state.followedEntryId
}

function candidateLocations(
  state: LiveFollowState,
  snapshot: StudioRunSnapshot,
): ResultInspectionLocation[] {
  return (snapshot.manifest?.results ?? []).flatMap((result) =>
    result.attempts.map((attempt) =>
      locationFromResult(state.specificationUri, state.runId, result, attempt),
    ),
  )
}

function worstAttentionLocation(
  snapshot: StudioRunSnapshot,
  locations: readonly ResultInspectionLocation[],
): ResultInspectionLocation | undefined {
  const [worst] = [...locations].sort((left, right) => {
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
  const worstState = worst
    ? findInspectedResult(snapshot, worst)?.attempt.state
    : undefined
  if (worstState === 'failed' || worstState === 'infrastructure-error') {
    return worst
  }
  return undefined
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
