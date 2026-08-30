import type { TestResultState } from '@pickle-spec/runner'
import { useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
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

function ExactActionDetails(props: {
  action: TimeTravelAction
  resultState: TestResultState
  scenarioName: string
}) {
  const evidence = props.action.evidence
  if (!evidence) return null
  return (
    <CardContent className="space-y-4">
      <div className="grid gap-3 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Before target state</CardTitle>
            <CardDescription>{evidence.target.before.location}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {evidence.target.before.summary}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>After target state</CardTitle>
            <CardDescription>{evidence.target.after.location}</CardDescription>
          </CardHeader>
          <CardContent className="text-sm">
            {evidence.target.after.summary}
          </CardContent>
        </Card>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <ScreenshotSlot {...props} position="before" />
        <ScreenshotSlot {...props} position="after" />
      </div>
      <div className="space-y-2">
        <p className="font-mono text-xs text-muted-foreground">
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
    </CardContent>
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

export function TimeTravelInspector(props: {
  actions: readonly TimeTravelAction[]
  resultState: TestResultState
  scenarioName: string
}) {
  const [selectedKey, setSelectedKey] = useState<string>()
  if (props.actions.length === 0) return null
  const selected = selectedKey
    ? (props.actions.find((action) => action.key === selectedKey) ??
      props.actions.at(-1))
    : props.actions.at(-1)
  if (!selected) return null
  return (
    <section aria-labelledby="time-travel-title" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h4 id="time-travel-title" className="studio-display text-sm">
            Action time travel
          </h4>
          <p className="text-xs text-muted-foreground">
            Inspect the target around each action with the same evidence from
            live and completed runs.
          </p>
        </div>
        {selectedKey ? (
          <Button
            size="sm"
            variant="outline"
            onClick={() => setSelectedKey(undefined)}
          >
            Follow latest
          </Button>
        ) : null}
      </div>
      <div className="grid gap-3 lg:grid-cols-[16rem_minmax(0,1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Actions</CardTitle>
            <CardDescription>{props.actions.length} recorded</CardDescription>
          </CardHeader>
          <CardContent className="space-y-1">
            {props.actions.map((action) => (
              <Button
                key={action.key}
                aria-pressed={action.key === selected.key}
                className="h-auto w-full justify-start whitespace-normal px-3 py-2 text-left"
                variant={action.key === selected.key ? 'secondary' : 'ghost'}
                onClick={() => setSelectedKey(action.key)}
              >
                <span className="min-w-0">
                  <span className="block truncate">{action.description}</span>
                  <span className="mt-1 block text-[0.6875rem] text-muted-foreground">
                    Step {(action.scope.stepIndex ?? 0) + 1} · Action{' '}
                    {action.ordinal + 1}
                  </span>
                </span>
              </Button>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>{selected.description}</CardTitle>
              <Badge>
                Attempt {selected.scope.attempt} · Action {selected.ordinal + 1}
              </Badge>
            </div>
            <CardDescription>
              {selected.stepText}
              {selected.evidence
                ? ` · ${selected.evidence.durationMs} ms · ${selected.evidence.state}`
                : ' · Legacy schema-v2 action. Exact target state, timing, diagnostics, and screenshots were not recorded.'}
            </CardDescription>
            <RetryHistory action={selected} />
          </CardHeader>
          <ExactActionDetails {...props} action={selected} />
        </Card>
      </div>
    </section>
  )
}
