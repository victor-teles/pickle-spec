import { Badge } from '../../../components/ui/badge'
import { Button } from '../../../components/ui/button'
import { ResultMark } from '../../../components/ui/result-mark'
import type { LiveResultInspection } from '../result/live-result-inspection'
import { runProgress } from '../runs-model'

type ActiveRunsProps = {
  runIds: readonly string[]
  inspections: ReadonlyMap<string, LiveResultInspection>
  onCancel: (runId: string) => void
  onOpen: (runId: string) => void
}

export function ActiveRuns(props: ActiveRunsProps) {
  if (props.runIds.length === 0) return null

  return (
    <section className="space-y-2" aria-labelledby="active-runs-title">
      <h2 id="active-runs-title" className="studio-display text-sm">
        Active Runs
      </h2>
      <div className="divide-y divide-border rounded-xl border border-border bg-card">
        {props.runIds.map((runId) => {
          const inspection = props.inspections.get(runId)
          const progress = inspection ? runProgress(inspection) : undefined
          return (
            <div
              key={runId}
              className="flex flex-wrap items-center justify-between gap-3 p-3"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <Badge variant="running">
                    <ResultMark state="running" /> running
                  </Badge>
                  <span className="truncate font-mono text-xs">{runId}</span>
                </div>
                <p className="text-xs text-muted-foreground" aria-live="polite">
                  {progress
                    ? `${progress.completed} of ${progress.scheduled || 'unknown'} results complete · ${progress.running} running · ${progress.failed} failed`
                    : 'Connecting to live progress…'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => props.onOpen(runId)}
                >
                  Open Run
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  onClick={() => props.onCancel(runId)}
                >
                  Cancel Test run
                </Button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}
