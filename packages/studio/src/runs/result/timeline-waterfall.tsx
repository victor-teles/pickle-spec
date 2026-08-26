import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { Button } from '../../components/ui/button'
import { ScrollArea } from '../../components/ui/scroll-area'
import { cn } from '../../lib/utils'
import { durationLabel } from '../run-format'
import { relativeTimeLabel, type TimelineEntry } from './result-evidence'
import {
  TimelineKindBadge,
  TimelineKindIcon,
  timelineEntryKinds,
  timelineKindSolidClassName,
} from './timeline-kind'

type TimelineWaterfallProps = {
  entries: readonly TimelineEntry[]
  attemptStartedAt: string
  durationMs: number
  selectedEntryId?: string
  followedEntryId?: string
  following: boolean
  onSelect: (entryId: string) => void
  onPauseFollowing?: () => void
}

type TimelineScale = {
  durationMs: number
  ticks: number[]
}

const timelinePageSize = 100

function niceInterval(durationMs: number): number {
  const roughInterval = Math.max(1, durationMs) / 5
  const magnitude = 10 ** Math.floor(Math.log10(roughInterval))
  const normalized = roughInterval / magnitude
  if (normalized <= 1) return magnitude
  if (normalized <= 2) return magnitude * 2
  if (normalized <= 5) return magnitude * 5
  return magnitude * 10
}

function createTimelineScale(durationMs: number): TimelineScale {
  const interval = niceInterval(durationMs)
  const scaleDurationMs = Math.max(
    interval,
    Math.ceil(durationMs / interval) * interval,
  )
  const ticks = Array.from(
    { length: Math.round(scaleDurationMs / interval) + 1 },
    (_, index) => index * interval,
  )
  return { durationMs: scaleDurationMs, ticks }
}

function elapsedMs(timestamp: string, startedAt: string): number {
  return Math.max(0, Date.parse(timestamp) - Date.parse(startedAt))
}

function percentage(value: number, total: number): number {
  return Math.min(100, Math.max(0, (value / total) * 100))
}

function TimelineLegend() {
  return (
    <ul
      aria-label="Timeline legend"
      className="flex flex-wrap items-center gap-1.5 border-b border-border px-4 py-3"
    >
      {timelineEntryKinds.map((kind) => (
        <li key={kind}>
          <TimelineKindBadge kind={kind} />
        </li>
      ))}
    </ul>
  )
}

type TimelineLabelsProps = TimelineWaterfallProps & {
  entryOffset: number
  totalEntries: number
  onMoveFocus: (event: KeyboardEvent, index: number) => void
}

