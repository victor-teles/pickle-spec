import type { ResolvedAction } from '@pickle-spec/runner'
import { Button } from './components/ui/button'

type TimelineResult = {
  scenario: { name: string }
  executionTargetProfile: { id: string }
  steps: Array<{
    step: { keyword: string; text: string }
    resolvedActions: ResolvedAction[]
    message?: string
    artifacts?: Array<{ kind: string; path: string; mediaType?: string }>
  }>
}

function artifactUrl(path: string): string {
  return `/api/artifact?path=${encodeURIComponent(path)}`
}

export function ResolvedActionList(props: {
  actions?: readonly ResolvedAction[]
}) {
  if (!props.actions?.length) {
    return <span className="text-muted-foreground">None</span>
  }
  return (
    <ul className="space-y-2 font-mono text-xs">
      {props.actions.map((action) => (
        <li key={JSON.stringify(action)}>
          <span>{action.description}</span>
          {action.replay ? (
            <pre className="mt-1 overflow-auto whitespace-pre-wrap text-muted-foreground">
              {JSON.stringify(action.replay, null, 2)}
            </pre>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

export function TestResultTimeline(props: {
  result: TimelineResult
  ariaLabel?: string
  showHeading?: boolean
}) {
  const { result } = props
  return (
    <section className="space-y-3">
      {props.showHeading !== false ? (
        <h3 className="text-sm font-medium">
          {result.scenario.name} · {result.executionTargetProfile.id}
        </h3>
      ) : null}
      <ol aria-label={props.ariaLabel ?? 'Step timeline'} className="space-y-3">
        {result.steps.map((step) => (
          <li
            key={`${step.step.keyword}:${step.step.text}:${step.resolvedActions
              .map((action) => action.description)
              .join(',')}`}
            className="rounded-md border border-border bg-card px-4 py-3 transition-[border-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-foreground/15 motion-reduce:transition-none"
          >
            <p className="font-medium">
              {`${step.step.keyword.trim()} ${step.step.text}`}
            </p>
            <div className="mt-2">
              <ResolvedActionList actions={step.resolvedActions} />
            </div>
            {step.message ? (
              <p className="mt-2 text-sm text-destructive">{step.message}</p>
            ) : null}
            {step.artifacts?.map((artifact) =>
              artifact.mediaType?.startsWith('image/') ? (
                <Button
                  key={artifact.path}
                  variant="ghost"
                  className="mt-3 h-auto w-fit p-0 hover:bg-transparent"
                  render={<a href={artifactUrl(artifact.path)} />}
                >
                  <img
                    alt={`${artifact.kind} for ${result.scenario.name}`}
                    src={artifactUrl(artifact.path)}
                    className="max-h-64 rounded-md border border-border"
                  />
                </Button>
              ) : (
                <Button
                  key={artifact.path}
                  variant="link"
                  className="mt-2 h-auto px-0"
                  render={<a href={artifactUrl(artifact.path)} />}
                >
                  {artifact.kind}
                </Button>
              ),
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}
