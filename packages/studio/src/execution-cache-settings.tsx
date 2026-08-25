import { useCallback, useEffect, useState } from 'react'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './components/ui/table'
import { toast } from './components/ui/toast'
import { LedgerRowsSkeleton } from './loading-skeletons'
import type { StudioExecutionCacheInspection } from './server'

type ExecutionCacheSettingsProps = {
  api: <R>(path: string, init?: RequestInit) => Promise<R>
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

export function ExecutionCacheSettings(props: ExecutionCacheSettingsProps) {
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
        await props.api<StudioExecutionCacheInspection>('/api/execution-cache'),
      )
    } catch (reason) {
      setError(errorMessage(reason))
    } finally {
      setLoading(false)
    }
  }, [props.api])

  useEffect(() => {
    void load()
  }, [load])

  async function clear() {
    setClearing(true)
    setClearError(undefined)
    try {
      const result = await props.api<{ clearedEntries: number }>(
        '/api/execution-cache',
        { method: 'DELETE' },
      )
      setConfirmOpen(false)
      await load()
      toast.add({
        type: 'success',
        title: 'Execution cache cleared',
        description: `Cleared ${result.clearedEntries} cache ${result.clearedEntries === 1 ? 'revision' : 'revisions'}.`,
      })
    } catch (reason) {
      setClearError(errorMessage(reason))
    } finally {
      setClearing(false)
    }
  }

  const usedBytes =
    inspection?.entries.reduce((total, entry) => total + entry.sizeBytes, 0) ??
    0

  return (
    <section className="space-y-3" aria-labelledby="execution-cache-heading">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 id="execution-cache-heading" className="text-lg font-medium">
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
          disabled={loading || !inspection?.entries.length}
          onClick={() => {
            setClearError(undefined)
            setConfirmOpen(true)
          }}
        >
          Clear Execution cache
        </Button>
      </div>

      {loading ? <LedgerRowsSkeleton label="Loading Execution cache" /> : null}
      {!loading && error ? (
        <div className="space-y-2" role="alert">
          <p className="text-sm text-destructive">{error}</p>
          <Button type="button" variant="outline" onClick={() => void load()}>
            Retry
          </Button>
        </div>
      ) : null}
      {!loading && !error && inspection ? (
        inspection.entries.length === 0 ? (
          <p
            className="rounded-md border border-dashed p-4 text-sm text-muted-foreground"
            role="status"
          >
            No cached replay revisions for this checkout.
          </p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge>
                {inspection.entries.length}{' '}
                {inspection.entries.length === 1 ? 'revision' : 'revisions'}
              </Badge>
              <span>
                {byteCount(usedBytes)} of {byteCount(inspection.maxBytes)} used
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
                {inspection.entries.map((entry) => (
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
      ) : null}

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Clear Execution cache?</DialogTitle>
            <DialogDescription>
              This removes every cached replay revision for this checkout. The
              next run evaluates scenarios adaptively again.
            </DialogDescription>
          </DialogHeader>
          {clearError ? (
            <p className="text-sm text-destructive" role="alert">
              {clearError}
            </p>
          ) : null}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={clearing}
              onClick={() => setConfirmOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={clearing}
              onClick={() => void clear()}
            >
              {clearing ? 'Clearing…' : 'Clear cache'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
