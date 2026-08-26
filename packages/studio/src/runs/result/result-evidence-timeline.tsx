import type { TestResultState } from '@pickle-spec/runner'
import { useEffect, useRef } from 'react'
import { Badge } from '../../components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { relativeTimeLabel, type TimelineEntry } from './result-evidence'

type ResultEvidenceTimelineProps = {
  entries: readonly TimelineEntry[]
  startedAt: string
  state: TestResultState | 'running'
  follow?: boolean
  followedEntryId?: string
  onPauseFollowing?: () => void
}

export function ResultEvidenceTimeline(props: ResultEvidenceTimelineProps) {
  const followedRef = useRef<HTMLLIElement>(null)
  const causalEntry = props.entries.find((entry) => entry.causal)
  const followedId =
    props.followedEntryId ?? causalEntry?.id ?? props.entries.at(-1)?.id
  useEffect(() => {
    if (props.follow === false || !followedId) return
    followedRef.current?.scrollIntoView({ block: 'center', inline: 'nearest' })
  }, [followedId, props.follow])
  const causalPointUnavailable =
    !causalEntry &&
    (props.state === 'failed' || props.state === 'infrastructure-error')
  return (
    <Card
      onWheel={props.onPauseFollowing}
      onPointerDown={props.onPauseFollowing}
    >
      <CardHeader>
        <CardTitle>Causal evidence timeline</CardTitle>
        <CardDescription>
          Steps, Run events, Diagnostic entries, and Test artifacts share one
          clock.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {causalPointUnavailable ? (
          <p role="status" className="mb-3 text-muted-foreground">
            Causal point unavailable. The retained evidence does not identify a
            failing step or Diagnostic entry.
          </p>
        ) : null}
        <ol
          aria-label="Causal evidence timeline"
          className="relative min-w-0 space-y-0 before:absolute before:top-2 before:bottom-2 before:left-[4.375rem] before:w-px before:bg-border sm:before:left-[7.75rem]"
        >
          {props.entries.map((entry) => (
            <li
              key={entry.id}
              ref={
                entry.id === followedId || (entry.causal && !followedId)
                  ? followedRef
                  : undefined
              }
              aria-current={entry.causal ? 'true' : undefined}
              className="relative grid min-w-0 grid-cols-[4rem_minmax(0,1fr)] gap-3 py-2 sm:grid-cols-[7rem_minmax(0,1fr)] sm:gap-4"
            >
              <time className="pr-2 text-right font-mono text-[0.625rem] text-muted-foreground tabular-nums sm:pr-3">
                {relativeTimeLabel(entry.occurredAt, props.startedAt)}
              </time>
              <span
                aria-hidden="true"
                className={`absolute top-[0.875rem] left-[4.125rem] size-2 rounded-full border sm:left-[7.5rem] ${
                  entry.causal
                    ? 'border-foreground/35 bg-foreground'
                    : 'border-border bg-card'
                }`}
              />
              <div
                className={`min-w-0 rounded-md border px-3 py-2 ${
                  entry.causal
                    ? 'border-foreground/25 bg-muted/30'
                    : 'border-border bg-muted/20'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>{entry.kind}</Badge>
                  {entry.causal ? (
                    <span className="font-mono text-[0.625rem] text-foreground">
                      Causal point
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 break-words font-medium">{entry.title}</p>
                {entry.detail ? (
                  <p
                    className={`mt-1 break-words ${
                      entry.causal
                        ? 'text-destructive'
                        : 'text-muted-foreground'
                    }`}
                  >
                    {entry.detail}
                  </p>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}
