import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../components/ui/collapsible'
import { ResultMark } from '../components/ui/result-mark'
import { Spinner } from '../components/ui/spinner'
import type { StudioReadinessAttempt } from '../runs/use-live-run'
import type {
  StudioProject,
  StudioRunReadinessCheck,
  StudioRunReadinessCheckId,
  StudioRunRequest,
  StudioRunsIndex,
  StudioSpecification,
} from '../server/server'
import {
  type FirstRunOnboardingState,
  firstRunOnboardingState,
} from './first-run-onboarding-model'

type FirstRunOnboardingProps = {
  activeProfileId?: string
  currentSpecification?: StudioSpecification
  onOpenSettings: () => void
  onRun: (request: StudioRunRequest) => Promise<void>
  project: StudioProject
  readinessAttempt?: StudioReadinessAttempt
  running: boolean
  runsIndex?: StudioRunsIndex
}

const checkLabels: Record<StudioRunReadinessCheckId, string> = {
  selection: 'Scenario selected',
  'execution-target': 'Execution target ready',
  'model-credential': 'Model credential ready',
  environment: 'Local environment ready',
}

function checkState(check: StudioRunReadinessCheck) {
  if (check.status === 'ready') return 'passed'
  if (check.status === 'blocked') return 'failed'
  return 'idle'
}

function ReadinessCheckRow({ check }: { check: StudioRunReadinessCheck }) {
  return (
    <li className="flex min-w-0 items-start gap-2 text-xs">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        <ResultMark state={checkState(check)} />
      </span>
      <div className="min-w-0">
        <p>{checkLabels[check.id]}</p>
        <ReadinessCheckDetails check={check} />
      </div>
    </li>
  )
}

function ReadinessCheckDetails({ check }: { check: StudioRunReadinessCheck }) {
  if (check.status === 'ready') return null
  if (check.status === 'not-applicable') {
    return <p className="text-muted-foreground">Not needed for this run.</p>
  }
  return (
    <ul className="text-muted-foreground">
      {check.reasons.map((reason) => (
        <li key={reason}>{reason}</li>
      ))}
    </ul>
  )
}

function FirstGreenRow(props: { state: 'idle' | 'running' | 'failed' }) {
  return (
    <li className="flex items-center gap-2 text-xs">
      <span className="flex size-4 shrink-0 items-center justify-center">
        {props.state === 'running' ? <Spinner /> : null}
        {props.state === 'failed' ? <ResultMark state="failed" /> : null}
      </span>
      <span>Persist one passed Test run</span>
    </li>
  )
}

function guideCopy(
  kind: 'blocked' | 'ready' | 'running' | 'failed',
  scenarioName: string,
) {
  if (kind === 'blocked') {
    return {
      badge: 'Setup needed',
      description: 'Resolve the blocked checks, then run one Scenario.',
    }
  }
  if (kind === 'running') {
    return {
      badge: 'Running',
      description: `Studio is running "${scenarioName}".`,
    }
  }
  if (kind === 'failed') {
    return {
      badge: 'Retry',
      description: 'The first run finished without a pass. Fix it and retry.',
    }
  }
  return {
    badge: 'Ready',
    description: `Run "${scenarioName}" to complete Studio setup.`,
  }
}

type ActiveFirstRunState = Exclude<
  FirstRunOnboardingState,
  { kind: 'complete' | 'empty-project' }
>

function firstGreenState(
  state: ActiveFirstRunState,
): 'idle' | 'running' | 'failed' {
  if (state.kind === 'running') return 'running'
  if (state.kind === 'failed') return 'failed'
  return 'idle'
}

function EmptyProjectOnboarding() {
  return (
    <section
      aria-labelledby="first-run-title"
      className="shrink-0 px-3 pt-3 sm:px-5"
    >
      <Card size="sm">
        <CardHeader>
          <CardTitle>
            <h2 id="first-run-title">Run your first green Scenario</h2>
          </CardTitle>
          <CardDescription>
            Add a Specification with at least one Scenario to begin.
          </CardDescription>
        </CardHeader>
      </Card>
    </section>
  )
}

function FirstRunAction(props: {
  onOpenSettings: () => void
  onRun: (request: StudioRunRequest) => Promise<void>
  state: ActiveFirstRunState
}) {
  if (props.state.kind === 'blocked') {
    return (
      <Button type="button" variant="outline" onClick={props.onOpenSettings}>
        Open Settings
      </Button>
    )
  }

  function handleRun() {
    void props.onRun(props.state.target.request)
  }

  return (
    <Button
      type="button"
      disabled={props.state.kind === 'running'}
      aria-busy={props.state.kind === 'running' || undefined}
      onClick={handleRun}
    >
      {props.state.kind === 'failed' ? 'Retry Scenario' : 'Run first Scenario'}
    </Button>
  )
}

function ActiveFirstRunOnboarding(
  props: FirstRunOnboardingProps & { state: ActiveFirstRunState },
) {
  const copy = guideCopy(props.state.kind, props.state.target.scenario.name)
  const checks = (props.state.target.readiness.checks ?? []).filter(
    (check) => check.status !== 'not-applicable',
  )
  const badgeVariant =
    props.state.kind === 'failed' || props.state.kind === 'blocked'
      ? 'failed'
      : 'default'

  return (
    <section
      aria-labelledby="first-run-title"
      className="shrink-0 px-3 pt-3 sm:px-5"
    >
      <Card size="sm">
        <CardHeader>
          <CardTitle>
            <h2 id="first-run-title">Run your first green Scenario</h2>
          </CardTitle>
          <CardDescription>{copy.description}</CardDescription>
          <CardAction>
            <Badge variant={badgeVariant}>{copy.badge}</Badge>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end justify-between gap-3">
          <Collapsible defaultOpen className="min-w-0 flex-1">
            <CollapsibleTrigger
              render={<Button type="button" variant="ghost" size="sm" />}
            >
              First-run checklist
            </CollapsibleTrigger>
            <CollapsibleContent>
              <ol
                aria-label="First-run readiness"
                className="grid gap-2 pt-2 sm:grid-cols-2 lg:grid-cols-3"
              >
                {checks.map((check) => (
                  <ReadinessCheckRow key={check.id} check={check} />
                ))}
                {checks.length === 0 && !props.state.target.readiness.ready ? (
                  <li className="text-xs text-muted-foreground">
                    {props.state.target.readiness.reasons.join(' ')}
                  </li>
                ) : null}
                <FirstGreenRow state={firstGreenState(props.state)} />
              </ol>
            </CollapsibleContent>
          </Collapsible>
          <div className="flex w-full items-center gap-2 sm:w-auto sm:shrink-0">
            <FirstRunAction
              onOpenSettings={props.onOpenSettings}
              onRun={props.onRun}
              state={props.state}
            />
          </div>
        </CardContent>
      </Card>
    </section>
  )
}

export function FirstRunOnboarding(props: FirstRunOnboardingProps) {
  const state = firstRunOnboardingState(props)
  if (state.kind === 'complete') return null
  if (state.kind === 'empty-project') return <EmptyProjectOnboarding />
  return <ActiveFirstRunOnboarding {...props} state={state} />
}
