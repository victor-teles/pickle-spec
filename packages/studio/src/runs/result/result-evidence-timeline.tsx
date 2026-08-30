import type { TestResultState } from '@pickle-spec/runner'
import { useState } from 'react'
import { Button } from '../../components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { durationLabel } from '../run-format'
import {
  causalTimelineEntry,
  type TimelineEntry,
  type TimelineEntryKind,
  timelineEntriesOfKinds,
} from './result-evidence'
import { TimelineEvidenceDetail } from './timeline-evidence-detail'
import { TimelineKindFilter, timelineEntryKinds } from './timeline-kind'
import { TimelineWaterfall } from './timeline-waterfall'

type ResultEvidenceTimelineProps = {
  entries: readonly TimelineEntry[]
  startedAt: string
  durationMs: number
  state: TestResultState | 'running'
  scenarioName: string
  resultState: TestResultState
  follow?: boolean
  followedEntryId?: string
  onPauseFollowing?: () => void
}

function selectedTimelineEntry(
  entries: readonly TimelineEntry[],
  activeEntryId: string | undefined,
  causalEntry: TimelineEntry | undefined,
): TimelineEntry | undefined {
  return (
    entries.find((entry) => entry.id === activeEntryId) ??
    causalEntry ??
    entries.at(-1)
  )
}

interface TimelineDisplayProps extends ResultEvidenceTimelineProps {
  selectedEntry?: TimelineEntry
  visibleEntries: readonly TimelineEntry[]
  followedEntryId?: string
  onSelect: (entryId: string) => void
  onPause: () => void
  onClearFilters: () => void
}

function TimelineDisplay(props: TimelineDisplayProps) {
  if (props.visibleEntries.length === 0) {
    if (props.entries.length === 0) {
      return (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No Test evidence was recorded for this Scenario attempt.
        </p>
      )
    }
    return (
      <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          No timeline entries match these filters.
        </p>
        <Button variant="outline" size="sm" onClick={props.onClearFilters}>
          Clear filters
        </Button>
      </div>
    )
  }
  if (!props.selectedEntry) return null
  return (
    <div className="grid min-w-0 items-start lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
      <TimelineWaterfall
        entries={props.visibleEntries}
        attemptStartedAt={props.startedAt}
        durationMs={props.durationMs}
        selectedEntryId={props.selectedEntry.id}
        followedEntryId={props.followedEntryId}
        following={props.follow === true}
        onSelect={props.onSelect}
        onPauseFollowing={props.onPause}
      />
      <TimelineEvidenceDetail
        entry={props.selectedEntry}
        attemptStartedAt={props.startedAt}
        scenarioName={props.scenarioName}
        resultState={props.resultState}
      />
    </div>
  )
}

const defaultTimelineEntryKinds = [
  'Step',
  'Resolved action',
] satisfies readonly TimelineEntryKind[]

type TimelineKindFiltersProps = {
  selectedKinds: readonly TimelineEntryKind[]
  onKindChange: (kind: TimelineEntryKind, selected: boolean) => void
}

function TimelineKindFilters(props: TimelineKindFiltersProps) {
  return (
    <ul
      aria-label="Filter timeline by entry type"
      className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-3"
    >
      {timelineEntryKinds.map((kind) => (
        <li key={kind}>
          <TimelineKindFilter
            kind={kind}
            selected={props.selectedKinds.includes(kind)}
            onPressedChange={(selected) => props.onKindChange(kind, selected)}
          />
        </li>
      ))}
    </ul>
  )
}

function useTimelineView(props: ResultEvidenceTimelineProps) {
  const [selectedEntryId, setSelectedEntryId] = useState<string>()
  const [selectedKinds, setSelectedKinds] = useState<
    readonly TimelineEntryKind[]
  >(defaultTimelineEntryKinds)
  const visibleEntries = timelineEntriesOfKinds(props.entries, selectedKinds)
  const causalEntry = causalTimelineEntry(visibleEntries)
  const followedEntryId =
    props.followedEntryId ?? causalEntry?.id ?? visibleEntries.at(-1)?.id
  const activeEntryId =
    props.follow === true
      ? followedEntryId
      : (selectedEntryId ?? followedEntryId)
  const selectedEntry = selectedTimelineEntry(
    visibleEntries,
    activeEntryId,
    causalEntry,
  )
  return {
    followedEntryId,
    selectedEntry,
    selectedKinds,
    setSelectedEntryId,
    setSelectedKinds,
    visibleEntries,
  }
}

export function ResultEvidenceTimeline(props: ResultEvidenceTimelineProps) {
  const view = useTimelineView(props)
  const causalPointUnavailable =
    !props.entries.some((entry) => entry.causalAt) &&
    (props.state === 'failed' || props.state === 'infrastructure-error')
  const entryCount = view.visibleEntries.length

  function handleSelect(entryId: string) {
    view.setSelectedEntryId(entryId)
    props.onPauseFollowing?.()
  }

  function handlePauseFollowing() {
    if (props.follow === true && view.followedEntryId) {
      view.setSelectedEntryId(view.followedEntryId)
    }
    props.onPauseFollowing?.()
  }

  function handleKindChange(kind: TimelineEntryKind, selected: boolean) {
    view.setSelectedKinds((current) =>
      selected
        ? [...current, kind]
        : current.filter((currentKind) => currentKind !== kind),
    )
  }

  function handleClearFilters() {
    view.setSelectedKinds(timelineEntryKinds)
  }

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle>Execution timeline</CardTitle>
        <CardDescription>
          Steps span their recorded duration. Actions and evidence mark when
          they were recorded.
        </CardDescription>
        <CardAction>
          <span
            role="status"
            aria-live="polite"
            className="font-mono text-[0.6875rem] text-muted-foreground tabular-nums"
          >
            {durationLabel(props.durationMs)} · {entryCount}{' '}
            {entryCount === 1 ? 'entry' : 'entries'}
          </span>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        <TimelineKindFilters
          selectedKinds={view.selectedKinds}
          onKindChange={handleKindChange}
        />
        {causalPointUnavailable ? (
          <p
            role="status"
            className="border-b border-border px-4 py-3 text-xs text-muted-foreground"
          >
            Causal point unavailable. The retained evidence does not identify a
            precise failing instant.
          </p>
        ) : null}
        <TimelineDisplay
          {...props}
          selectedEntry={view.selectedEntry}
          visibleEntries={view.visibleEntries}
          followedEntryId={view.followedEntryId}
          onSelect={handleSelect}
          onPause={handlePauseFollowing}
          onClearFilters={handleClearFilters}
        />
      </CardContent>
    </Card>
  )
}
