import type { TestRunExportFormat, TestRunManifest } from '@pickle-spec/runner'
import { useEffect, useState } from 'react'
import { LedgerLoadingSkeleton } from '../../components/loading-skeletons'
import { Badge } from '../../components/ui/badge'
import { Button, buttonVariants } from '../../components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu'
import { ResultMark } from '../../components/ui/result-mark'
import type { StudioApi } from '../../lib/studio-api'
import type {
  StudioRunRequest,
  StudioRunSnapshot,
} from '../../server/contracts'
import { studioRunReportDescriptors } from '../history/history.contracts'
import type { LiveResultInspection } from './result/live-result-inspection'
import type { ResultInspectionLocation } from './result/result-inspection'
import { reasonMessage, resultBadgeVariant } from './result/result-presentation'
import { RunAttempts } from './run-attempts'
import { durationLabel, inferenceCountLabel } from './run-format'

type RunDetailProps = {
  api: StudioApi
  runId: string
  location?: ResultInspectionLocation
  live?: LiveResultInspection
  runsBlocked: boolean
  onBack: () => void
  onCancel: (runId: string) => void
  onOpenArtifact: (
    location: ResultInspectionLocation,
    artifactIndex: number,
  ) => void
  onSelectLocation: (location: ResultInspectionLocation) => void
  onRerun: (request: StudioRunRequest) => Promise<void>
}

function useFetchedRunSnapshot(props: RunDetailProps) {
  const [snapshot, setSnapshot] = useState<StudioRunSnapshot>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    if (props.live?.snapshot) return
    let cancelled = false
    setSnapshot(undefined)
    setError(undefined)
    void props
      .api<StudioRunSnapshot>(`/api/runs/${encodeURIComponent(props.runId)}`)
      .then(
        (value) => {
          if (!cancelled) setSnapshot(value)
        },
        (reason: unknown) => {
          if (!cancelled) setError(reasonMessage(reason))
        },
      )
    return () => {
      cancelled = true
    }
  }, [props.api, props.live?.snapshot, props.runId])
  return { snapshot, error }
}

