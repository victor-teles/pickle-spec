import type { ExecutionPlanDisplay } from '@pickle-spec/runner'
import { useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import type { StudioExecutionPlanRequest } from './execution-plan.contracts'
import { getExecutionPlan, saveExecutionPlan } from './execution-plan.functions'
import { ExecutionPlanEditor } from './execution-plan-editor'
import type { PlanStepFocus } from './plan-steps'

type ExecutionPlanPanelProps = {
  scenarioId: string
  profileId: string
  focusStep?: PlanStepFocus
}

interface ScenarioExecutionPlanProps {
  scenarioId: string
  profiles: readonly string[]
}

export function ScenarioExecutionPlan(props: ScenarioExecutionPlanProps) {
  const [profileId, setProfileId] = useState<string>()
  const onlyProfile =
    props.profiles.length === 1 ? props.profiles[0] : undefined
  if (onlyProfile) {
    return (
      <ExecutionPlanPanel
        scenarioId={props.scenarioId}
        profileId={onlyProfile}
      />
    )
  }
  return (
    <section
      className="min-w-0 space-y-3"
      aria-labelledby="scenario-plan-title"
    >
      <h3 id="scenario-plan-title" className="text-sm font-medium">
        Readable execution plan
      </h3>
      {props.profiles.length > 0 ? (
        <div className="flex min-w-0 flex-wrap gap-2">
          {props.profiles.map((profile) => (
            <Button
              key={profile}
              type="button"
              variant={profileId === profile ? 'default' : 'outline'}
              size="sm"
              className="h-auto min-h-8 max-w-full whitespace-normal break-all"
              aria-pressed={profileId === profile}
              onClick={() => setProfileId(profile)}
            >
              Inspect {profile}
            </Button>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No execution target profiles are configured for this project.
        </p>
      )}
      {profileId ? (
        <ExecutionPlanPanel
          scenarioId={props.scenarioId}
          profileId={profileId}
        />
      ) : (
        <p className="text-sm text-muted-foreground">
          Choose a profile to inspect its current cached plan.
        </p>
      )}
    </section>
  )
}

export function ExecutionPlanPanel(props: ExecutionPlanPanelProps) {
  return (
    <ExecutionPlanPanelScope
      key={`${props.scenarioId}\u0000${props.profileId}`}
      {...props}
    />
  )
}

function ExecutionPlanPanelScope(props: ExecutionPlanPanelProps) {
  const loaded = useExecutionPlan(props)

  if (loaded.error) {
    return <PlanLoadError message={loaded.error} onRetry={loaded.retry} />
  }
  if (!loaded.plan) {
    return (
      <p role="status" className="p-4 text-sm text-muted-foreground">
        Loading readable execution plan…
      </p>
    )
  }
  if (loaded.plan.state === 'absent') {
    return (
      <PlanNotice title="No cached plan" message={loaded.plan.nextAction} />
    )
  }
  if (loaded.plan.state === 'unavailable') {
    return (
      <PlanNotice
        title="Plan unavailable"
        message={`${loaded.plan.message} ${loaded.plan.nextAction}`}
        revisions={loaded.plan.applicationRevisions}
        onSelectRevision={loaded.selectRevision}
      />
    )
  }
  return (
    <ExecutionPlanEditor
      plan={loaded.plan}
      focusStep={props.focusStep}
      onReload={loaded.retry}
      onSave={async (request) => {
        const result = await saveExecutionPlan({ data: request })
        if (result.ok) loaded.update(result.value)
        return result
      }}
    >
      <PlanCacheDetails plan={loaded.plan} />
    </ExecutionPlanEditor>
  )
}

function useExecutionPlan(props: ExecutionPlanPanelProps) {
  const [request, setRequest] = useState<StudioExecutionPlanRequest>(() => ({
    scenarioId: props.scenarioId,
    profileId: props.profileId,
  }))
  const [result, setResult] = useState<
    | { state: 'loading' }
    | { state: 'ready'; plan: ExecutionPlanDisplay }
    | { state: 'error'; message: string }
  >({ state: 'loading' })

  useEffect(() => {
    let cancelled = false
    setResult({ state: 'loading' })
    void getExecutionPlan({ data: request }).then(
      (value) => {
        if (!cancelled) setResult({ state: 'ready', plan: value })
      },
      () => {
        if (!cancelled)
          setResult({
            state: 'error',
            message: 'The readable execution plan could not be loaded.',
          })
      },
    )
    return () => {
      cancelled = true
    }
  }, [request])

  return {
    error: result.state === 'error' ? result.message : undefined,
    plan: result.state === 'ready' ? result.plan : undefined,
    retry: () => setRequest((current) => ({ ...current })),
    update: (plan: ExecutionPlanDisplay) => setResult({ state: 'ready', plan }),
    selectRevision: (applicationRevision: string) =>
      setRequest((current) => ({ ...current, applicationRevision })),
  }
}

interface PlanLoadErrorProps {
  message: string
  onRetry(): void
}

function PlanLoadError(props: PlanLoadErrorProps) {
  return (
    <div className="space-y-3 p-4">
      <p role="alert" className="text-sm text-destructive">
        {props.message}
      </p>
      <Button type="button" variant="outline" onClick={props.onRetry}>
        Retry
      </Button>
    </div>
  )
}

type AvailablePlan = Extract<ExecutionPlanDisplay, { state: 'available' }>

function PlanCacheDetails({ plan }: { plan: AvailablePlan }) {
  return (
    <div className="min-w-0 space-y-2 break-all text-xs text-muted-foreground">
      <p>Profile {plan.cacheKey.executionTargetProfileId}</p>
      <p>
        {plan.applicability.state === 'applicable'
          ? 'Applicable'
          : 'Deployment unverified'}
      </p>
      <p>
        Application{' '}
        <span className="font-mono">{plan.cacheKey.applicationRevision}</span>
      </p>
      <p>Recorded by run {plan.publication.sourceRunId}</p>
      <dl className="grid min-w-0 gap-2">
        <div>
          <dt>Project</dt>
          <dd className="font-mono">{plan.cacheKey.projectKey}</dd>
        </div>
        <div>
          <dt>Scenario revision</dt>
          <dd className="font-mono">{plan.cacheKey.scenarioRevision}</dd>
        </div>
        <div>
          <dt>Target fingerprint</dt>
          <dd className="font-mono">
            {plan.cacheKey.targetConfigurationFingerprint}
          </dd>
        </div>
        <div>
          <dt>Adapter schema</dt>
          <dd className="font-mono">
            {plan.cacheKey.adapterKind} /{' '}
            {plan.cacheKey.adapterCacheSchemaVersion}
          </dd>
        </div>
        <div>
          <dt>Cache revision</dt>
          <dd className="font-mono">{plan.cacheRevision}</dd>
        </div>
      </dl>
    </div>
  )
}

interface PlanNoticeProps {
  title: string
  message: string
  revisions?: readonly string[]
  onSelectRevision?: (revision: string) => void
}

function PlanNotice(props: PlanNoticeProps) {
  return (
    <Card className="m-3">
      <CardHeader>
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.message}</CardDescription>
      </CardHeader>
      {props.revisions?.length ? (
        <CardContent className="flex flex-wrap gap-2">
          {props.revisions.map((revision) => (
            <Button
              key={revision}
              type="button"
              variant="outline"
              size="sm"
              className="h-auto min-h-8 max-w-full whitespace-normal break-all"
              onClick={() => props.onSelectRevision?.(revision)}
            >
              Inspect {revision}
            </Button>
          ))}
        </CardContent>
      ) : null}
    </Card>
  )
}
