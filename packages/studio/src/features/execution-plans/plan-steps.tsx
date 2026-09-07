import type {
  ExecutionPlanOperationDisplay,
  ExecutionPlanStepDisplay,
  ExecutionPlanTemplateDisplay,
  ExecutionPlanUncachedStep,
} from '@pickle-spec/runner'
import { type ReactNode, useEffect, useRef } from 'react'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent } from '../../components/ui/card'

export type PlanStepFocus = Pick<
  ExecutionPlanStepDisplay,
  'index' | 'keyword' | 'text'
>

interface PlanStepsProps {
  steps: readonly ExecutionPlanStepDisplay[]
  uncachedTail: readonly ExecutionPlanUncachedStep[]
  focusStep?: PlanStepFocus
  renderOperation(
    operation: ExecutionPlanOperationDisplay,
    stepIndex: number,
  ): ReactNode
}

export function templateText(template: ExecutionPlanTemplateDisplay): string {
  return template.segments
    .map((segment) => {
      if (segment.kind === 'literal') return segment.value
      if (segment.kind === 'variable') return `<${segment.name}>`
      return '<redacted>'
    })
    .join('')
}

export function PlanSteps(props: PlanStepsProps) {
  const focusedRef = useRef<HTMLLIElement>(null)
  const matches = (step: PlanStepFocus) =>
    step.index === props.focusStep?.index &&
    step.keyword === props.focusStep.keyword &&
    step.text === props.focusStep.text
  const focused = props.steps.find(matches) ?? props.uncachedTail.find(matches)
  const focusedIndex = focused?.index
  useEffect(() => {
    if (focusedIndex === undefined) return
    focusedRef.current?.scrollIntoView({ block: 'nearest' })
    focusedRef.current?.focus({ preventScroll: true })
  }, [focusedIndex])

  return (
    <Card size="sm">
      <CardContent>
        {props.focusStep && !focused ? (
          <p role="status" className="mb-3 text-xs text-muted-foreground">
            The recorded failed step does not match the current Gherkin plan, so
            failed-step focus is unavailable.
          </p>
        ) : null}
        <ol aria-label="Plan steps" className="min-w-0 divide-y divide-border">
          {props.steps.map((step) => (
            <li
              key={step.index}
              ref={step === focused ? focusedRef : undefined}
              tabIndex={step === focused ? -1 : undefined}
              data-state={step === focused ? 'selected' : undefined}
              className="min-w-0 space-y-2 py-3 first:pt-0 last:pb-0 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <h4 className="break-words text-sm font-medium">
                {step.keyword.trim()} {step.text}
              </h4>
              <p className="text-xs text-muted-foreground">
                Step {step.index + 1}
                {step === focused ? ' · Recorded failed step' : ''}
              </p>
              <ol className="min-w-0 divide-y divide-border">
                {step.operations.map((operation) => (
                  <li
                    key={operation.index}
                    className="min-w-0 py-2 first:pt-0 last:pb-0"
                  >
                    {props.renderOperation(operation, step.index)}
                  </li>
                ))}
              </ol>
            </li>
          ))}
          {props.uncachedTail.map((step, index) => (
            <li
              key={step.index}
              ref={step === focused ? focusedRef : undefined}
              tabIndex={step === focused ? -1 : undefined}
              data-state={step === focused ? 'selected' : undefined}
              className="space-y-2 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {index === 0 ? (
                <>
                  <h4 className="text-sm font-medium">Uncached tail</h4>
                  <p className="text-xs text-muted-foreground">
                    Run Replay cannot complete these remaining Gherkin steps
                    from this cache entry.
                  </p>
                </>
              ) : null}
              <p className="break-words text-sm">
                {step.keyword.trim()} {step.text}
                {step === focused ? ' · Recorded failed step' : ''}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

interface PlanOperationProps {
  operation: ExecutionPlanOperationDisplay
  children?: ReactNode
  targetLabel?: string
}

export function PlanOperation({
  operation,
  children,
  targetLabel = 'Target',
}: PlanOperationProps) {
  const match = operation.target?.nth
  return (
    <div className="min-w-0 space-y-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-medium">{operation.summary}</p>
        {children}
      </div>
      {operation.target ? (
        <p className="break-all text-muted-foreground">
          {targetLabel}{' '}
          <span className="font-mono">
            {templateText(operation.target.selector)}
          </span>
          {match === undefined ? '' : ` · match ${match + 1}`}
        </p>
      ) : null}
      {operation.value ? (
        <p className="break-all text-muted-foreground">
          Value {templateText(operation.value)}
        </p>
      ) : null}
      {operation.check ? (
        <Badge>Protected check {operation.check}</Badge>
      ) : null}
      {!operation.editable && !operation.check ? (
        <p className="text-muted-foreground">This operation is read-only.</p>
      ) : null}
    </div>
  )
}
