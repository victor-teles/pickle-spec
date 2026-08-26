import type {
  ApplicationOutputEvidenceAvailability,
  DiagnosticLevel,
  DiagnosticOrigin,
  EvidenceAvailability,
  TestResultState,
} from '@pickle-spec/runner'
import { useMemo, useState } from 'react'
import { Button, ButtonLink } from '../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import { ArtifactViewer } from './artifact-viewer'
import {
  type ArtifactEvidence,
  artifactDownloadUrl,
  type DiagnosticEvidence,
  diagnosticPage,
  filterDiagnostics,
  type InspectedResult,
  recoveryGuidance,
} from './result-evidence'

const diagnosticLevels = [
  'debug',
  'info',
  'warning',
  'error',
] as const satisfies readonly DiagnosticLevel[]
const diagnosticOrigins = [
  'console',
  'network',
  'runner',
  'adapter',
  'application',
] as const satisfies readonly DiagnosticOrigin[]

function hasDiagnosticFilters(filters: readonly unknown[]): boolean {
  return filters.some(Boolean)
}

function diagnosticAvailability(
  availability: readonly EvidenceAvailability[],
): { description: string; recovery?: string } {
  const diagnostics = availability.find((item) => item.kind === 'diagnostics')
  const description = diagnostics?.message
    ? `${diagnostics.state} · ${diagnostics.message}`
    : (diagnostics?.state ?? 'Not recorded')
  const recovery =
    diagnostics && diagnostics.state !== 'available'
      ? recoveryGuidance(diagnostics.state)
      : undefined
  return { description, recovery }
}

type MetadataProps = {
  label: string
  value: string
  mono?: boolean
}

type ResultArtifactsProps = {
  artifacts: readonly ArtifactEvidence[]
  availability: readonly EvidenceAvailability[]
  scenarioName: string
  resultState: TestResultState
}

type ResultDiagnosticsProps = {
  diagnostics: readonly DiagnosticEvidence[]
  availability: readonly EvidenceAvailability[]
  applicationOutputAvailability?: readonly ApplicationOutputEvidenceAvailability[]
}

function Metadata(props: MetadataProps) {
  return (
    <div className="space-y-1">
      <dt className="text-muted-foreground">{props.label}</dt>
      <dd className={props.mono ? 'break-all font-mono' : undefined}>
        {props.value}
      </dd>
    </div>
  )
}

