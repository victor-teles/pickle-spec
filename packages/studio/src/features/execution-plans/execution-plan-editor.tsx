import type {
  ExecutionPlanDraftDisplay,
  ExecutionPlanOperationDisplay,
} from '@pickle-spec/runner'
import type { ReactNode } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '../../components/ui/card'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible'
import { LocatorForm } from './locator-form'
import { PlanOperation, type PlanStepFocus, PlanSteps } from './plan-steps'
import {
  hasChanges,
  type LocatorEditProps,
  useLocatorEdit,
} from './use-locator-edit'

interface ExecutionPlanEditorProps extends LocatorEditProps {
  focusStep?: PlanStepFocus
  children?: ReactNode
  onDiscard(): void
}

interface EditableOperationProps {
  operation: ExecutionPlanOperationDisplay
  stepIndex: number
  editor: ReturnType<typeof useLocatorEdit>
}

function EditableOperation(props: EditableOperationProps) {
  const { operation, stepIndex, editor } = props
  const { editing, blocked, beginEdit, finishEdit, save, change } = editor
  const active =
    editing?.stepIndex === stepIndex &&
    editing.operation.index === operation.index
  const editable = Boolean(operation.editable && operation.target)
  return (
    <>
      <PlanOperation
        operation={operation}
        targetLabel={active ? 'Original target' : 'Target'}
      >
        {editable ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-expanded={active}
            disabled={blocked || active}
            onClick={(event) =>
              beginEdit(operation, stepIndex, event.currentTarget)
            }
          >
            Edit locator
          </Button>
        ) : null}
      </PlanOperation>
      {active && editing ? (
        <LocatorForm
          key={`${stepIndex}-${operation.index}`}
          value={editing.value}
          errors={editing.errors}
          saving={editing.saving}
          dirty={hasChanges(editing)}
          onChange={change}
          onSave={() => void save()}
          onCancel={() => finishEdit('Changes cancelled')}
        />
      ) : null}
    </>
  )
}

interface DraftHeaderProps {
  draft: ExecutionPlanDraftDisplay
  blocked: boolean
  status: string
  children?: ReactNode
  onDiscard(): void
}

function DraftHeader(props: DraftHeaderProps) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>Edit cached plan</CardTitle>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Badge>Draft · inactive</Badge>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={props.blocked}
            onClick={props.onDiscard}
          >
            Close draft
          </Button>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-2 text-xs">
        <p className="text-muted-foreground">
          Edit action locators. Saving a draft does not change the active plan.
        </p>
        <p role="status" className="text-muted-foreground">
          {props.status}
        </p>
        <Collapsible>
          <CollapsibleTrigger
            render={<Button type="button" size="sm" variant="ghost" />}
          >
            Draft details
          </CollapsibleTrigger>
          <CollapsibleContent className="min-w-0 space-y-3 pt-2 text-muted-foreground">
            <p>{props.draft.sourceNotice}</p>
            <p className="break-all">
              Revision{' '}
              <span className="font-mono">{props.draft.revisionId}</span>
            </p>
            <p>
              Click, fill, type, hover, and select-option targets are editable.
              Checks, values, navigation, waits, insertion, deletion, and
              reordering are read-only.
            </p>
            {props.children}
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  )
}

export function ExecutionPlanEditor(props: ExecutionPlanEditorProps) {
  const editor = useLocatorEdit(props)
  return (
    <section
      className="min-w-0 space-y-3 p-3"
      aria-label="Execution plan draft editor"
    >
      <DraftHeader
        draft={props.draft}
        blocked={editor.blocked}
        status={editor.status}
        onDiscard={props.onDiscard}
      >
        {props.children}
      </DraftHeader>
      <PlanSteps
        steps={props.draft.steps}
        uncachedTail={props.draft.uncachedTail}
        focusStep={props.focusStep}
        renderOperation={(operation, stepIndex) => (
          <EditableOperation
            operation={operation}
            stepIndex={stepIndex}
            editor={editor}
          />
        )}
      />
    </section>
  )
}
