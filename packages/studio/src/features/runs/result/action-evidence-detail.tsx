import type { TestResultState } from '@pickle-spec/runner'
import { Badge } from '../../../components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../../components/ui/card'
import { EvidenceDetails } from './evidence-details'
import { ArtifactViewer } from './artifact-viewer'
import type { TimeTravelAction } from './time-travel-inspection'

function ActionSnapshot(props: {
  action: TimeTravelAction
  position: 'before' | 'after'
  resultState: TestResultState
  scenarioName: string
}) {
  const screenshot = props.action.evidence?.screenshots[props.position]
  const target = props.action.evidence?.target[props.position]
  const before = props.action.evidence?.target.before
  const showLocation =
    target?.location &&
    (props.position === 'before' || target.location !== before?.location)
  const showSummary =
    target?.summary &&
    (props.position === 'before' || target.summary !== before?.summary)
  return (
    <Card>
      <CardHeader>
        <CardTitle className="capitalize">{props.position}</CardTitle>
        {showLocation ? (
          <CardDescription className="break-words">
            {target.location}
          </CardDescription>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        {showSummary ? <p className="text-sm">{target.summary}</p> : null}
        {screenshot?.state === 'available' ? (
          <ArtifactViewer
            artifact={screenshot.artifact}
            resultState={props.resultState}
            scenarioName={props.scenarioName}
            stepText={`${props.position} ${props.action.description}`}
          />
        ) : (
          <p className="text-sm text-muted-foreground">
            {screenshot?.message ??
              screenshot?.state ??
              'Screenshot wasn’t recorded.'}
          </p>
        )}
      </CardContent>
    </Card>
  )
}

function RetryHistory(props: { action: TimeTravelAction }) {
  if (props.action.retries.length < 2) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">Retries</span>
      {props.action.retries.map((retry) => (
        <Badge
          key={retry.attempt}
          variant={retry.state === 'passed' ? 'passed' : 'failed'}
        >
          Attempt {retry.attempt} {retry.state}
          {retry.current ? ' current' : ''}
        </Badge>
      ))}
    </div>
  )
}

export function ActionEvidenceDetail(props: {
  action: TimeTravelAction
  resultState: TestResultState
  scenarioName: string
}) {
  const evidence = props.action.evidence
  if (!evidence) {
    return (
      <p className="mt-4 text-sm text-muted-foreground">
        Detailed evidence wasn’t recorded for this action.
      </p>
    )
  }
  return (
    <div className="mt-4 space-y-4">
      <RetryHistory action={props.action} />
      <ActionSnapshot {...props} position="before" />
      <ActionSnapshot {...props} position="after" />
      <EvidenceDetails label="Source details">
        <div className="space-y-2">
          <p className="break-words font-mono text-xs text-muted-foreground">
            {evidence.source.uri}
            {evidence.source.line ? `:${evidence.source.line}` : ''}
          </p>
          <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
            {evidence.source.excerpt}
          </pre>
        </div>
      </EvidenceDetails>
      {evidence.diagnostics.length > 0 ? (
        <div className="space-y-2">
          {evidence.diagnostics.map((diagnostic) => (
            <Card key={`${diagnostic.occurredAt}:${diagnostic.message}`}>
              <CardContent className="pt-4 text-sm">
                {diagnostic.message}
              </CardContent>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  )
}
