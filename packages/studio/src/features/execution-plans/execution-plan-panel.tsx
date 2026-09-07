import type {
  ExecutionPlanDisplay,
  ExecutionPlanDraftDisplay,
} from '@pickle-spec/runner'
import { type ComponentProps, useEffect, useState } from 'react'
import { Button } from '../../components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible'
import type {
  StudioExecutionPlanDraftResult,
  StudioExecutionPlanEditRequest,
  StudioExecutionPlanRequest,
} from './execution-plan.contracts'
import {
  captureExecutionPlan,
  editExecutionPlan,
  getExecutionPlan,
} from './execution-plan.functions'
import { ExecutionPlanEditor } from './execution-plan-editor'
import { PlanOperation, type PlanStepFocus, PlanSteps } from './plan-steps'

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
  const draftState = useExecutionPlanDraft()

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
    <EditablePlanView
      plan={loaded.plan}
      focusStep={props.focusStep}
      draft={draftState.draft}
      captureError={draftState.captureError}
      capturing={draftState.capturing}
      onCapture={() => {
        void captureDraft(loaded.request, draftState)
      }}
      onSave={(request) => saveDraft(request, draftState.setDraft)}
      onDiscard={draftState.discard}
    />
  )
}

export type ExecutionPlanDraftState = {
  draft?: ExecutionPlanDraftDisplay
  captureError?: string
  capturing: boolean
  setDraft(value: ExecutionPlanDraftDisplay): void
  setCaptureError(value: string | undefined): void
  setCapturing(value: boolean): void
  discard(): void
}

function useExecutionPlanDraft(): ExecutionPlanDraftState {
  const [draft, setDraft] = useState<ExecutionPlanDraftDisplay>()
  const [captureError, setCaptureError] = useState<string>()
  const [capturing, setCapturing] = useState(false)
  return {
    draft,
    captureError,
    capturing,
    setDraft,
    setCaptureError,
    setCapturing,
    discard: () => {
      setDraft(undefined)
      setCaptureError(undefined)
    },
  }
}

type CaptureExecutionPlan = (input: {
  data: StudioExecutionPlanRequest
}) => Promise<StudioExecutionPlanDraftResult>

export async function captureDraft(
  request: StudioExecutionPlanRequest,
  state: ExecutionPlanDraftState,
  capture: CaptureExecutionPlan = captureExecutionPlan,
) {
  state.setCaptureError(undefined)
  state.setCapturing(true)
  try {
    const result = await capture({ data: request })
    if (!result.ok) {
      state.setCaptureError(result.message)
      return
    }
    state.setDraft(result.value)
  } catch {
    state.setCaptureError(
      'Unable to start the draft. Check the project and try again.',
    )
  } finally {
    state.setCapturing(false)
  }
}

async function saveDraft(
  request: StudioExecutionPlanEditRequest,
  setDraft: (value: ExecutionPlanDraftDisplay) => void,
) {
  const result = await editExecutionPlan({ data: request })
  if (!result.ok) return { ok: false as const, message: result.message }
  setDraft(result.value)
  return { ok: true as const, value: result.value }
}

interface EditablePlanViewProps {
  plan: Extract<ExecutionPlanDisplay, { state: 'available' }>
  focusStep?: ExecutionPlanPanelProps['focusStep']
  draft?: ExecutionPlanDraftDisplay
  captureError?: string
  capturing: boolean
  onCapture(): void
  onSave: ComponentProps<typeof ExecutionPlanEditor>['onSave']
  onDiscard(): void
}

function EditablePlanView(props: EditablePlanViewProps) {
  if (props.draft) {
    return (
      <ExecutionPlanEditor
        draft={props.draft}
        focusStep={props.focusStep}
        onSave={props.onSave}
        onDiscard={props.onDiscard}
      >
        <PlanCacheDetails plan={props.plan} />
      </ExecutionPlanEditor>
    )
  }
  return (
    <>
      <AvailableExecutionPlan
        plan={props.plan}
        focusStep={props.focusStep}
        onStartDraft={props.onCapture}
        capturing={props.capturing}
      />
      {props.captureError ? (
        <p role="alert" className="px-3 text-sm text-destructive">
          {props.captureError}
        </p>
      ) : null}
    </>
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
    request,
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

interface AvailableExecutionPlanProps {
  plan: AvailablePlan
  focusStep?: PlanStepFocus
  onStartDraft(): void
  capturing: boolean
}

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
      <p>Published by run {plan.publication.sourceRunId}</p>
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

function AvailableExecutionPlan(props: AvailableExecutionPlanProps) {
  const { plan } = props
  return (
    <section
      className="min-w-0 space-y-3 p-3"
      aria-label="Readable execution plan"
    >
      <Card size="sm">
        <CardHeader>
          <CardTitle>Current cached plan</CardTitle>
          <CardDescription>{plan.sourceNotice}</CardDescription>
          <CardAction className="col-span-2 col-start-1 row-start-3 justify-self-start">
            <Button
              type="button"
              size="sm"
              onClick={props.onStartDraft}
              disabled={props.capturing}
            >
              {props.capturing ? 'Starting draft…' : 'Start draft from cache'}
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <Collapsible>
            <CollapsibleTrigger
              render={<Button type="button" size="sm" variant="ghost" />}
            >
              Applicability details
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2">
              <PlanCacheDetails plan={plan} />
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>
      <PlanSteps
        steps={plan.steps}
        uncachedTail={plan.uncachedTail}
        focusStep={props.focusStep}
        renderOperation={(operation) => <PlanOperation operation={operation} />}
      />
    </section>
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
