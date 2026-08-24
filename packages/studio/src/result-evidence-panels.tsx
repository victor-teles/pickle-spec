import type {
  DiagnosticLevel,
  DiagnosticOrigin,
  EvidenceAvailability,
  TestResultState,
} from '@pickle-spec/runner'
import { useState } from 'react'
import { Button, ButtonLink } from './components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './components/ui/card'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import {
  type ArtifactEvidence,
  artifactUrl,
  type DiagnosticEvidence,
  filterDiagnostics,
  type InspectedResult,
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
] as const satisfies readonly DiagnosticOrigin[]

type MetadataProps = {
  label: string
  value: string
  mono?: boolean
}

type ResultArtifactsProps = {
  artifacts: readonly ArtifactEvidence[]
  scenarioName: string
  resultState: TestResultState
}

type ResultDiagnosticsProps = {
  diagnostics: readonly DiagnosticEvidence[]
  availability: readonly EvidenceAvailability[]
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
    <div className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-muted-foreground">
      {props.message}
    </div>
  )
}

export function ResultArtifacts(props: ResultArtifactsProps) {
  if (props.artifacts.length === 0) {
    return (
      <EmptyEvidence message="No Test artifacts were retained for this Scenario attempt." />
    )
  }
  return (
    <div className="space-y-3">
      {props.artifacts.map((evidence) => {
        const { artifact } = evidence
        const artifactHref = artifactUrl(artifact.path)
        const isImage = artifact.mediaType?.startsWith('image/')
        return (
          <Card key={`${artifact.path}:${evidence.stepIndex}`}>
            <CardHeader>
              <CardTitle>{artifact.kind}</CardTitle>
              <CardDescription>{evidence.stepText}</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(16rem,1fr)]">
              {isImage ? (
                <ButtonLink
                  variant="ghost"
                  href={artifactHref}
                  className="h-auto w-full justify-start overflow-hidden border-border bg-muted/20 p-0 hover:bg-muted/30"
                >
                  <img
                    alt={`${artifact.kind} from ${props.resultState} result for ${props.scenarioName}: ${evidence.stepText}`}
                    src={artifactHref}
                    className="max-h-[32rem] w-full object-contain"
                  />
                </ButtonLink>
              ) : (
                <div className="flex min-h-32 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground">
                  Preview is unavailable for{' '}
                  {artifact.mediaType ?? artifact.kind}.
                </div>
              )}
              <div className="space-y-4">
                <dl className="space-y-3">
                  <Metadata label="Kind" value={artifact.kind} />
                  <Metadata
                    label="Media type"
                    value={artifact.mediaType ?? 'Not recorded'}
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
                <ButtonLink variant="outline" href={artifactHref} download>
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
  const [level, setLevel] = useState<DiagnosticLevel>()
  const [origin, setOrigin] = useState<DiagnosticOrigin>()
  const [scenarioId, setScenarioId] = useState('')
  const [stepIndex, setStepIndex] = useState('')
  const [executionTargetProfileId, setExecutionTargetProfileId] = useState('')
  const diagnosticsAvailability = props.availability.find(
    (item) => item.kind === 'diagnostics',
  )
  const availabilityDescription = diagnosticsAvailability?.message
    ? `${diagnosticsAvailability.state} · ${diagnosticsAvailability.message}`
    : (diagnosticsAvailability?.state ?? 'Not recorded')
  const parsedStepIndex = stepIndex === '' ? undefined : Number(stepIndex)
  const diagnostics = filterDiagnostics(props.diagnostics, {
    level,
    origin,
    scenarioId: scenarioId || undefined,
    stepIndex: Number.isInteger(parsedStepIndex) ? parsedStepIndex : undefined,
    executionTargetProfileId: executionTargetProfileId || undefined,
  })
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>Diagnostics availability</CardTitle>
          <CardDescription>{availabilityDescription}</CardDescription>
        </CardHeader>
      </Card>
      {props.diagnostics.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Filter Diagnostic entries</CardTitle>
            <CardDescription>
              Filters preserve the original chronological order.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
        <EmptyEvidence message="No Diagnostic entries match these filters." />
      ) : (
        <ol className="space-y-3" aria-label="Diagnostic entries">
          {diagnostics.map((diagnostic) => (
            <li key={diagnostic.id}>
              <Card>
                <CardHeader>
                  <CardTitle>{diagnostic.source}</CardTitle>
                  <CardDescription>
                    {new Date(diagnostic.occurredAt).toLocaleString()}
                    {` · ${diagnostic.level} · ${diagnostic.origin}`}
                    {diagnostic.stepText ? ` · ${diagnostic.stepText}` : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-destructive">{diagnostic.message}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ol>
      )}
    </div>
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
  type?: 'text' | 'number'
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
        value={props.value}
        onChange={(event) => props.onChange(event.currentTarget.value)}
      />
    </div>
  )
}
