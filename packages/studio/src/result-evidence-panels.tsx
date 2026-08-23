import type { EvidenceAvailability, TestResultState } from '@pickle-spec/runner'
import { ButtonLink } from './components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from './components/ui/card'
import {
  type ArtifactEvidence,
  artifactUrl,
  type DiagnosticEvidence,
  type InspectedResult,
} from './result-evidence'

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
  const diagnosticsAvailability = props.availability.find(
    (item) => item.kind === 'diagnostics',
  )
  const availabilityDescription = diagnosticsAvailability?.message
    ? `${diagnosticsAvailability.state} · ${diagnosticsAvailability.message}`
    : (diagnosticsAvailability?.state ?? 'Not recorded')
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>Diagnostics availability</CardTitle>
          <CardDescription>{availabilityDescription}</CardDescription>
        </CardHeader>
      </Card>
      {props.diagnostics.length === 0 ? (
        <EmptyEvidence message="No Diagnostic entries were retained for this Scenario attempt." />
      ) : (
        <ol className="space-y-3" aria-label="Diagnostic entries">
          {props.diagnostics.map((diagnostic) => (
            <li key={diagnostic.id}>
              <Card>
                <CardHeader>
                  <CardTitle>{diagnostic.source}</CardTitle>
                  <CardDescription>
                    {new Date(diagnostic.occurredAt).toLocaleString()}
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
