import type { TestRunManifest } from '@pickle-spec/runner'
import { useEffect, useMemo, useState } from 'react'
import { LedgerLoadingSkeleton } from '../components/loading-skeletons'
import { Badge } from '../components/ui/badge'
import { Button, buttonVariants } from '../components/ui/button'
import { Checkbox } from '../components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { Label } from '../components/ui/label'
import { ResultMark } from '../components/ui/result-mark'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../components/ui/table'
import { useVirtualWindow } from '../hooks/use-virtual-window'
import type { StudioRunRequest, StudioRunSnapshot } from '../server/server'
import type { LiveResultInspection } from './result/live-result-inspection'
import type { ResultInspectionLocation } from './result/result-inspection'
import { reasonMessage, resultBadgeVariant } from './result/result-presentation'
import { durationLabel, inferenceCountLabel } from './run-format'
import { VirtualTableSpacer } from './virtual-table-spacer'

type StudioApi = <Value>(path: string, init?: RequestInit) => Promise<Value>

type RunDetailProps = {
  api: StudioApi
  runId: string
  live?: LiveResultInspection
  runsBlocked: boolean
  onBack: () => void
  onCancel: (runId: string) => void
  onInspectResult: (location: ResultInspectionLocation) => void
  onRerun: (request: StudioRunRequest) => Promise<void>
}

const resultRowHeight = 56

