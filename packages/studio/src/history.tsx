import type {
  TestRunComparison,
  TestRunManifest,
  TestRunSummary,
} from '@pickle-spec/runner'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Checkbox } from './components/ui/checkbox'
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
  runPhase: 'idle' | 'running' | 'finished'
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

function bytesLabel(bytes: number): string {
  if (bytes < 1_024) return `${bytes} B`
  if (bytes < 1_024 ** 2) return `${(bytes / 1_024).toFixed(1)} KB`
  if (bytes < 1_024 ** 3) return `${(bytes / 1_024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1_024 ** 3).toFixed(1)} GB`
}

function stateVariant(state: TestRunSummary['state']) {
  if (state === 'failed' || state === 'infrastructure-error') return 'failed'
  if (state === 'passed-with-adaptation') return 'adaptation'
  if (state === 'passed') return 'passed'
  return 'default'
}

function reasonMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
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
  const [notice, setNotice] = useState<string>()
  const [selectedRunIds, setSelectedRunIds] = useState<string[]>([])
  const [comparison, setComparison] = useState<TestRunComparison>()
  const [reviewed, setReviewed] = useState<TestRunManifest>()
  const reviewedSectionRef = useRef<HTMLElement>(null)
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
  const reviewedResults = reviewed?.results ?? []
  const resultWindow = useVirtualWindow<HTMLDivElement>({
    count: reviewedResults.length,
    itemSize: resultRowHeight,
  })
  const visibleResults = reviewedResults.slice(
    resultWindow.start,
    resultWindow.end,
  )

  const loadHistory = useCallback(async () => {
    setHistory(await props.api<StudioHistory>('/api/history'))
  }, [props.api])

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

  async function reviewRun(runId: string) {
    setError(undefined)
    try {
      const snapshot = await props.api<StudioRunSnapshot>(
        `/api/runs/${encodeURIComponent(runId)}`,
      )
      setReviewed(snapshot.manifest)
    } catch (reason) {
      setError(reasonMessage(reason))
    }
  }

  async function importArchive(file: File | undefined) {
    if (!file) return
    setError(undefined)
    setNotice(undefined)
    try {
      const manifest = await props.api<TestRunManifest>('/api/history/import', {
        method: 'POST',
        body: file,
      })
      await loadHistory()
      setNotice(`Imported test run ${manifest.id}`)
    } catch (reason) {
      setError(reasonMessage(reason))
    }
  }

  async function deleteEligible() {
    setError(undefined)
    setNotice(undefined)
    try {
      const result = await props.api<{ removed: string[] }>(
        '/api/history/retention',
        { method: 'POST' },
      )
      setSelectedRunIds([])
      setReviewed(undefined)
      setComparison(undefined)
      await loadHistory()
      setNotice(`Deleted ${result.removed.length} local test runs`)
    } catch (reason) {
      setError(reasonMessage(reason))
    }
  }

  const reviewedRun = reviewed
    ? runs.find((run) => run.id === reviewed.id)
    : undefined
  const artifactMode = includeAllArtifacts ? 'all' : 'failures-and-adaptations'
  const retentionDays = history
    ? Math.round(history.retention.maxAgeMs / (24 * 60 * 60 * 1_000))
    : undefined

  return (
    <section
      aria-labelledby="run-history-title"
      className="min-h-0 flex-1 space-y-5 overflow-auto px-6 py-4"
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 id="run-history-title" className="text-sm font-medium">
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
      {notice ? (
        <p role="status" className="text-sm text-muted-foreground">
          {notice}
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
                <TableHead>Started</TableHead>
                <TableHead>Suite</TableHead>
                <TableHead>Targets</TableHead>
                <TableHead>Application revision</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>State</TableHead>
                <TableHead>Results</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              <VirtualTableSpacer height={runWindow.before} colSpan={9} />
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
                    <Badge variant={stateVariant(run.state)}>
                      <ResultMark state={run.state} />
                      {run.state}
                    </Badge>
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
              <VirtualTableSpacer height={runWindow.after} colSpan={9} />
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
              <h3 className="text-sm font-medium">Test run {reviewed.id}</h3>
              <p className="text-xs text-muted-foreground">
                {reviewed.sourceRunId
                  ? `Rerun of ${reviewed.sourceRunId}`
                  : 'Original test run'}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="adaptation"
                disabled={
                  props.runPhase === 'running' ||
                  !reviewed.results.some(
                    (result) => result.state === 'passed-with-adaptation',
                  )
                }
                onClick={() =>
                  void props.onRerun({
                    rerunId: reviewed.id,
                    adaptations: true,
                  })
                }
              >
                Rerun adaptations
              </Button>
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <a
                    href={`/api/history/${encodeURIComponent(reviewed.id)}/archive`}
                    // biome-ignore lint/a11y/noRedundantRoles: override Base UI's injected button role
                    role="link"
                    download
                  />
                }
              >
                Export archive
              </Button>
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <a
                    href={`/api/history/${encodeURIComponent(reviewed.id)}/html?artifacts=${artifactMode}`}
                    // biome-ignore lint/a11y/noRedundantRoles: override Base UI's injected button role
                    role="link"
                    download
                  />
                }
              >
                Export HTML
              </Button>
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
                  <TableHead>Duration</TableHead>
                  <TableHead>Rerun</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <VirtualTableSpacer height={resultWindow.before} colSpan={5} />
                {visibleResults.map((result) => (
                  <TableRow
                    key={`${result.scenario.id ?? result.scenario.name}:${result.executionTargetProfile.id}`}
                    style={{ height: resultRowHeight }}
                  >
                    <TableCell>{result.scenario.name}</TableCell>
                    <TableCell>{result.executionTargetProfile.id}</TableCell>
                    <TableCell>{result.state}</TableCell>
                    <TableCell>{durationLabel(result.durationMs)}</TableCell>
                    <TableCell>
                      <div className="flex gap-2">
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
                ))}
                <VirtualTableSpacer height={resultWindow.after} colSpan={5} />
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
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card p-4">
          <div>
            <h3 className="text-sm font-medium">Retention</h3>
            <p className="text-xs text-muted-foreground">
              {retentionDays} days · {bytesLabel(history.retention.maxBytes)}
            </p>
          </div>
          <Button
            type="button"
            variant="destructive"
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
      <h3 className="text-sm font-medium">Run comparison</h3>
      <div className="rounded-lg border border-border bg-card">
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
