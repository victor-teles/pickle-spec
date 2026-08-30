import {
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from 'react'
import { Button } from '../../../components/ui/button'
import { ScrollArea } from '../../../components/ui/scroll-area'
import { cn } from '../../../lib/utils'
import { durationLabel } from '../run-format'
import { relativeTimeLabel, type TimelineEntry } from './result-evidence'
import { TimelineKindIcon, timelineKindSolidClassName } from './timeline-kind'

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

type TimelineLabelsProps = TimelineWaterfallProps & {
  entryOffset: number
  totalEntries: number
  onMoveFocus: (event: KeyboardEvent, index: number) => void
}

function TimelineLabelEntry(
  props: TimelineWaterfallProps & {
    entry: TimelineEntry
    entryIndex: number
    totalEntries: number
    followedRef: RefObject<HTMLLIElement | null>
    onMoveFocus: (event: KeyboardEvent, index: number) => void
  },
) {
  const selected = props.entry.id === props.selectedEntryId
  function handleClick() {
    props.onSelect(props.entry.id)
  }
  function handleKeyDown(event: KeyboardEvent) {
    props.onMoveFocus(event, props.entryIndex)
  }
  return (
    <li
      ref={
        props.entry.id === props.followedEntryId ? props.followedRef : undefined
      }
      aria-posinset={props.entryIndex + 1}
      aria-setsize={props.totalEntries}
      className="h-11 border-b border-border last:border-b-0"
    >
      <Button
        type="button"
        variant="ghost"
        aria-label={`${props.entry.kind} ${props.entry.title}, ${relativeTimeLabel(props.entry.startedAt, props.attemptStartedAt)}`}
        aria-pressed={selected}
        data-timeline-entry-id={props.entry.id}
        data-timeline-index={props.entryIndex}
        tabIndex={selected ? 0 : -1}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        className={cn(
          'h-full w-full min-w-0 justify-start rounded-none px-3 text-left transition-none',
          selected && 'bg-secondary text-foreground',
          props.entry.causal && 'text-destructive',
        )}
      >
        <span
          className={cn(
            'flex size-6 shrink-0 items-center justify-center rounded-md',
            timelineKindSolidClassName(props.entry.kind),
          )}
        >
          <TimelineKindIcon kind={props.entry.kind} className="size-3.5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium text-current">
            {props.entry.title}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[0.625rem] text-muted-foreground">
            <span className="truncate">{props.entry.kind}</span>
            <span aria-hidden="true">·</span>
            <span className="shrink-0 font-mono tabular-nums">
              {relativeTimeLabel(props.entry.startedAt, props.attemptStartedAt)}
            </span>
          </span>
        </span>
        {props.entry.causal ? (
          <>
            <span className="sr-only">
              {props.entry.causalAt ? 'Causal point' : 'Failure context'}
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
        Timeline entry
      </div>
      <ol aria-label="Execution timeline">
        {props.entries.map((entry, visibleIndex) => (
          <TimelineLabelEntry
            {...props}
            key={entry.id}
            entry={entry}
            entryIndex={props.entryOffset + visibleIndex}
            followedRef={followedRef}
          />
        ))}
      </ol>
    </div>
  )
}

type TimelinePlotGeometry =
  | { type: 'point'; left: number }
  | { type: 'duration'; left: number; width: number; durationMs: number }

type TimelinePlotEntryProps = {
  entry: TimelineEntry
  geometry: TimelinePlotGeometry
  selected: boolean
  onSelect: (entryId: string) => void
}

type TimelinePlotMarkProps = {
  entry: TimelineEntry
  geometry: TimelinePlotGeometry
  markClassName: string
}

function TimelinePlotMark(props: TimelinePlotMarkProps) {
  if (props.geometry.type === 'point') {
    return (
      <span
        data-timeline-mark
        className={cn(
          'absolute top-3 flex size-5 -translate-x-1/2 items-center justify-center rounded-md ring-2 ring-background',
          props.markClassName,
        )}
        style={{ left: `${props.geometry.left}%` }}
      >
        <TimelineKindIcon kind={props.entry.kind} className="size-3" />
      </span>
    )
  }
  return (
    <span
      data-timeline-mark
      className={cn(
        'absolute top-3 flex h-5 min-w-1.5 items-center overflow-hidden rounded-md px-1.5 font-mono text-[0.625rem] font-medium whitespace-nowrap tabular-nums',
        props.markClassName,
      )}
      style={{
        left: `${props.geometry.left}%`,
        width: `${props.geometry.width}%`,
      }}
    >
      <span data-timeline-duration-label className="min-w-0 truncate">
        {durationLabel(props.geometry.durationMs)}
      </span>
    </span>
  )
}

function timelinePlotPointerStyle(geometry: TimelinePlotGeometry) {
  const spanWidth = geometry.type === 'duration' ? geometry.width : undefined
  const midpoint = geometry.left + (spanWidth ?? 0) / 2
  const pointerWidth =
    spanWidth === undefined ? '44px' : `max(44px, ${spanWidth}%)`
  const pointerHalfWidth =
    spanWidth === undefined ? '22px' : `max(22px, ${spanWidth / 2}%)`
  return {
    left: `clamp(0px, calc(${midpoint}% - ${pointerHalfWidth}), calc(100% - ${pointerWidth}))`,
    width: pointerWidth,
  }
}

function TimelinePlotEntry(props: TimelinePlotEntryProps) {
  const markClassName = cn(
    'border border-transparent transition-none peer-hover:border-foreground/30 peer-active:border-foreground/45',
    timelineKindSolidClassName(props.entry.kind),
    props.entry.causal && 'ring-2 ring-destructive/60',
    props.selected && 'border-foreground/35',
  )
  return (
    <div
      aria-hidden="true"
      className={cn(
        'relative h-11 border-b border-border last:border-b-0',
        props.selected && 'bg-secondary/55',
      )}
    >
      <Button
        nativeButton={false}
        render={<span />}
        role="presentation"
        tabIndex={-1}
        variant="ghost"
        data-timeline-entry-id={props.entry.id}
        data-timeline-plot={props.geometry.type}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => props.onSelect(props.entry.id)}
        className="peer absolute top-0 z-20 h-11 min-w-0 cursor-pointer rounded-none border-0 bg-transparent p-0 transition-none hover:bg-transparent active:bg-transparent"
        style={timelinePlotPointerStyle(props.geometry)}
      />
      <TimelinePlotMark
        entry={props.entry}
        geometry={props.geometry}
        markClassName={markClassName}
      />
    </div>
  )
}

type TimelineChartRowProps = {
  entry: TimelineEntry
  scale: ReturnType<typeof createTimelineScale>
  attemptStartedAt: string
  selectedEntryId?: string
  onSelect: (entryId: string) => void
}

function TimelineChartRow(props: TimelineChartRowProps) {
  const entryStartMs = elapsedMs(props.entry.startedAt, props.attemptStartedAt)
  const left = percentage(entryStartMs, props.scale.durationMs)
  const endMs = props.entry.finishedAt
    ? elapsedMs(props.entry.finishedAt, props.attemptStartedAt)
    : undefined
  const geometry: TimelinePlotGeometry =
    endMs === undefined
      ? { type: 'point', left }
      : {
          type: 'duration',
          left,
          width: Math.max(
            0.8,
            percentage(endMs - entryStartMs, props.scale.durationMs),
          ),
          durationMs: endMs - entryStartMs,
        }
  return (
    <TimelinePlotEntry
      entry={props.entry}
      geometry={geometry}
      selected={props.entry.id === props.selectedEntryId}
      onSelect={props.onSelect}
    />
  )
}

function timelineChartLayout(
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
  return {
    scale,
    causalPosition: causalAt
      ? percentage(
          elapsedMs(causalAt, props.attemptStartedAt),
          scale.durationMs,
        )
      : undefined,
    minWidth: Math.max(560, scale.ticks.length * 112),
  }
}

function TimelineChart(
  props: TimelineWaterfallProps & { scaleEntries: readonly TimelineEntry[] },
) {
  const { scale, causalPosition, minWidth } = timelineChartLayout(props)
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
              <span
                data-timeline-tick={tick}
                className={cn(
                  'absolute top-1.5 font-mono text-[0.625rem] whitespace-nowrap text-muted-foreground tabular-nums',
                  tick === scale.durationMs ? 'right-1.5' : 'left-1.5',
                )}
              >
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
          {props.entries.map((entry) => (
            <TimelineChartRow
              key={entry.id}
              entry={entry}
              scale={scale}
              attemptStartedAt={props.attemptStartedAt}
              selectedEntryId={props.selectedEntryId}
              onSelect={props.onSelect}
            />
          ))}
        </div>
      </div>
    </ScrollArea>
  )
}

function TimelinePagination(props: {
  entryCount: number
  page: number
  pageCount: number
  pageStart: number
  visibleCount: number
  onShowPage: (page: number) => void
}) {
  if (props.pageCount <= 1) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
      <p role="status" className="text-xs text-muted-foreground">
        Showing {props.pageStart + 1}–{props.pageStart + props.visibleCount} of{' '}
        {props.entryCount} entries
      </p>
      <nav aria-label="Timeline pages" className="flex gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={props.page === 0}
          onClick={() => props.onShowPage(props.page - 1)}
        >
          Previous 100
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={props.page === props.pageCount - 1}
          onClick={() => props.onShowPage(props.page + 1)}
        >
          Next 100
        </Button>
      </nav>
    </div>
  )
}

