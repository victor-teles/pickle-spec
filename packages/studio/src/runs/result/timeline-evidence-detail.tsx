import { Badge } from '../../components/ui/badge'
import { durationLabel } from '../run-format'
import { relativeTimeLabel, type TimelineEntry } from './result-evidence'
import { TimelineKindBadge } from './timeline-kind'

type TimelineEvidenceDetailProps = {
  entry: TimelineEntry
  attemptStartedAt: string
}

type DetailItemProps = {
  label: string
  value: string
  mono?: boolean
}

function DetailItem(props: DetailItemProps) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd
        className={
          props.mono
            ? 'break-words font-mono text-xs tabular-nums'
            : 'break-words text-sm'
        }
      >
        {props.value}
      </dd>
    </div>
  )
}

function entryDurationMs(entry: TimelineEntry): number | undefined {
  if (!entry.finishedAt) return undefined
  return Math.max(0, Date.parse(entry.finishedAt) - Date.parse(entry.startedAt))
}

export function TimelineEvidenceDetail(props: TimelineEvidenceDetailProps) {
  const { entry } = props
  const durationMs = entryDurationMs(entry)
  return (
    <section
      aria-label="Selected timeline evidence"
      className="min-w-0 border-t border-border p-4 lg:border-t-0 lg:border-l"
    >
      <div className="flex flex-wrap items-center gap-2">
        <TimelineKindBadge kind={entry.kind} />
        {entry.causal ? (
          <Badge className="border border-destructive/30 bg-destructive/10 text-destructive normal-case tracking-normal">
            {entry.causalAt ? 'Causal point' : 'Failure context'}
          </Badge>
        ) : null}
      </div>
      <h4 className="mt-3 break-words text-sm font-semibold tracking-[-0.01em]">
        {entry.title}
      </h4>
      {entry.context ? (
        <p className="mt-1 break-words text-xs/relaxed text-muted-foreground">
          {entry.context}
        </p>
      ) : null}
      <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
        <DetailItem
          label="Elapsed"
          value={relativeTimeLabel(entry.startedAt, props.attemptStartedAt)}
          mono
        />
        <DetailItem
          label="Recorded"
          value={new Date(entry.startedAt).toLocaleString()}
        />
        {durationMs === undefined ? null : (
          <DetailItem label="Duration" value={durationLabel(durationMs)} mono />
        )}
        <DetailItem
          label="Timing"
          value={
            entry.timingPrecision === 'exact'
              ? 'Exact recorded time'
              : 'Recorded at step completion'
          }
        />
        {entry.state ? <DetailItem label="State" value={entry.state} /> : null}
        {entry.causalAt ? (
          <DetailItem
            label="Causal time"
            value={relativeTimeLabel(entry.causalAt, props.attemptStartedAt)}
            mono
          />
        ) : null}
        {entry.attributes.map((attribute) => (
          <DetailItem
            key={attribute.label}
            label={attribute.label}
            value={attribute.value}
          />
        ))}
      </dl>
    </section>
  )
}
