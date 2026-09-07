import type {
  ExecutionPlanDisplay,
  ExecutionPlanDraftDisplay,
  ExecutionPlanTemplateDisplay,
} from '@pickle-spec/runner'
import { useEffect, useRef, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
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

type ExecutionPlanPanelProps = {
  scenarioId: string
  profileId: string
  focusStep?: { index: number; keyword: string; text: string }
}

export function ScenarioExecutionPlan(props: {
  scenarioId: string
  profiles: readonly string[]
}) {
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

function templateText(template: ExecutionPlanTemplateDisplay): string {
  return template.segments
    .map((segment) => {
      if (segment.kind === 'literal') return segment.value
      if (segment.kind === 'variable') return `<${segment.name}>`
      return '<redacted>'
    })
    .join('')
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
  try {
    const result = await editExecutionPlan({ data: request })
    if (!result.ok) return { ok: false as const, message: result.message }
    setDraft(result.value)
    return { ok: true as const, value: result.value }
  } catch {
    return {
      ok: false as const,
      message: 'Unable to save this draft. Check the connection and try again.',
    }
  }
}

function EditablePlanView(props: {
  plan: Extract<ExecutionPlanDisplay, { state: 'available' }>
  focusStep?: ExecutionPlanPanelProps['focusStep']
  draft?: ExecutionPlanDraftDisplay
  captureError?: string
  capturing: boolean
  onCapture(): void
  onSave(request: StudioExecutionPlanEditRequest): Promise<
    | {
        ok: true
        value: ExecutionPlanDraftDisplay
      }
    | { ok: false; message: string }
  >
  onDiscard(): void
}) {
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
      {props.draft ? (
        <ExecutionPlanEditor
          draft={props.draft}
          onSave={props.onSave}
          onDiscard={props.onDiscard}
        />
      ) : null}
    </>
  )
}

function useExecutionPlan(props: ExecutionPlanPanelProps) {
  const [request, setRequest] = useState(() => ({
    scenarioId: props.scenarioId,
    profileId: props.profileId,
    applicationRevision: undefined as string | undefined,
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

function PlanLoadError(props: { message: string; onRetry: () => void }) {
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

function PlanCacheHeader(props: {
  plan: Extract<ExecutionPlanDisplay, { state: 'available' }>
  onStartDraft?: () => void
  capturing?: boolean
}) {
  const { plan } = props
  return (
    <Card>
      <CardHeader>
        <CardTitle>Current cached plan</CardTitle>
        <CardDescription>{plan.sourceNotice}</CardDescription>
        {props.onStartDraft ? (
          <CardAction className="col-span-2 col-start-1 row-start-3 w-full justify-self-stretch">
            <Button
              type="button"
              size="sm"
              className="h-auto min-h-7 w-full max-w-full justify-start whitespace-normal text-left leading-snug"
              onClick={props.onStartDraft}
              disabled={props.capturing}
            >
              {props.capturing ? 'Starting draft…' : 'Start draft from cache'}
            </Button>
          </CardAction>
        ) : null}
      </CardHeader>
      <CardContent className="flex flex-wrap gap-2 text-xs">
        <Badge className="h-auto min-h-5 max-w-full whitespace-normal break-all">
          Profile {plan.cacheKey.executionTargetProfileId}
        </Badge>
        <Badge>
          {plan.applicability.state === 'applicable'
            ? 'Applicable'
            : 'Deployment unverified'}
        </Badge>
        <p className="w-full min-w-0 break-all text-muted-foreground">
          Application{' '}
          <span className="font-mono">{plan.cacheKey.applicationRevision}</span>
        </p>
        <span className="text-muted-foreground">
          Published by run {plan.publication.sourceRunId}
        </span>
        <details className="w-full min-w-0 text-muted-foreground">
          <summary className="cursor-pointer">Applicability details</summary>
          <dl className="mt-2 grid min-w-0 gap-2 break-all font-mono">
            <div>
              <dt>Project</dt>
              <dd>{plan.cacheKey.projectKey}</dd>
            </div>
            <div>
              <dt>Scenario revision</dt>
              <dd>{plan.cacheKey.scenarioRevision}</dd>
            </div>
            <div>
              <dt>Target fingerprint</dt>
              <dd>{plan.cacheKey.targetConfigurationFingerprint}</dd>
            </div>
            <div>
              <dt>Adapter schema</dt>
              <dd>
                {plan.cacheKey.adapterKind} /{' '}
                {plan.cacheKey.adapterCacheSchemaVersion}
              </dd>
            </div>
            <div>
              <dt>Cache revision</dt>
              <dd>{plan.cacheRevision}</dd>
            </div>
          </dl>
        </details>
      </CardContent>
    </Card>
  )
}

function AvailableExecutionPlan(props: {
  plan: Extract<ExecutionPlanDisplay, { state: 'available' }>
  focusStep?: ExecutionPlanPanelProps['focusStep']
  onStartDraft?: () => void
  capturing?: boolean
}) {
  const { plan } = props
  const focusedStepRef = useRef<HTMLDivElement>(null)
  const { focusedPlanStep, focusedUncachedStep, focusUnavailable } =
    focusedGroups(plan, props.focusStep)
  const focusedIndex = focusedPlanStep?.index ?? focusedUncachedStep?.index
  useEffect(() => {
    if (focusedIndex === undefined) return
    focusedStepRef.current?.scrollIntoView({ block: 'nearest' })
    focusedStepRef.current?.focus({ preventScroll: true })
  }, [focusedIndex])
  return (
    <section className="space-y-3 p-3" aria-label="Readable execution plan">
      {focusUnavailable ? <UnavailableFocus /> : null}
      <PlanCacheHeader
        plan={plan}
        onStartDraft={props.onStartDraft}
        capturing={props.capturing}
      />
      {plan.steps.map((step) => {
        const focused = step === focusedPlanStep
        return (
          <Card
            key={step.index}
            ref={focused ? focusedStepRef : undefined}
            tabIndex={focused ? -1 : undefined}
            data-state={focused ? 'selected' : undefined}
            className="outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=selected]:ring-2 data-[state=selected]:ring-ring"
          >
            <CardHeader>
              <CardTitle>
                {step.keyword.trim()} {step.text}
              </CardTitle>
              <CardDescription>
                Step {step.index + 1}
                {focused ? ' · Recorded failed step' : ''}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-3">
                {step.operations.map((operation) => (
                  <PlanOperation key={operation.index} operation={operation} />
                ))}
              </ol>
            </CardContent>
          </Card>
        )
      })}
      {plan.uncachedTail.length > 0 ? (
        <Card
          ref={focusedUncachedStep ? focusedStepRef : undefined}
          tabIndex={focusedUncachedStep ? -1 : undefined}
          data-state={focusedUncachedStep ? 'selected' : undefined}
          className="outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=selected]:ring-2 data-[state=selected]:ring-ring"
        >
          <CardHeader>
            <CardTitle>Uncached tail</CardTitle>
            <CardDescription>
              Run Replay cannot complete these remaining Gherkin steps from this
              cache entry.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ol className="space-y-1 text-sm">
              {plan.uncachedTail.map((step) => (
                <li key={step.index}>
                  {step.keyword.trim()} {step.text}
                  {step === focusedUncachedStep
                    ? ' · Recorded failed step'
                    : ''}
                </li>
              ))}
            </ol>
          </CardContent>
        </Card>
      ) : null}
    </section>
  )
}

function focusedGroups(
  plan: Extract<ExecutionPlanDisplay, { state: 'available' }>,
  focus: ExecutionPlanPanelProps['focusStep'],
) {
  const matches = (step: { index: number; keyword: string; text: string }) =>
    Boolean(
      focus &&
        step.index === focus.index &&
        step.keyword === focus.keyword &&
        step.text === focus.text,
    )
  const focusedPlanStep = plan.steps.find(matches)
  const focusedUncachedStep = plan.uncachedTail.find(matches)
  return {
    focusedPlanStep,
    focusedUncachedStep,
    focusUnavailable: Boolean(
      focus && !focusedPlanStep && !focusedUncachedStep,
    ),
  }
}

function UnavailableFocus() {
  return (
    <p role="status" className="text-sm text-muted-foreground">
      The recorded failed step does not match the current Gherkin plan, so
      failed-step focus is unavailable.
    </p>
  )
}

function PlanOperation(props: {
  operation: Extract<
    ExecutionPlanDisplay,
    { state: 'available' }
  >['steps'][number]['operations'][number]
}) {
  const { operation } = props
  const match = operation.target?.nth
  return (
    <li className="space-y-1 text-sm">
      <p className="font-medium">{operation.summary}</p>
      {operation.target ? (
        <p className="break-all text-muted-foreground">
          Target {templateText(operation.target.selector)}
          {match === undefined ? '' : ` · match ${match + 1}`}
        </p>
      ) : null}
      {operation.value ? (
        <p className="break-all text-muted-foreground">
          Value {templateText(operation.value)}
        </p>
      ) : null}
      {operation.check ? <Badge>Check {operation.check}</Badge> : null}
    </li>
  )
}

function PlanNotice(props: {
  title: string
  message: string
  revisions?: readonly string[]
  onSelectRevision?: (revision: string) => void
}) {
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