export function RunDetail(props: RunDetailProps) {
  const [fetched, setFetched] = useState<StudioRunSnapshot>()
  const [error, setError] = useState<string>()
  const [includeAllArtifacts, setIncludeAllArtifacts] = useState(false)

  useEffect(() => {
    if (props.live?.snapshot) return
    let cancelled = false
    setFetched(undefined)
    setError(undefined)
    props
      .api<StudioRunSnapshot>(`/api/runs/${encodeURIComponent(props.runId)}`)
      .then(
        (snapshot) => {
          if (!cancelled) setFetched(snapshot)
        },
        (reason: unknown) => {
          if (!cancelled) setError(reasonMessage(reason))
        },
      )
    return () => {
      cancelled = true
    }
  }, [props.api, props.live?.snapshot, props.runId])

  const snapshot = props.live?.snapshot ?? fetched
  const attempts = useMemo(
    () =>
      (snapshot?.manifest?.results ?? []).flatMap((result) =>
        result.attempts.map((attempt) => ({ result, attempt })),
      ),
    [snapshot?.manifest?.results],
  )
  const resultWindow = useVirtualWindow<HTMLDivElement>({
    count: attempts.length,
    itemSize: resultRowHeight,
  })

  if (error) {
    return (
      <RunDetailMessage onBack={props.onBack}>
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      </RunDetailMessage>
    )
  }
  if (!snapshot?.manifest) {
    return (
      <section className="min-h-0 flex-1 overflow-auto p-4">
        <LedgerLoadingSkeleton label="Opening Test run" />
      </section>
    )
  }

  const manifest = snapshot.manifest
  const running = props.live?.phase === 'running'
  const artifactMode = includeAllArtifacts ? 'all' : 'failures'
  const visibleAttempts = attempts.slice(resultWindow.start, resultWindow.end)

  return (
    <section className="min-h-0 flex-1 space-y-5 overflow-auto px-3 py-4 sm:px-5">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
        <div className="min-w-0 space-y-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={props.onBack}
          >
            Back to Runs
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="studio-display text-lg sm:text-xl">
              Test run {manifest.id}
            </h1>
            <Badge
              variant={running ? 'running' : resultBadgeVariant(manifest.state)}
            >
              <ResultMark state={running ? 'running' : manifest.state} />
              {running ? 'running' : manifest.state}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {manifest.sourceRunId
              ? `Rerun of ${manifest.sourceRunId}`
              : 'Original Test run'}
          </p>
          {props.live?.connection.kind === 'disconnected' ? (
            <p role="status" className="text-sm text-destructive">
              {props.live.connection.message}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <Button
              type="button"
              variant="destructive"
              onClick={() => props.onCancel(manifest.id)}
            >
              Cancel Test run
            </Button>
          ) : (
            <ExportMenu
              runId={manifest.id}
              artifactMode={artifactMode}
              includeAllArtifacts={includeAllArtifacts}
              onIncludeAllArtifacts={setIncludeAllArtifacts}
            />
          )}
          <Button
            type="button"
            variant="outline"
            disabled={
              props.runsBlocked ||
              (manifest.state !== 'failed' &&
                manifest.state !== 'infrastructure-error')
            }
            onClick={() =>
              void props.onRerun({ rerunId: manifest.id, failures: true })
            }
          >
            Rerun failures
          </Button>
        </div>
      </header>

      <RunMetadata manifest={manifest} />

      <section className="space-y-2" aria-labelledby="run-results-title">
        <div className="flex items-center justify-between gap-3">
          <h2 id="run-results-title" className="studio-display text-sm">
            Test results
          </h2>
          <span className="text-xs text-muted-foreground">
            {attempts.length} {attempts.length === 1 ? 'attempt' : 'attempts'}
          </span>
        </div>
        {attempts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
            {running
              ? 'Waiting for the first Scenario to start.'
              : 'This Test run has no results.'}
          </div>
        ) : (
          <section
            ref={resultWindow.containerRef}
            aria-label="Scrollable Test run results"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users must be able to scroll a virtualized region
            tabIndex={0}
            className="max-h-[36rem] overflow-auto rounded-lg border border-border bg-card"
          >
            <Table aria-label="Test run results">
              <TableHeader>
                <TableRow>
                  <TableHead>Specification</TableHead>
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
                <VirtualTableSpacer height={resultWindow.before} colSpan={11} />
                {visibleAttempts.map(({ result, attempt }) => (
                  <TableRow
                    key={`${result.specification.uri}:${result.scenario.id ?? result.scenario.name}:${result.scenario.examplesRowId ?? ''}:${result.executionTargetProfile.id}:${attempt.attempt}`}
                    style={{ height: resultRowHeight }}
                  >
                    <TableCell>{result.specification.name}</TableCell>
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
                              runId: manifest.id,
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
                          disabled={props.runsBlocked}
                          onClick={() =>
                            void props.onRerun({
                              rerunId: manifest.id,
                              scenarioId: result.scenario.id,
                              scenarioName: result.scenario.id
                                ? undefined
                                : result.scenario.name,
                            })
                          }
                        >
                          Rerun Scenario
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={props.runsBlocked}
                          onClick={() =>
                            void props.onRerun({
                              rerunId: manifest.id,
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
                <VirtualTableSpacer height={resultWindow.after} colSpan={11} />
              </TableBody>
            </Table>
          </section>
        )}
      </section>
    </section>
  )
}

function RunDetailMessage(props: {
  children: React.ReactNode
  onBack: () => void
}) {
  return (
    <section className="min-h-0 flex-1 space-y-3 overflow-auto p-4">
      {props.children}
      <Button type="button" variant="outline" onClick={props.onBack}>
        Back to Runs
      </Button>
    </section>
  )
}

function RunMetadata(props: { manifest: TestRunManifest }) {
  const durationMs = props.manifest.finishedAt
    ? Date.parse(props.manifest.finishedAt) -
      Date.parse(props.manifest.startedAt)
    : undefined
  const profileIds = [
    ...new Set(
      props.manifest.results.map((result) => result.executionTargetProfile.id),
    ),
  ]
  const executionModes = [
    ...new Set(
      props.manifest.results.flatMap((result) =>
        result.attempts.flatMap((attempt) =>
          attempt.executionMode ? [attempt.executionMode] : [],
        ),
      ),
    ),
  ]
  const cacheOutcomes = [
    ...new Set(
      props.manifest.results.flatMap((result) =>
        result.attempts.flatMap((attempt) =>
          attempt.cacheOutcome ? [attempt.cacheOutcome] : [],
        ),
      ),
    ),
  ]
  const inferenceCount = props.manifest.results.reduce((total, result) => {
    return total + (result.attempts.at(-1)?.inferenceCount ?? 0)
  }, 0)
  return (
    <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
      <Metadata
        label="Started"
        value={new Date(props.manifest.startedAt).toLocaleString()}
      />
      <Metadata label="Duration" value={durationLabel(durationMs)} />
      <Metadata
        label="Suite"
        value={props.manifest.suite ?? 'Ad hoc selection'}
      />
      <Metadata
        label="Application revision"
        value={props.manifest.applicationRevision ?? 'Not set'}
        mono
      />
      <Metadata label="Targets" value={profileIds.join(', ') || 'None'} />
      <Metadata
        label="Execution modes"
        value={executionModes.join(', ') || 'Not recorded'}
      />
      <Metadata
        label="Cache outcomes"
        value={cacheOutcomes.join(', ') || 'Not recorded'}
      />
      <Metadata
        label="Inferences"
        value={inferenceCountLabel(inferenceCount)}
      />
      <Metadata label="Results" value={String(props.manifest.results.length)} />
    </dl>
  )
}

function Metadata(props: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs text-muted-foreground">{props.label}</dt>
      <dd className={props.mono ? 'break-all font-mono text-xs' : 'text-sm'}>
        {props.value}
      </dd>
    </div>
  )
}

function ExportMenu(props: {
  runId: string
  artifactMode: 'all' | 'failures'
  includeAllArtifacts: boolean
  onIncludeAllArtifacts: (checked: boolean) => void
}) {
  return (
    <>
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
            <ExportItem
              runId={props.runId}
              kind="archive"
              label="Run archive"
            />
            <ExportItem
              runId={props.runId}
              kind={`html?artifacts=${props.artifactMode}`}
              label="HTML report"
            />
            <ExportItem
              runId={props.runId}
              kind="allure"
              label="Allure results"
            />
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="flex items-center gap-2">
        <Checkbox
          id="complete-artifacts"
          checked={props.includeAllArtifacts}
          onCheckedChange={props.onIncludeAllArtifacts}
        />
        <Label htmlFor="complete-artifacts">Include all artifacts</Label>
      </span>
    </>
  )
}

function ExportItem(props: { runId: string; kind: string; label: string }) {
  return (
    <DropdownMenuItem
      nativeButton={false}
      render={
        <a
          href={`/api/history/${encodeURIComponent(props.runId)}/${props.kind}`}
          download
        />
      }
    >
      {props.label}
    </DropdownMenuItem>
  )
}
