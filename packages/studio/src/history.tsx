import type {
  TestRunComparison,
  TestRunManifest,
  TestRunSummary,
} from '@pickle-spec/runner'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from './components/ui/badge'
import { Button, buttonVariants } from './components/ui/button'
import { Checkbox } from './components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import { ResultMark } from './components/ui/result-mark'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './components/ui/table'
import { toast } from './components/ui/toast'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './components/ui/tooltip'
import { LedgerLoadingSkeleton } from './loading-skeletons'
import type { HistoryLocation } from './result-inspection'
import { reasonMessage, resultBadgeVariant } from './result-presentation'
import type {
  StudioHistory,
  StudioRunRequest,
  StudioRunSnapshot,
} from './server'
import { useVirtualWindow } from './virtualization'

type StudioApi = <Value>(path: string, init?: RequestInit) => Promise<Value>
const historyRowHeight = 80
const resultRowHeight = 56

interface HistoryPanelProps {
  api: StudioApi
  initialRunId?: string
  runPhase: 'idle' | 'running' | 'finished'
  onInspectResult: (location: HistoryLocation) => void
  onReviewRun: (runId: string) => void
  onRerun: (request: StudioRunRequest) => Promise<void>
  specification: { name: string; uri: string }
}

function durationLabel(durationMs: number | undefined): string {
  if (durationMs === undefined) return 'In progress'
  if (durationMs < 1_000) return `${durationMs} ms`
  return `${(durationMs / 1_000).toFixed(1)} s`
}

function resultCountLabel(count: number): string {
  return `${count} ${count === 1 ? 'result' : 'results'}`
}

function executionModesLabel(run: TestRunSummary): string {
  return run.executionModes?.join(', ') ?? 'Not recorded'
}

function cacheOutcomesLabel(run: TestRunSummary): string {
  return run.cacheOutcomes?.join(', ') ?? 'Not recorded'
}

function inferenceCountLabel(count: number | undefined): string {
  if (count === undefined) return 'Not recorded'
  return `${count} ${count === 1 ? 'inference' : 'inferences'}`
}

