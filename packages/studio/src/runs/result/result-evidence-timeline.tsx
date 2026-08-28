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
import { Label } from '../../components/ui/label'
import { Switch } from '../../components/ui/switch'
import { durationLabel } from '../run-format'
import {
  causalTimelineEntry,
  type TimelineDensity,
  type TimelineEntry,
  visibleTimelineEntries,
} from './result-evidence'
import { TimelineEvidenceDetail } from './timeline-evidence-detail'
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
}

function TimelineDisplay(props: TimelineDisplayProps) {
  if (props.visibleEntries.length === 0) {
    return (
      <p className="px-4 py-8 text-center text-sm text-muted-foreground">
        No Test evidence was recorded for this Scenario attempt.
      </p>
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

export function ResultEvidenceTimeline(props: ResultEvidenceTimelineProps) {
  const [selectedEntryId, setSelectedEntryId] = useState<string>()
  const [density, setDensity] = useState<TimelineDensity>('essential')
  const visibleEntries = visibleTimelineEntries(props.entries, density)
  const followEntries = visibleTimelineEntries(props.entries, 'essential')
  const causalEntry = causalTimelineEntry(visibleEntries)
  const followedEntryId =
    props.followedEntryId ??
    causalTimelineEntry(followEntries)?.id ??
    followEntries.at(-1)?.id
  const activeEntryId =
    props.follow === true
      ? followedEntryId
      : (selectedEntryId ?? followedEntryId)
  const selectedEntry = selectedTimelineEntry(
    visibleEntries,
    activeEntryId,
    causalEntry,
  )
  const causalPointUnavailable =
    !props.entries.some((entry) => entry.causalAt) &&
    (props.state === 'failed' || props.state === 'infrastructure-error')
  const entryCount = visibleEntries.length

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

  function handleVerboseChange(verbose: boolean) {
    setDensity(verbose ? 'verbose' : 'essential')
  }

  return (
    <Card>
      <CardHeader className="border-b border-border">
        <CardTitle>Execution timeline</CardTitle>
        <CardDescription>
          Steps span their recorded duration. Actions and evidence mark when
          they were recorded.
        </CardDescription>
        <CardAction className="flex items-center gap-3">
          <span className="flex items-center gap-2">
            <Switch
              id="verbose-timeline"
              size="sm"
              checked={density === 'verbose'}
              onCheckedChange={handleVerboseChange}
            />
            <Label htmlFor="verbose-timeline">Verbose timeline</Label>
          </span>
          <span className="font-mono text-[0.6875rem] text-muted-foreground tabular-nums">
            {durationLabel(props.durationMs)} · {entryCount}{' '}
            {entryCount === 1 ? 'entry' : 'entries'}
          </span>
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
        <TimelineDisplay
          {...props}
          selectedEntry={selectedEntry}
          visibleEntries={visibleEntries}
          followedEntryId={followedEntryId}
          onSelect={handleSelect}
          onPause={handlePauseFollowing}
        />
      </CardContent>
    </Card>
  )
}
