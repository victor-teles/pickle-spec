import type { TestResultState } from '@pickle-spec/runner'
import { useState } from 'react'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { durationLabel } from '../run-format'
import { causalTimelineEntry, type TimelineEntry } from './result-evidence'
import { TimelineEvidenceDetail } from './timeline-evidence-detail'
import { TimelineWaterfall } from './timeline-waterfall'

type ResultEvidenceTimelineProps = {
  entries: readonly TimelineEntry[]
  startedAt: string
  durationMs: number
  state: TestResultState | 'running'
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

export function ResultEvidenceTimeline(props: ResultEvidenceTimelineProps) {
  const [selectedEntryId, setSelectedEntryId] = useState<string>()
  const causalEntry = causalTimelineEntry(props.entries)
  const followedEntryId =
    props.followedEntryId ?? causalEntry?.id ?? props.entries.at(-1)?.id
  const activeEntryId =
    props.follow === true
      ? followedEntryId
      : (selectedEntryId ?? followedEntryId)
  const selectedEntry = selectedTimelineEntry(
    props.entries,
    activeEntryId,
    causalEntry,
  )
  const causalPointUnavailable =
    !props.entries.some((entry) => entry.causalAt) &&
    (props.state === 'failed' || props.state === 'infrastructure-error')

  function handleSelect(entryId: string) {
    setSelectedEntryId(entryId)
    props.onPauseFollowing?.()
  }

  function handlePauseFollowing() {
    if (props.follow === true && followedEntryId) {
      setSelectedEntryId(followedEntryId)
    }
    props.onPauseFollowing?.()
  }

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle>Execution timeline</CardTitle>
        <CardDescription>
          Steps span their recorded duration. Actions and evidence mark when
          they were recorded.
        </CardDescription>
        <CardAction className="font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
          {durationLabel(props.durationMs)} · {props.entries.length}{' '}
          {props.entries.length === 1 ? 'entry' : 'entries'}
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {causalPointUnavailable ? (
          <p
            role="status"
            className="border-b border-border px-4 py-3 text-xs text-muted-foreground"
          >
            Causal point unavailable. The retained evidence does not identify a
            precise failing instant.
          </p>
        ) : null}
        {props.entries.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted-foreground">
            No Test evidence was recorded for this Scenario attempt.
          </p>
        ) : selectedEntry ? (
          <div className="grid min-w-0 lg:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)]">
            <TimelineWaterfall
              entries={props.entries}
              attemptStartedAt={props.startedAt}
              durationMs={props.durationMs}
              selectedEntryId={selectedEntry.id}
              followedEntryId={followedEntryId}
              following={props.follow === true}
              onSelect={handleSelect}
              onPauseFollowing={handlePauseFollowing}
            />
            <TimelineEvidenceDetail
              entry={selectedEntry}
              attemptStartedAt={props.startedAt}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