function bytesLabel(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(1)} KB`
  if (bytes < 1_024 ** 3) return `${(bytes / 1_024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1_024 ** 3).toFixed(1)} GB`
}

function sortedRuns(history: StudioHistory | undefined): TestRunSummary[] {
  return [...(history?.runs ?? [])].sort(
    (left, right) =>
      Date.parse(right.startedAt) - Date.parse(left.startedAt) ||
      right.id.localeCompare(left.id),
  )
}

export function HistoryPanel(props: HistoryPanelProps) {
  const [history, setHistory] = useState<StudioHistory>()
  const [error, setError] = useState<string>()
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])
  const [comparison, setComparison] = useState<TestRunComparison>()
  const [reviewed, setReviewed] = useState<TestRunManifest>()
  const reviewedSectionRef = useRef<HTMLElement>(null)
  const autoReviewedRunId = useRef<string | undefined>(undefined)
  const [includeAllArtifacts, setIncludeAllArtifacts] = useState(false)
  const runs = useMemo(
    () =>
      sortedRuns(history).filter((run) =>
        run.specificationUris.includes(props.specification.uri),
      ),
    [history, props.specification.uri],
  )
  const runWindow = useVirtualWindow<HTMLDivElement>({
    count: runs.length,
    itemSize: historyRowHeight,
  })
  const visibleRuns = runs.slice(runWindow.start, runWindow.end)
  const reviewedAttempts = useMemo(
    () =>
      (reviewed?.results ?? [])
        .filter(
          (result) => result.specification.uri === props.specification.uri,
        )
        .flatMap((result) =>
          result.attempts.map((attempt) => ({ result, attempt })),
        ),
    [props.specification.uri, reviewed?.results],
  )
  const resultWindow = useVirtualWindow<HTMLDivElement>({
    count: reviewedAttempts.length,
    itemSize: resultRowHeight,
  })
  const visibleAttempts = reviewedAttempts.slice(
    resultWindow.start,
    resultWindow.end,
  )

  const loadHistory = useCallback(async () => {
    setHistory(await props.api<StudioHistory>('/api/history'))
  }, [props.api])

  const loadReviewedRun = useCallback(
    async (runId: string) => {
      setError(undefined)
      try {
        const snapshot = await props.api<StudioRunSnapshot>(
          `/api/runs/${encodeURIComponent(runId)}`,
        )
        setReviewed(snapshot.manifest)
        return true
      } catch (reason) {
        setError(reasonMessage(reason))
        return false
      }
    },
    [props.api],
  )

  async function reviewRun(runId: string) {
    if (await loadReviewedRun(runId)) props.onReviewRun(runId)
  }

  const shouldLoadHistory =
    props.runPhase !== 'running' || history === undefined

  useEffect(() => {
    if (!shouldLoadHistory) return
    let cancelled = false
    loadHistory().catch((reason: unknown) => {
      if (!cancelled) setError(reasonMessage(reason))
    })
    return () => {
      cancelled = true
    }
  }, [loadHistory, shouldLoadHistory])

  useEffect(() => {
    if (reviewed) reviewedSectionRef.current?.focus()
  }, [reviewed])

  useEffect(() => {
    if (
      !props.initialRunId ||
      props.initialRunId === autoReviewedRunId.current ||
      reviewed?.id === props.initialRunId
    ) {
      return
    }
    autoReviewedRunId.current = props.initialRunId
    void loadReviewedRun(props.initialRunId)
  }, [loadReviewedRun, props.initialRunId, reviewed?.id])

  async function compareSelected() {
    if (selectedRunIds.length !== 2) return
    setError(undefined)
    try {
      setComparison(
        await props.api<TestRunComparison>('/api/history/compare', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            baselineRunId: selectedRunIds[1],
            candidateRunId: selectedRunIds[0],
          }),
        }),
      )
    } catch (reason) {
      setError(reasonMessage(reason))
    }
  }

  async function importArchive(file: File | undefined) {
    if (!file) return
    setError(undefined)
    try {
      const manifest = await props.api<TestRunManifest>('/api/history/import', {
        method: 'POST',
        body: file,
      })
      await loadHistory()
      toast.add({
        type: 'success',
        title: 'Test run imported',
        description: `Test run ${manifest.id} is now available in History.`,
      })
    } catch (reason) {
      setError(reasonMessage(reason))
    }
  }

  async function deleteEligible() {
    setError(undefined)
    try {
      const result = await props.api<{
        removed: string[]
        beforeBytes: number
        afterBytes: number
      }>('/api/history/retention', { method: 'POST' })
      setSelectedRunIds((current) =>
        current.filter((runId) => !result.removed.includes(runId)),
      )
      if (reviewed && result.removed.includes(reviewed.id)) {
        setReviewed(undefined)
      }
      if (selectedRunIds.some((runId) => result.removed.includes(runId))) {
        setComparison(undefined)
      }
      await loadHistory()
      const noRunsRemoved = result.removed.length === 0
      toast.add({
        type: noRunsRemoved ? 'info' : 'success',
        title: noRunsRemoved
          ? 'No Test runs deleted'
          : 'History retention applied',
        description: noRunsRemoved
          ? 'No local Test runs matched the configured retention policy.'
          : `Deleted ${result.removed.length} local Test runs · ${bytesLabel(result.beforeBytes)} → ${bytesLabel(result.afterBytes)}.`,
      })
    } catch (reason) {
      setError(reasonMessage(reason))
    }
  }

  async function setPinned(runId: string, pinned: boolean) {
    setError(undefined)
    try {
      await props.api(`/api/history/${encodeURIComponent(runId)}/pin`, {
        method: pinned ? 'POST' : 'DELETE',
      })
      await loadHistory()
      toast.add({
        type: 'success',
        title: `Test run ${pinned ? 'pinned' : 'unpinned'}`,
        description: pinned
          ? `${runId} is protected from retention deletion.`
          : `${runId} can be deleted by the retention policy.`,
      })
    } catch (reason) {
      setError(reasonMessage(reason))
    }
  }

  if (history === undefined && error === undefined) {
    return (
      <section className="min-h-0 flex-1 overflow-auto px-4 py-8 sm:px-8">
        <LedgerLoadingSkeleton label="Loading Test run history" />
      </section>
    )
  }

  const reviewedRun = reviewed
    ? runs.find((run) => run.id === reviewed.id)
    : undefined
  const artifactMode = includeAllArtifacts ? 'all' : 'failures'
  const retentionDays = history?.retention.maxAgeMs
    ? Math.round(history.retention.maxAgeMs / (24 * 60 * 60 * 1_000))
    : undefined
  const retentionConfigured = Boolean(
    history?.retention.maxAgeMs || history?.retention.maxBytes,
  )
  const pinnedRunIds = new Set(history?.storage.pinnedRunIds ?? [])

  return (
    <section
      aria-labelledby="run-history-title"
      className="min-h-0 flex-1 space-y-8 overflow-auto px-4 py-8 sm:px-8"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 id="run-history-title" className="studio-display text-2xl">
            Test run history
          </h3>
          <p className="text-sm text-muted-foreground">
            Runs containing {props.specification.name}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="file"
            accept="application/json,.json"
            aria-label="Import run archive"
            className="max-w-64"
            onChange={(event) =>
              void importArchive(event.currentTarget.files?.[0])
            }
          />
          <Button
            type="button"
            variant="outline"
            disabled={selectedRunIds.length !== 2}
            onClick={() => void compareSelected()}
          >
            Compare selected runs
          </Button>
        </div>
      </header>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {runs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center">
          <p className="text-sm text-muted-foreground">
            No test runs for this Specification yet.
          </p>
        </div>
      ) : (
        <section
          ref={runWindow.containerRef}
          aria-label="Scrollable test run history"
          // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users must be able to scroll a virtualized region
          tabIndex={0}
          className="max-h-[32rem] overflow-auto rounded-lg border border-border bg-card"
        >
          <Table aria-label="Test run history">
            <TableHeader>
              <TableRow>
                <TableHead>Compare</TableHead>
                <TableHead>Retention</TableHead>
                <TableHead>Started</TableHead>
                <TableHead>Suite</TableHead>
                <TableHead>Targets</TableHead>
                <TableHead>Application revision</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Execution mode</TableHead>
                <TableHead>Cache outcome</TableHead>
                <TableHead>Inferences</TableHead>
                <TableHead>Results</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <VirtualTableSpacer height={runWindow.before} colSpan={13} />
              {visibleRuns.map((run) => (
                <TableRow key={run.id} style={{ height: historyRowHeight }}>
                  <TableCell>
                    <Checkbox
                      aria-label={`Select ${run.id} for comparison`}
                      checked={selectedRunIds.includes(run.id)}
                      disabled={
                        !selectedRunIds.includes(run.id) &&
                        selectedRunIds.length === 2
                      }
                      onCheckedChange={(checked) =>
                        setSelectedRunIds((current) =>
                          checked
                            ? [...current, run.id]
                            : current.filter((id) => id !== run.id),
                        )
                      }
                    />
                  </TableCell>
                  <TableCell>
                    <Tooltip>
                      <TooltipTrigger
                        type="button"
                        className={buttonVariants({
                          variant: 'outline',
                          size: 'sm',
                        })}
                        aria-pressed={pinnedRunIds.has(run.id)}
                        onClick={() =>
                          void setPinned(run.id, !pinnedRunIds.has(run.id))
                        }
                      >
                        {pinnedRunIds.has(run.id) ? 'Unpin' : 'Pin'}
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        {pinnedRunIds.has(run.id)
                          ? 'Allow retention to delete this Test run.'
                          : 'Protect this Test run from retention deletion.'}
                      </TooltipContent>
                    </Tooltip>
                  </TableCell>
                  <TableCell>
                    <span className="block">
                      {new Date(run.startedAt).toLocaleString()}
                    </span>
                    <span className="font-mono text-muted-foreground">
                      {run.id}
                    </span>
                  </TableCell>
                  <TableCell>{run.suite ?? 'Ad hoc selection'}</TableCell>
                  <TableCell>
                    {run.executionTargetProfileIds.join(', ') || 'None'}
                  </TableCell>
                  <TableCell>{run.applicationRevision ?? 'Not set'}</TableCell>
                  <TableCell>{durationLabel(run.durationMs)}</TableCell>
                  <TableCell>
                    <Badge variant={resultBadgeVariant(run.state)}>
                      <ResultMark state={run.state} />
                      {run.state}
                    </Badge>
                  </TableCell>
                  <TableCell>{executionModesLabel(run)}</TableCell>
                  <TableCell>{cacheOutcomesLabel(run)}</TableCell>
                  <TableCell>
                    {inferenceCountLabel(run.inferenceCount)}
                  </TableCell>
                  <TableCell>{resultCountLabel(run.resultCount)}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => void reviewRun(run.id)}
                      >
                        Review run
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        disabled={
                          props.runPhase === 'running' ||
                          (run.state !== 'failed' &&
                            run.state !== 'infrastructure-error')
                        }
                        onClick={() =>
                          void props.onRerun({
                            rerunId: run.id,
                            failures: true,
                          })
                        }
                      >
                        Rerun failures
                      </Button>
                    </div>
                    {run.sourceRunId ? (
                      <span className="mt-1 block text-muted-foreground">
                        Rerun of {run.sourceRunId}
                      </span>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
              <VirtualTableSpacer height={runWindow.after} colSpan={13} />
            </TableBody>
          </Table>
        </section>
      )}

      {comparison ? <RunComparison comparison={comparison} /> : null}

      {reviewed ? (
        <section
          ref={reviewedSectionRef}
          className="space-y-3"
          aria-label={`Test run ${reviewed.id}`}
          tabIndex={-1}
        >
          <header className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="studio-display text-2xl">
                Test run {reviewed.id}
              </h3>
              <p className="text-xs text-muted-foreground">
                {reviewed.sourceRunId
                  ? `Rerun of ${reviewed.sourceRunId}`
                  : 'Original test run'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <DropdownMenu>
                <DropdownMenuTrigger
                  type="button"
                  className={buttonVariants({ variant: 'outline' })}
                >
                  Export
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuGroup>
                    <DropdownMenuLabel>Test run export</DropdownMenuLabel>
                    <DropdownMenuItem
                      nativeButton={false}
                      render={
                        <a
                          href={`/api/history/${encodeURIComponent(reviewed.id)}/archive`}
                          download
                        />
                      }
                    >
                      Run archive
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      nativeButton={false}
                      render={
                        <a
                          href={`/api/history/${encodeURIComponent(reviewed.id)}/html?artifacts=${artifactMode}`}
                          download
                        />
                      }
                    >
                      HTML report
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      nativeButton={false}
                      render={
                        <a
                          href={`/api/history/${encodeURIComponent(reviewed.id)}/allure`}
                          download
                        />
                      }
                    >
                      Allure results
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
              <span className="flex items-center gap-2">
                <Checkbox
                  id="complete-artifacts"
                  checked={includeAllArtifacts}
                  onCheckedChange={setIncludeAllArtifacts}
                />
                <Label htmlFor="complete-artifacts">
                  Include all artifacts
                </Label>
              </span>
            </div>
          </header>
          <section
            ref={resultWindow.containerRef}
            aria-label="Scrollable test run results"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users must be able to scroll a virtualized region
            tabIndex={0}
            className="max-h-[32rem] overflow-auto rounded-lg border border-border bg-card"
          >
            <Table aria-label="Test run results">
              <TableHeader>
                <TableRow>
                  <TableHead>Scenario</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>State</TableHead>
                  <TableHead>Attempt</TableHead>
                  <TableHead>Execution mode</TableHead>
                  <TableHead>Cache outcome</TableHead>
                  <TableHead>Uncacheable reason</TableHead>
                  <TableHead>Inferences</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <VirtualTableSpacer height={resultWindow.before} colSpan={10} />
                {visibleAttempts.map(({ result, attempt }) => {
                  return (
                    <TableRow
                      key={`${result.scenario.id ?? result.scenario.name}:${result.scenario.examplesRowId ?? ''}:${result.executionTargetProfile.id}:${attempt.attempt}`}
                      style={{ height: resultRowHeight }}
                    >
                      <TableCell>{result.scenario.name}</TableCell>
                      <TableCell>{result.executionTargetProfile.id}</TableCell>
                      <TableCell>{attempt.state}</TableCell>
                      <TableCell>{attempt.attempt}</TableCell>
                      <TableCell>
                        {attempt.executionMode ?? 'Not recorded'}
                      </TableCell>
                      <TableCell>
                        {attempt.cacheOutcome ?? 'Not recorded'}
                      </TableCell>
                      <TableCell>
                        {attempt.cacheUncacheableReason ?? 'Not recorded'}
                      </TableCell>
                      <TableCell>
                        {inferenceCountLabel(attempt.inferenceCount)}
                      </TableCell>
                      <TableCell>{durationLabel(attempt.durationMs)}</TableCell>
                      <TableCell>
                        <div className="flex gap-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              props.onInspectResult({
                                specificationUri: result.specification.uri,
                                runId: reviewed.id,
                                scenarioId:
                                  result.scenario.id ?? result.scenario.name,
                                examplesRowId: result.scenario.examplesRowId,
                                profileId: result.executionTargetProfile.id,
                                attempt: attempt.attempt,
                              })
                            }
                          >
                            Inspect result
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={props.runPhase === 'running'}
                            onClick={() =>
                              void props.onRerun({
                                rerunId: reviewed.id,
                                ...(result.scenario.id
                                  ? { scenarioId: result.scenario.id }
                                  : { scenarioName: result.scenario.name }),
                              })
                            }
                          >
                            Rerun Scenario
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={props.runPhase === 'running'}
                            onClick={() =>
                              void props.onRerun({
                                rerunId: reviewed.id,
                                profiles: [result.executionTargetProfile.id],
                              })
                            }
                          >
                            Rerun target
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
                <VirtualTableSpacer height={resultWindow.after} colSpan={10} />
              </TableBody>
            </Table>
          </section>
          {reviewedRun ? null : (
            <p className="text-xs text-muted-foreground">
              This test run is no longer in local history.
            </p>
          )}
        </section>
      ) : null}

      {history ? (
        <section
          className="flex flex-wrap items-center justify-between gap-5 rounded-xl border border-border bg-card p-6"
          aria-labelledby="run-storage-title"
        >
          <div className="min-w-0 space-y-1">
            <h3 id="run-storage-title" className="studio-display text-2xl">
              Local test run storage
            </h3>
            <p className="text-xs text-muted-foreground">
              {bytesLabel(history.storage.totalBytes)} stored · Warning at{' '}
              {bytesLabel(history.storage.warningThresholdBytes)}
            </p>
            <p className="text-xs text-muted-foreground">
              {retentionConfigured
                ? [
                    retentionDays ? `${retentionDays} days` : undefined,
                    history.retention.maxBytes
                      ? bytesLabel(history.retention.maxBytes)
                      : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')
                : 'No deletion policy configured. Test runs are retained until you configure a limit.'}
            </p>
            {history.storage.warning ? (
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
            onClick={() => void deleteEligible()}
          >
            Delete eligible history
          </Button>
        </section>
      ) : null}
    </section>
  )
}

type VirtualTableSpacerProps = {
  height: number
  colSpan: number
}

function VirtualTableSpacer(props: VirtualTableSpacerProps) {
  if (props.height === 0) return null
  return (
    <TableRow aria-hidden="true" className="border-0 hover:bg-transparent">
      <TableCell
        colSpan={props.colSpan}
        className="p-0"
        style={{ height: props.height }}
      />
    </TableRow>
  )
}

function RunComparison(props: { comparison: TestRunComparison }) {
  const rows = [
    ...props.comparison.pairs.map((pair) => ({
      key: `pair:${pair.scenarioId}:${pair.executionTargetProfileId}`,
      scenario: pair.candidate.scenario.name,
      profile: pair.executionTargetProfileId,
      baseline: pair.baseline.state,
      candidate: pair.candidate.state,
      changes: pair.changes.join(', '),
    })),
    ...props.comparison.removed.map((side) => ({
      key: `removed:${side.scenarioId}:${side.executionTargetProfileId}`,
      scenario: side.result.scenario.name,
      profile: side.executionTargetProfileId,
      baseline: side.result.state,
      candidate: 'Not run',
      changes: 'removed',
    })),
    ...props.comparison.added.map((side) => ({
      key: `added:${side.scenarioId}:${side.executionTargetProfileId}`,
      scenario: side.result.scenario.name,
      profile: side.executionTargetProfileId,
      baseline: 'Not run',
      candidate: side.result.state,
      changes: 'added',
    })),
  ]

  return (
    <section className="space-y-2">
      <h3 className="studio-display text-2xl">Run comparison</h3>
      <div className="rounded-xl border border-border bg-card">
        <Table aria-label="Run comparison">
          <TableHeader>
            <TableRow>
              <TableHead>Scenario</TableHead>
              <TableHead>Target</TableHead>
              <TableHead>Baseline</TableHead>
              <TableHead>Candidate</TableHead>
              <TableHead>Changes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.key}>
                <TableCell>{row.scenario}</TableCell>
                <TableCell>{row.profile}</TableCell>
                <TableCell>{row.baseline}</TableCell>
                <TableCell>{row.candidate}</TableCell>
                <TableCell>{row.changes}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        {rows.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            These test runs have identical compatible results.
          </p>
        ) : null}
      </div>
    </section>
  )
}
