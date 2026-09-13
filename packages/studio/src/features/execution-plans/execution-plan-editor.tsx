import type { ReactNode } from 'react'
import { Button } from '../../components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../components/ui/collapsible'
import { LocatorForm } from './locator-form'
import { PlanCanvas } from './plan-canvas'
import { PlanOperation, type PlanStepFocus } from './plan-steps'
import {
  hasChanges,
  type LocatorEditProps,
  useLocatorEdit,
} from './use-locator-edit'

interface ExecutionPlanEditorProps extends LocatorEditProps {
  focusStep?: PlanStepFocus
  children?: ReactNode
  onReload(this: void): void
}

export function ExecutionPlanEditor(props: ExecutionPlanEditorProps) {
  const editor = useLocatorEdit(props)
  return (
    <section
      className="min-w-0 space-y-3 p-3"
      aria-label="Execution plan editor"
    >
      <Collapsible>
        <header className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">Execution plan</h3>
          <div className="flex items-center gap-1">
            <CollapsibleTrigger render={<Button size="sm" variant="ghost" />}>
              Plan details
            </CollapsibleTrigger>
            <Button
              size="sm"
              variant="outline"
              disabled={editor.blocked}
              onClick={props.onReload}
            >
              Reload plan
            </Button>
          </div>
        </header>
        <CollapsibleContent className="space-y-3 pt-3 text-xs text-muted-foreground">
          <p>{props.plan.sourceNotice}</p>
          {props.children}
        </CollapsibleContent>
      </Collapsible>
      <PlanCanvas
        steps={props.plan.steps}
        uncachedTail={props.plan.uncachedTail}
        focusStep={props.focusStep}
        blocked={editor.blocked}
        editing={Boolean(editor.editing)}
        status={editor.status}
        onSelect={(operation, stepIndex, button) => {
          if (operation.editable && operation.target)
            editor.beginEdit(operation, stepIndex, button)
          else if (editor.editing) editor.finishEdit('')
        }}
        renderDetails={(operation, stepIndex) => {
          const editing = editor.editing
          if (
            editing?.stepIndex === stepIndex &&
            editing.operation.index === operation.index
          ) {
            return (
              <LocatorForm
                key={`${stepIndex}-${operation.index}`}
                value={editing.value}
                errors={editing.errors}
                saving={editing.saving}
                dirty={hasChanges(editing)}
                onChange={editor.change}
                onSave={() => void editor.save()}
                onCancel={() => editor.finishEdit('Changes cancelled')}
              />
            )
          }
          return <PlanOperation operation={operation} />
        }}
      />
    </section>
  )
}