function useTimelinePageEffects(input: {
  pendingFocus?: number
  rowsRef: RefObject<HTMLDivElement | null>
  setPendingFocus: (index: number | undefined) => void
  setRequestedPage: (page: number) => void
  targetPage: number
}): void {
  useEffect(
    () => input.setRequestedPage(input.targetPage),
    [input.setRequestedPage, input.targetPage],
  )
  useEffect(() => {
    if (input.pendingFocus === undefined) return
    const target = input.rowsRef.current?.querySelector<HTMLElement>(
      `[data-timeline-index="${input.pendingFocus}"]`,
    )
    if (!target) return
    target.focus()
    input.setPendingFocus(undefined)
  }, [input.pendingFocus, input.rowsRef, input.setPendingFocus])
}

interface TimelineNavigationInput {
  entries: readonly TimelineEntry[]
  onSelect: (entryId: string) => void
  setPendingFocus: (index: number | undefined) => void
  setRequestedPage: (page: number) => void
}

function moveTimelineFocus(
  input: TimelineNavigationInput,
  event: KeyboardEvent,
  index: number,
): void {
  const nextIndex = nextTimelineIndex(event.key, index, input.entries.length)
  if (nextIndex === undefined || nextIndex === index) return
  const nextEntry = input.entries[nextIndex]
  if (!nextEntry) return
  event.preventDefault()
  input.setPendingFocus(nextIndex)
  input.setRequestedPage(Math.floor(nextIndex / timelinePageSize))
  input.onSelect(nextEntry.id)
}

