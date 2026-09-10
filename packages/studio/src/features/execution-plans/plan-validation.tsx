import { useId, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import { Checkbox } from '../../components/ui/checkbox'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible'
import { Label } from '../../components/ui/label'
import { Textarea } from '../../components/ui/textarea'
import type { StudioPlanValidationInspection } from './execution-plan.contracts'
import { PlanOperation, PlanSteps } from './plan-steps'
import { usePlanValidation } from './use-plan-validation'

interface ValidationReviewProps {
  inspection: StudioPlanValidationInspection
  disabled: boolean
  onValidate: (rationale: string) => void
}

function ValidationReview({
  inspection,
  disabled,
  onValidate,
}: ValidationReviewProps) {
  const id = useId()
  const [rationale, setRationale] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const [reset, setReset] = useState(false)
  return (
    <div className="space-y-3">
      <Collapsible defaultOpen>
        <CollapsibleTrigger render={<Button size="sm" variant="outline" />}>
          Compare baseline and candidate
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-3 pt-3">
          <h4 className="text-sm font-medium">
            Baseline · original expectations
          </h4>
          <PlanSteps
            steps={inspection.baselineSteps}
            uncachedTail={[]}
            renderOperation={(operation) => (
              <PlanOperation operation={operation} />
            )}
          />
          <h4 className="text-sm font-medium">Candidate · saved revision</h4>
          <PlanSteps
            steps={inspection.candidateSteps}
            uncachedTail={[]}
            renderOperation={(operation) => (
              <PlanOperation operation={operation} />
            )}
          />
        </CollapsibleContent>
      </Collapsible>
      <Label htmlFor={`${id}-rationale`}>
        Why does this target preserve the Scenario’s intent?
      </Label>
      <Textarea
        id={`${id}-rationale`}
        value={rationale}
        disabled={disabled}
        onChange={(event) => setRationale(event.target.value)}
      />
      <Label className="items-start" htmlFor={`${id}-review`}>
        <Checkbox
          id={`${id}-review`}
          checked={reviewed}
          disabled={disabled}
          onCheckedChange={setReviewed}
        />
        I compared the candidate with the baseline and Specification. The
        original expected outcomes are preserved.
      </Label>
      <Label className="items-start" htmlFor={`${id}-reset`}>
        <Checkbox
          id={`${id}-reset`}
          checked={reset}
          disabled={disabled}
          onCheckedChange={setReset}
        />
        I reset the application to the Scenario’s starting state.
      </Label>
      <Button
        size="sm"
        disabled={disabled || !reviewed || !reset || !rationale.trim()}
        onClick={() => onValidate(rationale.trim())}
      >
        Validate candidate
      </Button>
    </div>
  )
}

interface PlanValidationProps {
  revisionId: string
  disabled: boolean
}

export function PlanValidation({ revisionId, disabled }: PlanValidationProps) {
  const { state, inspect, validate, cancel } = usePlanValidation(revisionId)
  const busy =
    state.phase === 'loading' ||
    state.phase === 'starting' ||
    state.phase === 'running'
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Validate candidate</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-xs">
        <p className="text-muted-foreground">
          Validation runs every Scenario action and may submit forms, create
          records, or change application data. Reset the application first;
          Pickle does not reset it. Cancelling cannot undo completed actions.
        </p>
        <p className="text-muted-foreground">
          Validation uses the saved candidate without model inference. The
          active plan and cache stay unchanged.
        </p>
        {disabled ? (
          <p role="status">
            Save or cancel the locator edit before validating.
          </p>
        ) : null}
        {state.phase === 'review' ? (
          <ValidationReview
            inspection={state.inspection}
            disabled={disabled}
            onValidate={(rationale) => void validate(rationale)}
          />
        ) : null}
        {busy ? (
          <p role="status">
            {state.phase === 'running'
              ? 'Validating the complete Scenario…'
              : 'Preparing validation…'}
          </p>
        ) : null}
        {state.phase === 'running' ? (
          <>
            <p className="break-all">
              Run {state.runId} · evidence is available in Runs.
            </p>
            <Button size="sm" variant="outline" onClick={() => void cancel()}>
              Cancel validation
            </Button>
          </>
        ) : null}
        {state.phase === 'complete' ? (
          <div role="status" className="space-y-2">
            <Badge>
              {state.status.state === 'validated'
                ? 'Validated · inactive'
                : `${state.status.state === 'failed' ? 'Failed' : 'Cancelled'} · inactive`}
            </Badge>
            <p className="break-all">
              Run {state.status.runId} · evidence is available in Runs.
            </p>
            {state.status.state === 'validated' ? (
              <p>
                Exact saved revision passed with zero inference. A further edit
                requires another review and validation.
              </p>
            ) : (
              <p>No passing receipt was issued for this run.</p>
            )}
          </div>
        ) : null}
        {state.phase === 'error' ? (
          <div role="alert">
            <p>{state.message}</p>
            {state.runId ? (
              <p className="break-all">Run {state.runId}</p>
            ) : null}
          </div>
        ) : null}
        {!busy && state.phase !== 'review' ? (
          <Button
            size="sm"
            variant="outline"
            disabled={disabled}
            onClick={() => void inspect()}
          >
            Review for validation
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
