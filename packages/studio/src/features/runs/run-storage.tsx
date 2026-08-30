import { Button } from '../../components/ui/button'
import type { StudioRunsIndex } from '../../server/contracts'
import { bytesLabel } from './run-format'

type RunStorageProps = {
  index: StudioRunsIndex
  onDeleteEligible: () => void
}

export function RunStorage(props: RunStorageProps) {
  const retentionDays = props.index.retention.maxAgeMs
    ? Math.round(props.index.retention.maxAgeMs / (24 * 60 * 60 * 1_000))
    : undefined
  const retentionConfigured = Boolean(
    props.index.retention.maxAgeMs || props.index.retention.maxBytes,
  )
  const retentionLabel = retentionConfigured
    ? [
        retentionDays ? `${retentionDays} days` : undefined,
        props.index.retention.maxBytes
          ? bytesLabel(props.index.retention.maxBytes)
          : undefined,
      ]
        .filter(Boolean)
        .join(' · ')
    : 'No deletion policy configured. Test runs are retained until you configure a limit.'

  return (
    <section
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
      aria-labelledby="run-storage-title"
    >
      <div className="min-w-0 space-y-1">
        <h2 id="run-storage-title" className="studio-display text-sm">
          Local Test run storage
        </h2>
        <p className="text-xs text-muted-foreground">
          {bytesLabel(props.index.storage.totalBytes)} stored · Warning at{' '}
          {bytesLabel(props.index.storage.warningThresholdBytes)}
        </p>
        <p className="text-xs text-muted-foreground">{retentionLabel}</p>
        {props.index.storage.warning ? (
          <p role="alert" className="text-sm text-destructive">
            Local Test run storage reached the warning threshold. Configure
            retention, export needed evidence, or remove eligible runs.
          </p>
        ) : null}
      </div>
      <Button
        type="button"
        variant="destructive"
        disabled={!retentionConfigured}
        onClick={props.onDeleteEligible}
      >
        Delete eligible runs
      </Button>
    </section>
  )
}
