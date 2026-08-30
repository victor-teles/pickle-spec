import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from 'react'
import type { StudioApi } from '../app/studio-api'
import { LedgerRowsSkeleton } from '../components/loading-skeletons'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import { toast } from '../components/ui/toast'
import type { StudioExecutionCacheInspection } from '../server/contracts'

type ExecutionCacheSettingsProps = {
  api: StudioApi
}

function byteCount(value: number): string {
  if (value < 1_024) return `${value} B`
  if (value < 1_024 * 1_024) return `${(value / 1_024).toFixed(1)} KiB`
  return `${(value / (1_024 * 1_024)).toFixed(1)} MiB`
}

function dateTime(value: string): string {
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString()
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function ExecutionCacheTable(props: {
  inspection: StudioExecutionCacheInspection
}) {
  const usedBytes = props.inspection.entries.reduce(
    (total, entry) => total + entry.sizeBytes,
    0,
  )
  if (props.inspection.entries.length === 0) {
    return (
      <p
        className="rounded-md border border-dashed p-4 text-sm text-muted-foreground"
        role="status"
      >
        No cached replay revisions for this checkout.
      </p>
    )
  }
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        <Badge>
          {props.inspection.entries.length}{' '}
          {props.inspection.entries.length === 1 ? 'revision' : 'revisions'}
        </Badge>
        <span>
          {byteCount(usedBytes)} of {byteCount(props.inspection.maxBytes)} used
        </span>
      </div>
      <Table aria-label="Execution cache revisions">
        <TableHeader>
          <TableRow>
            <TableHead>Scenario</TableHead>
            <TableHead>Target</TableHead>
            <TableHead>Scenario revision</TableHead>
            <TableHead>Application revision</TableHead>
            <TableHead>Adapter revision</TableHead>
            <TableHead>Size</TableHead>
            <TableHead>Last used</TableHead>
            <TableHead>Hits</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.inspection.entries.map((entry) => (
            <TableRow key={entry.payloadDigest}>
              <TableCell className="font-mono">
                {entry.key.scenarioId}
              </TableCell>
              <TableCell>{entry.key.executionTargetProfileId}</TableCell>
              <TableCell className="font-mono">
                {entry.key.scenarioRevision}
              </TableCell>
              <TableCell className="font-mono">
                {entry.key.applicationRevision}
              </TableCell>
              <TableCell className="font-mono">
                {entry.key.adapterCacheSchemaVersion}
              </TableCell>
              <TableCell>{byteCount(entry.sizeBytes)}</TableCell>
              <TableCell>{dateTime(entry.lastUsedAt)}</TableCell>
              <TableCell>{entry.hitCount}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  )
}

function ExecutionCacheContent(props: {
  loading: boolean
  error?: string
  inspection?: StudioExecutionCacheInspection
  onRetry: () => void
}) {
  if (props.loading)
    return <LedgerRowsSkeleton label="Loading Execution cache" />
  if (props.error) {
    return (
      <div className="space-y-2" role="alert">
        <p className="text-sm text-destructive">{props.error}</p>
        <Button type="button" variant="outline" onClick={props.onRetry}>
          Retry
        </Button>
      </div>
    )
  }
  return props.inspection ? (
    <ExecutionCacheTable inspection={props.inspection} />
  ) : null
}

function ClearExecutionCacheDialog(props: {
  clearing: boolean
  error?: string
  open: boolean
  onCancel: () => void
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clear Execution cache?</DialogTitle>
          <DialogDescription>
            This removes every cached replay revision for this checkout. The
            next run evaluates scenarios adaptively again.
          </DialogDescription>
        </DialogHeader>
        {props.error ? (
          <p className="text-sm text-destructive" role="alert">
            {props.error}
          </p>
        ) : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={props.clearing}
            onClick={props.onCancel}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={props.clearing}
            onClick={props.onConfirm}
          >
            {props.clearing ? 'Clearing…' : 'Clear cache'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

interface ClearExecutionCacheInput {
  api: StudioApi
  load: () => Promise<void>
  setClearing: Dispatch<SetStateAction<boolean>>
  setClearError: Dispatch<SetStateAction<string | undefined>>
  setConfirmOpen: Dispatch<SetStateAction<boolean>>
}

async function clearExecutionCache(input: ClearExecutionCacheInput) {
  input.setClearing(true)
  input.setClearError(undefined)
  try {
    const result = await input.api<{ clearedEntries: number }>(
      '/api/execution-cache',
      { method: 'DELETE' },
    )
    input.setConfirmOpen(false)
    await input.load()
    toast.add({
      type: 'success',
      title: 'Execution cache cleared',
      description: `Cleared ${result.clearedEntries} cache ${result.clearedEntries === 1 ? 'revision' : 'revisions'}.`,
    })
  } catch (reason) {
    input.setClearError(errorMessage(reason))
  } finally {
    input.setClearing(false)
  }
}

function useExecutionCacheSettings(api: StudioApi) {
  const [inspection, setInspection] = useState<StudioExecutionCacheInspection>()
  const [error, setError] = useState<string>()
  const [clearError, setClearError] = useState<string>()
  const [loading, setLoading] = useState(true)
  const [clearing, setClearing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const load = useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      setInspection(
        await api<StudioExecutionCacheInspection>('/api/execution-cache'),
      )
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [api])
  useEffect(() => void load(), [load])
  const clear = () =>
    clearExecutionCache({
      api,
      load,
      setClearing,
      setClearError,
      setConfirmOpen,
    })
  return {
    inspection,
    error,
    clearError,
    loading,
    clearing,
    confirmOpen,
    setConfirmOpen,
    clear,
    load,
    openConfirmation() {
      setClearError(undefined)
      setConfirmOpen(true)
    },
  }
}

export function ExecutionCacheSettings(props: ExecutionCacheSettingsProps) {
  const state = useExecutionCacheSettings(props.api)

  return (
    <section
      className="space-y-5 border-t border-border pt-8"
      aria-labelledby="execution-cache-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="execution-cache-heading" className="studio-display text-sm">
            Execution cache
          </h2>
          <p className="max-w-2xl text-sm text-muted-foreground">
            Local replay revisions for this checkout. Only operational metadata
            is shown; runtime values and cached payloads remain private.
          </p>
        </div>
        <Button
          type="button"
          variant="destructive"
          disabled={state.loading || !state.inspection?.entries.length}
          onClick={state.openConfirmation}
        >
          Clear Execution cache
        </Button>
      </div>

      <ExecutionCacheContent
        loading={state.loading}
        error={state.error}
        inspection={state.inspection}
        onRetry={() => void state.load()}
      />

      <ClearExecutionCacheDialog
        clearing={state.clearing}
        error={state.clearError}
        open={state.confirmOpen}
        onCancel={() => state.setConfirmOpen(false)}
        onConfirm={() => void state.clear()}
        onOpenChange={state.setConfirmOpen}
      />
    </section>
  )
}