function TimelineLabels(props: TimelineLabelsProps) {
  const followedRef = useRef<HTMLLIElement>(null)
  useEffect(() => {
    if (!props.following || !props.followedEntryId) return
    followedRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [props.followedEntryId, props.following])
  return (
    <div className="min-w-0 border-r border-border">
      <div className="flex h-8 items-center border-b border-border px-3 text-[0.6875rem] font-medium text-muted-foreground">
        Evidence
      </div>
      <ol aria-label="Execution timeline">
        {props.entries.map((entry, visibleIndex) => {
          const entryIndex = props.entryOffset + visibleIndex
          return (
            <li
              key={entry.id}
              ref={entry.id === props.followedEntryId ? followedRef : undefined}
              aria-posinset={entryIndex + 1}
              aria-setsize={props.totalEntries}
              className="h-11 border-b border-border last:border-b-0"
            >
              <Button
                type="button"
                variant="ghost"
                aria-label={`${entry.kind} ${entry.title}, ${relativeTimeLabel(entry.startedAt, props.attemptStartedAt)}`}
                aria-pressed={entry.id === props.selectedEntryId}
                data-timeline-index={entryIndex}
                tabIndex={entry.id === props.selectedEntryId ? 0 : -1}
                onClick={() => props.onSelect(entry.id)}
                onKeyDown={(event) => props.onMoveFocus(event, entryIndex)}
                className={cn(
                  'h-full w-full min-w-0 justify-start rounded-none px-3 text-left',
                  entry.id === props.selectedEntryId &&
                    'bg-secondary text-foreground',
                  entry.causal && 'text-destructive',
                )}
              >
                <span
                  className={cn(
                    'flex size-6 shrink-0 items-center justify-center rounded-md',
                    timelineKindSolidClassName(entry.kind),
                  )}
                >
                  <TimelineKindIcon kind={entry.kind} className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-current">
                    {entry.title}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[0.625rem] text-muted-foreground">
                    <span className="truncate">{entry.kind}</span>
                    <span aria-hidden="true">·</span>
                    <span className="shrink-0 font-mono tabular-nums">
                      {relativeTimeLabel(
                        entry.startedAt,
                        props.attemptStartedAt,
                      )}
                    </span>
                  </span>
                </span>
                {entry.causal ? (
                  <>
                    <span className="sr-only">
                      {entry.causalAt ? 'Causal point' : 'Failure context'}
                    </span>
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full bg-destructive"
                    />
                  </>
                ) : null}
              </Button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function TimelineChart(
  props: TimelineWaterfallProps & { scaleEntries: readonly TimelineEntry[] },
) {
  const latestEntryMs = Math.max(
    0,
    ...props.scaleEntries.map((entry) =>
      elapsedMs(entry.finishedAt ?? entry.startedAt, props.attemptStartedAt),
    ),
  )
  const scale = createTimelineScale(Math.max(props.durationMs, latestEntryMs))
  const causalAt = props.scaleEntries.find((entry) => entry.causalAt)?.causalAt
  const causalPosition = causalAt
    ? percentage(elapsedMs(causalAt, props.attemptStartedAt), scale.durationMs)
    : undefined
  const minWidth = Math.max(560, scale.ticks.length * 112)
  return (
    <ScrollArea
      scrollbars="horizontal"
      viewportProps={{
        'aria-label': 'Scrollable execution time ruler',
        role: 'region',
      }}
      className="min-w-0"
    >
      <div
        role="img"
        aria-label="Execution time ruler"
        className="relative"
        style={{ minWidth }}
      >
        <div className="relative h-8 border-b border-border">
          {scale.ticks.map((tick) => (
            <span
              key={tick}
              className="absolute top-0 bottom-0 border-l border-border/70"
              style={{ left: `${percentage(tick, scale.durationMs)}%` }}
            >
              <span className="absolute top-1.5 left-1.5 font-mono text-[0.625rem] text-muted-foreground tabular-nums">
                {durationLabel(tick)}
              </span>
            </span>
          ))}
        </div>
        <div className="relative">
          {scale.ticks.map((tick) => (
            <span
              key={tick}
              aria-hidden="true"
              className="absolute top-0 bottom-0 border-l border-border/45"
              style={{ left: `${percentage(tick, scale.durationMs)}%` }}
            />
          ))}
          {causalPosition === undefined ? null : (
            <span
              aria-hidden="true"
              className="absolute top-0 bottom-0 z-10 border-l border-dashed border-destructive/70"
              style={{ left: `${causalPosition}%` }}
            />
          )}
          {props.entries.map((entry) => {
            const entryStartMs = elapsedMs(
              entry.startedAt,
              props.attemptStartedAt,
            )
            const left = percentage(entryStartMs, scale.durationMs)
            const endMs = entry.finishedAt
              ? elapsedMs(entry.finishedAt, props.attemptStartedAt)
              : undefined
            const spanWidth =
              endMs === undefined
                ? 0
                : Math.max(
                    0.8,
                    percentage(endMs - entryStartMs, scale.durationMs),
                  )
            return (
              <div
                key={entry.id}
                aria-hidden="true"
                className={cn(
                  'relative h-11 border-b border-border last:border-b-0',
                  entry.id === props.selectedEntryId && 'bg-secondary/55',
                )}
              >
                {endMs === undefined ? (
                  <span
                    className={cn(
                      'absolute top-3 flex size-5 -translate-x-1/2 items-center justify-center rounded-md ring-2 ring-background',
                      timelineKindSolidClassName(entry.kind),
                      entry.causal && 'ring-destructive/60',
                    )}
                    style={{ left: `${left}%` }}
                  >
                    <TimelineKindIcon kind={entry.kind} className="size-3" />
                  </span>
                ) : (
                  <span
                    className={cn(
                      'absolute top-3 flex h-5 min-w-1.5 items-center rounded-md px-1.5 font-mono text-[0.625rem] font-medium tabular-nums',
                      timelineKindSolidClassName(entry.kind),
                      entry.causal && 'ring-2 ring-destructive/60',
                    )}
                    style={{ left: `${left}%`, width: `${spanWidth}%` }}
                  >
                    <span className="min-w-max">
                      {durationLabel(endMs - entryStartMs)}
                    </span>
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </ScrollArea>
  )
}

export function TimelineWaterfall(props: TimelineWaterfallProps) {
  const [requestedPage, setRequestedPage] = useState(0)
  const [pendingFocus, setPendingFocus] = useState<number>()
  const rowsRef = useRef<HTMLDivElement>(null)
  const pageCount = Math.max(
    1,
    Math.ceil(props.entries.length / timelinePageSize),
  )
  const targetEntryId = props.following
    ? props.followedEntryId
    : props.selectedEntryId
  const targetIndex = props.entries.findIndex(
    (entry) => entry.id === targetEntryId,
  )
  const targetPage =
    targetIndex < 0 ? 0 : Math.floor(targetIndex / timelinePageSize)
  const page = Math.min(requestedPage, pageCount - 1)
  const pageStart = page * timelinePageSize
  const pageEntries = props.entries.slice(
    pageStart,
    Math.min(props.entries.length, pageStart + timelinePageSize),
  )
  const visibleProps = { ...props, entries: pageEntries }

  useEffect(() => {
    setRequestedPage(targetPage)
  }, [targetPage])

  useEffect(() => {
    if (pendingFocus === undefined) return
    const target = rowsRef.current?.querySelector<HTMLElement>(
      `[data-timeline-index="${pendingFocus}"]`,
    )
    if (!target) return
    target.focus()
    setPendingFocus(undefined)
  }, [pendingFocus])

  function moveFocus(event: KeyboardEvent, index: number) {
    const nextIndex = nextTimelineIndex(event.key, index, props.entries.length)
    if (nextIndex === undefined || nextIndex === index) return
    const nextEntry = props.entries[nextIndex]
    if (!nextEntry) return
    event.preventDefault()
    setPendingFocus(nextIndex)
    setRequestedPage(Math.floor(nextIndex / timelinePageSize))
    props.onSelect(nextEntry.id)
  }

  function showPage(nextPage: number) {
    const nextIndex = nextPage * timelinePageSize
    const nextEntry = props.entries[nextIndex]
    if (!nextEntry) return
    setRequestedPage(nextPage)
    props.onSelect(nextEntry.id)
  }

  return (
    <section aria-label="Execution timeline chart" className="min-w-0">
      <TimelineLegend />
      <div
        ref={rowsRef}
        className="grid min-w-0 grid-cols-[minmax(12rem,16rem)_minmax(0,1fr)]"
        onWheel={props.onPauseFollowing}
        onPointerDown={props.onPauseFollowing}
      >
        <TimelineLabels
          {...visibleProps}
          entryOffset={pageStart}
          totalEntries={props.entries.length}
          onMoveFocus={moveFocus}
        />
        <TimelineChart {...visibleProps} scaleEntries={props.entries} />
      </div>
      {pageCount > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
          <p role="status" className="text-xs text-muted-foreground">
            Showing {pageStart + 1}–{pageStart + pageEntries.length} of{' '}
            {props.entries.length} entries
          </p>
          <nav aria-label="Timeline pages" className="flex gap-2">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page === 0}
              onClick={() => showPage(page - 1)}
            >
              Previous 100
            </Button>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={page === pageCount - 1}
              onClick={() => showPage(page + 1)}
            >
              Next 100
            </Button>
          </nav>
        </div>
      ) : null}
    </section>
  )
}

function nextTimelineIndex(
  key: string,
  currentIndex: number,
  entryCount: number,
): number | undefined {
  if (key === 'ArrowDown') return Math.min(entryCount - 1, currentIndex + 1)
  if (key === 'ArrowUp') return Math.max(0, currentIndex - 1)
  if (key === 'Home') return 0
  if (key === 'End') return Math.max(0, entryCount - 1)
  return undefined
}
