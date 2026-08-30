import type { TestResultState } from '@pickle-spec/runner'
import { Badge } from '../../../components/ui/badge'
import { durationLabel } from '../run-format'
import { ActionEvidenceDetail } from './action-evidence-detail'
import { ArtifactViewer } from './artifact-viewer'
import { relativeTimeLabel, type TimelineEntry } from './result-evidence'
import { TimelineKindBadge } from './timeline-kind'

type TimelineEvidenceDetailProps = {
  entry: TimelineEntry
  attemptStartedAt: string
  scenarioName: string
  resultState: TestResultState
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

function timingPrecisionLabel(entry: TimelineEntry): string {
  if (entry.timingPrecision === 'exact') return 'Exact recorded time'
  if (entry.timingPrecision === 'step-finish') {
    return 'Recorded at step completion'
  }
  return 'Recorded at attempt completion'
}

function entryMedia(entry: TimelineEntry) {
  if (entry.artifact) return [entry.artifact]
  return entry.artifacts ?? []
}

function TimelineEntryMetadata(props: {
  attemptStartedAt: string
  entry: TimelineEntry
}) {
  const durationMs = entryDurationMs(props.entry)
  return (
    <dl className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
      <DetailItem
        label="Elapsed"
        value={relativeTimeLabel(props.entry.startedAt, props.attemptStartedAt)}
        mono
      />
      <DetailItem
        label="Recorded"
        value={new Date(props.entry.startedAt).toLocaleString()}
      />
      {durationMs === undefined ? null : (
        <DetailItem label="Duration" value={durationLabel(durationMs)} mono />
      )}
      <DetailItem label="Timing" value={timingPrecisionLabel(props.entry)} />
      {props.entry.state ? (
        <DetailItem label="State" value={props.entry.state} />
      ) : null}
      {props.entry.causalAt ? (
        <DetailItem
          label="Causal time"
          value={relativeTimeLabel(
            props.entry.causalAt,
            props.attemptStartedAt,
          )}
          mono
        />
      ) : null}
      {props.entry.attributes.map((attribute) => (
        <DetailItem
          key={attribute.label}
          label={attribute.label}
          value={attribute.value}
        />
      ))}
    </dl>
  )
}

export function TimelineEvidenceDetail(props: TimelineEvidenceDetailProps) {
  const { entry } = props
  const media = entryMedia(entry)
  const stepText = entry.context ?? entry.title
  return (
    <section
      aria-label="Selected timeline entry"
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
      {entry.action ? (
        <ActionEvidenceDetail
          action={entry.action}
          resultState={props.resultState}
          scenarioName={props.scenarioName}
        />
      ) : null}
      {media.length > 0 ? (
        <div className="mt-4 space-y-4">
          {media.map((artifact) => (
            <ArtifactViewer
              key={artifact.path}
              artifact={artifact}
              resultState={props.resultState}
              scenarioName={props.scenarioName}
              stepText={stepText}
            />
          ))}
        </div>
      ) : null}
      <TimelineEntryMetadata
        entry={entry}
        attemptStartedAt={props.attemptStartedAt}
      />
    </section>
  )
}
