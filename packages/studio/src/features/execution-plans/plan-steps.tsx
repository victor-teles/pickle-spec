import type {
  ExecutionPlanOperationDisplay,
  ExecutionPlanStepDisplay,
  ExecutionPlanTemplateDisplay,
} from '@pickle-spec/runner'
import type { ReactNode } from 'react'
import { Badge } from '../../components/ui/badge'

export type PlanStepFocus = Pick<
  ExecutionPlanStepDisplay,
  'index' | 'keyword' | 'text'
>

export function templateText(template: ExecutionPlanTemplateDisplay): string {
  return template.segments
    .map((segment) => {
      if (segment.kind === 'literal') return segment.value
      if (segment.kind === 'variable') return `<${segment.name}>`
      return '<redacted>'
    })
    .join('')
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