function showTimelinePage(
  input: TimelineNavigationInput,
  nextPage: number,
): void {
  const nextEntry = input.entries[nextPage * timelinePageSize]
  if (!nextEntry) return
  input.setRequestedPage(nextPage)
  input.onSelect(nextEntry.id)
}

function timelinePage(
  entries: readonly TimelineEntry[],
  targetEntryId: string | undefined,
  requestedPage: number,
) {
  const pageCount = Math.max(1, Math.ceil(entries.length / timelinePageSize))
  const targetIndex = entries.findIndex((entry) => entry.id === targetEntryId)
  const targetPage =
    targetIndex < 0 ? 0 : Math.floor(targetIndex / timelinePageSize)
  const page = Math.min(requestedPage, pageCount - 1)
  const pageStart = page * timelinePageSize
  return {
    pageCount,
    targetPage,
    page,
    pageStart,
    pageEntries: entries.slice(
      pageStart,
      Math.min(entries.length, pageStart + timelinePageSize),
    ),
  }
}

export function TimelineWaterfall(props: TimelineWaterfallProps) {
  const [requestedPage, setRequestedPage] = useState(0)
  const [pendingFocus, setPendingFocus] = useState<number>()
  const rowsRef = useRef<HTMLDivElement>(null)
  const targetEntryId = props.following
    ? props.followedEntryId
    : props.selectedEntryId
  const { pageCount, targetPage, page, pageStart, pageEntries } = timelinePage(
    props.entries,
    targetEntryId,
    requestedPage,
  )
  const visibleProps = { ...props, entries: pageEntries }

  useTimelinePageEffects({
    pendingFocus,
    rowsRef,
    setPendingFocus,
    setRequestedPage,
    targetPage,
  })
  const navigation = {
    entries: props.entries,
    onSelect: props.onSelect,
    setPendingFocus,
    setRequestedPage,
  }

  return (
    <section aria-label="Execution timeline chart" className="min-w-0">
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
          onMoveFocus={(event, index) =>
            moveTimelineFocus(navigation, event, index)
          }
        />
        <TimelineChart {...visibleProps} scaleEntries={props.entries} />
      </div>
      <TimelinePagination
        entryCount={props.entries.length}
        page={page}
        pageCount={pageCount}
        pageStart={pageStart}
        visibleCount={pageEntries.length}
        onShowPage={(nextPage) => showTimelinePage(navigation, nextPage)}
      />
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