function EvidenceAvailabilityCard(props: {
  availability: readonly EvidenceAvailability[]
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Evidence availability</CardTitle>
        <CardDescription>
          What the test run retained for investigation.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <dl className="space-y-3">
          {props.availability.map((item) => (
            <div
              key={item.kind}
              className="flex items-start justify-between gap-3"
            >
              <dt>{item.kind}</dt>
              <dd className="text-right text-muted-foreground">
                {item.state}
                {item.message ? (
                  <span className="block">{item.message}</span>
                ) : null}
                {item.state !== 'available' ? (
                  <span className="block">{recoveryGuidance(item.state)}</span>
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </CardContent>
    </Card>
  )
}

type ResultOverviewProps = InspectedResult & { inProgress?: boolean }

export function ResultOverview(props: ResultOverviewProps) {
  const { result, attempt, inProgress } = props
  return (
    <div className="grid gap-3 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
      <Card>
        <CardHeader>
          <CardTitle>Scenario attempt</CardTitle>
          <CardDescription>
            Canonical result evidence for this Scenario attempt.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">
            <Metadata
              label="Started"
              value={new Date(attempt.startedAt).toLocaleString()}
            />
            <Metadata
              label="Finished"
              value={
                inProgress
                  ? 'In progress'
                  : new Date(attempt.finishedAt).toLocaleString()
              }
            />
            <Metadata
              label="Duration"
              value={inProgress ? 'In progress' : `${attempt.durationMs} ms`}
            />
            <Metadata label="Attempt" value={String(attempt.attempt)} />
            <Metadata
              label="Execution mode"
              value={attempt.executionMode ?? 'Not recorded'}
            />
            <Metadata
              label="Cache outcome"
              value={attempt.cacheOutcome ?? 'Not recorded'}
            />
            <Metadata
              label="Inferences"
              value={String(attempt.inferenceCount ?? 'Not recorded')}
            />
            <Metadata
              label="Scenario identifier"
              value={result.scenario.id ?? 'Derived from name'}
              mono
            />
          </dl>
        </CardContent>
      </Card>
      <EvidenceAvailabilityCard availability={attempt.evidenceAvailability} />
    </div>
  )
}

function EmptyEvidence(props: { message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-5 text-center text-muted-foreground">
      {props.message}
    </div>
  )
}

type UnavailableEvidence = EvidenceAvailability & {
  state: Exclude<EvidenceAvailability['state'], 'available'>
}

function isUnavailableArtifact(
  item: EvidenceAvailability,
): item is UnavailableEvidence {
  return item.kind !== 'diagnostics' && item.state !== 'available'
}

function ArtifactAvailability(props: {
  availability: readonly EvidenceAvailability[]
}) {
  const unavailable = props.availability.filter(isUnavailableArtifact)
  if (unavailable.length === 0) return null
  return (
    <section
      aria-labelledby="artifact-availability-title"
      className="rounded-lg border border-border bg-card p-4"
    >
      <h4 id="artifact-availability-title" className="font-medium">
        Artifact availability
      </h4>
      <dl className="mt-3 grid gap-3 sm:grid-cols-2">
        {unavailable.map((item) => (
          <div key={item.kind} className="min-w-0 space-y-1">
            <dt className="font-medium">{item.kind}</dt>
            <dd className="break-words text-muted-foreground">
              <span>{item.state}</span>
              {item.message ? <span> · {item.message}</span> : null}
              <span className="block">{recoveryGuidance(item.state)}</span>
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}

function formatBytes(sizeBytes: number | undefined): string {
  if (sizeBytes === undefined) return 'Not recorded'
  if (sizeBytes < 1_024) return `${sizeBytes} B`
  return `${(sizeBytes / 1_024).toFixed(1)} KB`
}

export function ResultArtifacts(props: ResultArtifactsProps) {
  return (
    <div className="space-y-3">
      <ArtifactAvailability availability={props.availability} />
      {props.artifacts.length === 0 ? (
        <EmptyEvidence message="No Test artifacts were retained for this Scenario attempt." />
      ) : null}
      {props.artifacts.map((evidence) => {
        const { artifact } = evidence
        const downloadHref = artifactDownloadUrl(artifact.path, artifact.name)
        return (
          <Card key={`${artifact.path}:${evidence.stepIndex}`}>
            <CardHeader>
              <CardTitle>{artifact.kind}</CardTitle>
              <CardDescription>{evidence.stepText}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
              <ArtifactViewer
                artifact={artifact}
                resultState={props.resultState}
                scenarioName={props.scenarioName}
                stepText={evidence.stepText}
              />
              <div className="space-y-4">
                <dl className="space-y-3">
                  <Metadata label="Kind" value={artifact.kind} />
                  <Metadata
                    label="File name"
                    value={artifact.name ?? 'Not recorded'}
                    mono
                  />
                  <Metadata
                    label="Media type"
                    value={artifact.mediaType ?? 'Not recorded'}
                  />
                  <Metadata
                    label="File size"
                    value={formatBytes(artifact.sizeBytes)}
                  />
                  <Metadata
                    label="Captured"
                    value={new Date(evidence.capturedAt).toLocaleString()}
                  />
                  <Metadata
                    label="Step index"
                    value={String(evidence.stepIndex)}
                  />
                  <Metadata label="Persisted path" value={artifact.path} mono />
                </dl>
                <ButtonLink
                  variant="outline"
                  href={downloadHref}
                  download={artifact.name ?? true}
                >
                  Download {artifact.kind}
                </ButtonLink>
              </div>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

export function ResultDiagnostics(props: ResultDiagnosticsProps) {
  const [query, setQuery] = useState('')
  const [level, setLevel] = useState<DiagnosticLevel>()
  const [origin, setOrigin] = useState<DiagnosticOrigin>()
  const [scenarioId, setScenarioId] = useState('')
  const [stepIndex, setStepIndex] = useState('')
  const [executionTargetProfileId, setExecutionTargetProfileId] = useState('')
  const availability = diagnosticAvailability(props.availability)
  const parsedStepIndex = stepIndex === '' ? undefined : Number(stepIndex)
  const diagnostics = useMemo(
    () =>
      filterDiagnostics(props.diagnostics, {
        query,
        level,
        origin,
        scenarioId: scenarioId || undefined,
        stepIndex: Number.isInteger(parsedStepIndex)
          ? parsedStepIndex
          : undefined,
        executionTargetProfileId: executionTargetProfileId || undefined,
      }),
    [
      props.diagnostics,
      query,
      level,
      origin,
      scenarioId,
      parsedStepIndex,
      executionTargetProfileId,
    ],
  )
  const filterKey = [
    query,
    level,
    origin,
    scenarioId,
    stepIndex,
    executionTargetProfileId,
  ].join(':')
  const hasFilters = hasDiagnosticFilters([
    query,
    level,
    origin,
    scenarioId,
    stepIndex,
    executionTargetProfileId,
  ])

  function clearFilters() {
    setQuery('')
    setLevel(undefined)
    setOrigin(undefined)
    setScenarioId('')
    setStepIndex('')
    setExecutionTargetProfileId('')
  }
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>Diagnostics availability</CardTitle>
          <CardDescription>
            <span>{availability.description}</span>
            {availability.recovery ? (
              <span className="block">{availability.recovery}</span>
            ) : null}
          </CardDescription>
        </CardHeader>
      </Card>
      {props.applicationOutputAvailability?.length ? (
        <Card>
          <CardHeader>
            <CardTitle>Managed application streams</CardTitle>
            <CardDescription>
              stdout and stderr are tracked independently for this target.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="grid gap-3 sm:grid-cols-2">
              {props.applicationOutputAvailability.map((item) => (
                <div key={item.stream} className="space-y-1">
                  <dt className="font-mono text-sm">{item.stream}</dt>
                  <dd className="text-muted-foreground">
                    {item.state}
                    {item.message ? ` · ${item.message}` : ''}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      ) : null}
      {props.diagnostics.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Filter Diagnostic entries</CardTitle>
            <CardDescription>
              Filters preserve the original chronological order.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
              <DiagnosticInput
                label="Search Diagnostic entries"
                value={query}
                onChange={setQuery}
                type="search"
                placeholder="Search messages and metadata"
              />
              <Button
                type="button"
                variant="outline"
                className="w-full sm:w-auto"
                disabled={!hasFilters}
                onClick={clearFilters}
              >
                Clear filters
              </Button>
            </div>
            <DiagnosticChoice
              label="Level"
              values={diagnosticLevels}
              selected={level}
              onSelect={setLevel}
            />
            <DiagnosticChoice
              label="Origin"
              values={diagnosticOrigins}
              selected={origin}
              onSelect={setOrigin}
            />
            <div className="grid gap-3 sm:grid-cols-3">
              <DiagnosticInput
                label="Scenario identifier"
                value={scenarioId}
                onChange={setScenarioId}
              />
              <DiagnosticInput
                label="Step index"
                value={stepIndex}
                onChange={setStepIndex}
                type="number"
              />
              <DiagnosticInput
                label="Target profile"
                value={executionTargetProfileId}
                onChange={setExecutionTargetProfileId}
              />
            </div>
          </CardContent>
        </Card>
      ) : null}
      {props.diagnostics.length === 0 ? (
        <EmptyEvidence message="No Diagnostic entries were retained for this Scenario attempt." />
      ) : diagnostics.length === 0 ? (
        <div>
          <p role="status" aria-live="polite" className="sr-only">
            0 of {props.diagnostics.length} Diagnostic entries match.
          </p>
          <EmptyEvidence message="No Diagnostic entries match these filters. Clear or change the filters to continue investigating." />
        </div>
      ) : (
        <DiagnosticEntries
          key={filterKey}
          diagnostics={diagnostics}
          total={props.diagnostics.length}
        />
      )}
    </div>
  )
}

function DiagnosticEntries(props: {
  diagnostics: readonly DiagnosticEvidence[]
  total: number
}) {
  const [requestedPage, setRequestedPage] = useState(0)
  const page = diagnosticPage(props.diagnostics, requestedPage)
  const resultLabel = `Showing ${page.first}–${page.last} of ${props.diagnostics.length} matching Diagnostic entries (${props.total} total).`
  return (
    <section className="space-y-3" aria-labelledby="diagnostic-results-title">
      <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h4 id="diagnostic-results-title" className="font-medium">
            Diagnostic entries
          </h4>
          <p
            role="status"
            aria-live="polite"
            className="break-words text-sm text-muted-foreground"
          >
            {resultLabel}
          </p>
        </div>
        <nav
          className="grid grid-cols-2 gap-2 sm:flex"
          aria-label="Diagnostic result pages"
        >
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page.page === 0}
            onClick={() => setRequestedPage(page.page - 1)}
          >
            Previous 100
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={page.page === page.pageCount - 1}
            onClick={() => setRequestedPage(page.page + 1)}
          >
            Next 100
          </Button>
        </nav>
      </div>
      <ol className="space-y-3" aria-label="Diagnostic entries">
        {page.entries.map((diagnostic, index) => (
          <li
            key={diagnostic.id}
            aria-posinset={page.first + index}
            aria-setsize={props.diagnostics.length}
            className="min-w-0 rounded-lg border border-border bg-card p-4"
          >
            <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-3">
              <h5 className="font-medium">{diagnostic.source}</h5>
              <p className="break-words text-xs text-muted-foreground sm:text-right">
                {new Date(diagnostic.occurredAt).toLocaleString()}
                {` · ${diagnostic.level} · ${diagnostic.origin}`}
                {diagnostic.stream ? ` · ${diagnostic.stream}` : ''}
                {diagnostic.stepText ? ` · ${diagnostic.stepText}` : ''}
              </p>
            </div>
            <p className="mt-3 whitespace-pre-wrap break-words text-destructive">
              {diagnostic.message}
            </p>
          </li>
        ))}
      </ol>
    </section>
  )
}

type DiagnosticChoiceProps<Value extends string> = {
  label: string
  values: readonly Value[]
  selected?: Value
  onSelect: (value: Value | undefined) => void
}

function DiagnosticChoice<Value extends string>(
  props: DiagnosticChoiceProps<Value>,
) {
  return (
    <fieldset className="space-y-2">
      <legend className="text-sm font-medium">{props.label}</legend>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant={props.selected === undefined ? 'default' : 'outline'}
          aria-pressed={props.selected === undefined}
          onClick={() => props.onSelect(undefined)}
        >
          All
        </Button>
        {props.values.map((value) => (
          <Button
            key={value}
            type="button"
            size="sm"
            variant={props.selected === value ? 'default' : 'outline'}
            aria-pressed={props.selected === value}
            onClick={() => props.onSelect(value)}
          >
            {value}
          </Button>
        ))}
      </div>
    </fieldset>
  )
}

type DiagnosticInputProps = {
  label: string
  value: string
  onChange: (value: string) => void
  type?: 'text' | 'number' | 'search'
  placeholder?: string
}

function DiagnosticInput(props: DiagnosticInputProps) {
  const id = `diagnostic-${props.label.toLowerCase().replaceAll(' ', '-')}`
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{props.label}</Label>
      <Input
        id={id}
        type={props.type ?? 'text'}
        min={props.type === 'number' ? 0 : undefined}
        placeholder={props.placeholder}
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </div>
  )
}