export function RunDetail(props: RunDetailProps) {
  const fetched = useFetchedRunSnapshot(props)
  const [includeAllArtifacts, setIncludeAllArtifacts] = useState(false)
  const snapshot = props.live?.snapshot ?? fetched.snapshot

  if (fetched.error) {
    return (
      <RunDetailMessage onBack={props.onBack}>
        <p role="alert" className="text-sm text-destructive">
          {fetched.error}
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
  return (
    <LoadedRunDetail
      {...props}
      manifest={snapshot.manifest}
      snapshot={snapshot}
      selectedLocation={props.location}
      includeAllArtifacts={includeAllArtifacts}
      onIncludeAllArtifacts={setIncludeAllArtifacts}
    />
  )
}

function RunDetailHeader(
  props: RunDetailProps & {
    manifest: TestRunManifest
    running: boolean
    includeAllArtifacts: boolean
    onIncludeAllArtifacts: (include: boolean) => void
  },
) {
  const displayState = props.running ? 'running' : props.manifest.state
  const rerunDisabled =
    props.runsBlocked ||
    (props.manifest.state !== 'failed' &&
      props.manifest.state !== 'infrastructure-error')
  function cancelRun() {
    props.onCancel(props.manifest.id)
  }
  function rerunFailures() {
    void props.onRerun({ rerunId: props.manifest.id, failures: true })
  }
  return (
    <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
      <div className="min-w-0 space-y-2">
        <Button type="button" variant="ghost" size="sm" onClick={props.onBack}>
          Back to Runs
        </Button>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="studio-display text-lg sm:text-xl">
            Test run {props.manifest.id}
          </h1>
          <Badge
            variant={
              displayState === 'running'
                ? 'running'
                : resultBadgeVariant(displayState)
            }
          >
            <ResultMark state={displayState} />
            {displayState}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground">
          {props.manifest.sourceRunId
            ? `Rerun of ${props.manifest.sourceRunId}`
            : 'Original Test run'}
        </p>
        {props.live?.connection.kind === 'disconnected' ? (
          <p role="status" className="text-sm text-destructive">
            {props.live.connection.message}
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {props.running ? (
          <Button type="button" variant="destructive" onClick={cancelRun}>
            Cancel Test run
          </Button>
        ) : (
          <ExportMenu
            runId={props.manifest.id}
            includeAllArtifacts={props.includeAllArtifacts}
            onIncludeAllArtifacts={props.onIncludeAllArtifacts}
          />
        )}
        <Button
          type="button"
          variant="outline"
          disabled={rerunDisabled}
          onClick={rerunFailures}
        >
          Rerun failures
        </Button>
      </div>
    </header>
  )
}

function LoadedRunDetail(
  props: RunDetailProps & {
    manifest: TestRunManifest
    snapshot: StudioRunSnapshot
    selectedLocation?: ResultInspectionLocation
    includeAllArtifacts: boolean
    onIncludeAllArtifacts: (include: boolean) => void
    onSelectLocation: (location: ResultInspectionLocation) => void
  },
) {
  const manifest = props.manifest
  const running = props.live?.phase === 'running'

  return (
    <section className="min-h-0 flex-1 space-y-5 overflow-auto px-3 py-4 sm:px-5">
      <RunDetailHeader {...props} manifest={manifest} running={running} />

      <RunMetadata manifest={manifest} />

      <RunAttempts {...props} running={running} />
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
  const values = runMetadataValues(props.manifest)
  return (
    <dl className="grid gap-x-6 gap-y-4 rounded-xl border border-border bg-card p-4 sm:grid-cols-2 lg:grid-cols-4">
      <Metadata
        label="Started"
        value={new Date(props.manifest.startedAt).toLocaleString()}
      />
      <Metadata label="Duration" value={durationLabel(values.durationMs)} />
      <Metadata
        label="Suite"
        value={props.manifest.suite ?? 'Ad hoc selection'}
      />
      <Metadata
        label="Application revision"
        value={props.manifest.applicationRevision ?? 'Not set'}
        mono
      />
      <Metadata
        label="Targets"
        value={values.profileIds.join(', ') || 'None'}
      />
      <Metadata
        label="Execution modes"
        value={values.executionModes.join(', ') || 'Not recorded'}
      />
      <Metadata
        label="Cache outcomes"
        value={values.cacheOutcomes.join(', ') || 'Not recorded'}
      />
      <Metadata
        label="Inferences"
        value={inferenceCountLabel(values.inferenceCount)}
      />
      <Metadata label="Results" value={String(props.manifest.results.length)} />
    </dl>
  )
}

function runMetadataValues(manifest: TestRunManifest) {
  const durationMs = manifest.finishedAt
    ? Date.parse(manifest.finishedAt) - Date.parse(manifest.startedAt)
    : undefined
  const profileIds = [
    ...new Set(
      manifest.results.map((result) => result.executionTargetProfile.id),
    ),
  ]
  const executionModes = uniqueAttemptValues(manifest, 'executionMode')
  const cacheOutcomes = uniqueAttemptValues(manifest, 'cacheOutcome')
  const inferenceCount = manifest.results.reduce(
    (total, result) => total + (result.attempts.at(-1)?.inferenceCount ?? 0),
    0,
  )
  return {
    cacheOutcomes,
    durationMs,
    executionModes,
    inferenceCount,
    profileIds,
  }
}

function uniqueAttemptValues(
  manifest: TestRunManifest,
  key: 'cacheOutcome' | 'executionMode',
): string[] {
  return [
    ...new Set(
      manifest.results.flatMap((result) =>
        result.attempts.flatMap((attempt) => {
          const value = attempt[key]
          return value ? [value] : []
        }),
      ),
    ),
  ]
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
  includeAllArtifacts: boolean
  onIncludeAllArtifacts: (checked: boolean) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        type="button"
        className={buttonVariants({ variant: 'outline' })}
      >
        Download report
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Report format</DropdownMenuLabel>
          {studioRunReportDescriptors.map((descriptor) => (
            <ExportItem
              key={descriptor.format}
              href={reportDownloadHref(
                props.runId,
                descriptor.format,
                props.includeAllArtifacts,
              )}
              label={descriptor.label}
            />
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>HTML options</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={props.includeAllArtifacts}
            closeOnClick={false}
            onCheckedChange={props.onIncludeAllArtifacts}
          >
            Include all artifacts in HTML report
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function reportDownloadHref(
  runId: string,
  format: TestRunExportFormat,
  includeAllArtifacts: boolean,
): string {
  const artifacts =
    format === 'html' && includeAllArtifacts ? '?artifacts=all' : ''
  return `/api/history/${encodeURIComponent(runId)}/${format}${artifacts}`
}

function ExportItem(props: { href: string; label: string }) {
  return (
    <DropdownMenuItem
      nativeButton={false}
      render={<a href={props.href} download />}
    >
      {props.label}
    </DropdownMenuItem>
  )
}
