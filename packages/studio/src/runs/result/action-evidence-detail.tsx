import type { TestResultState } from '@pickle-spec/runner'
import { Badge } from '../../components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { ArtifactViewer } from './artifact-viewer'
import type { TimeTravelAction } from './time-travel-inspection'

function ScreenshotSlot(props: {
  action: TimeTravelAction
  position: 'before' | 'after'
  resultState: TestResultState
  scenarioName: string
}) {
  const screenshot = props.action.evidence?.screenshots[props.position]
  return (
    <Card>
      <CardHeader>
        <CardTitle className="capitalize">{props.position}</CardTitle>
        <CardDescription>Action screenshot</CardDescription>
      </CardHeader>
      <CardContent>
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
              'Unavailable in legacy run'}
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
        Legacy schema-v2 action. Exact target state, timing, diagnostics, and
        screenshots were not recorded.
      </p>
    )
  }
  return (
    <div className="mt-4 space-y-4">
      <RetryHistory action={props.action} />
      <Card>
        <CardHeader>
          <CardTitle>Before target state</CardTitle>
          {evidence.target.before.location ? (
            <CardDescription>{evidence.target.before.location}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="text-sm">
          {evidence.target.before.summary}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>After target state</CardTitle>
          {evidence.target.after.location ? (
            <CardDescription>{evidence.target.after.location}</CardDescription>
          ) : null}
        </CardHeader>
        <CardContent className="text-sm">
          {evidence.target.after.summary}
        </CardContent>
      </Card>
      <ScreenshotSlot {...props} position="before" />
      <ScreenshotSlot {...props} position="after" />
      <div className="space-y-2">
        <p className="break-words font-mono text-xs text-muted-foreground">
          {evidence.source.uri}
          {evidence.source.line ? `:${evidence.source.line}` : ''}
        </p>
        <pre className="overflow-auto rounded-md bg-muted p-3 text-xs">
          {evidence.source.excerpt}
        </pre>
      </div>
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
