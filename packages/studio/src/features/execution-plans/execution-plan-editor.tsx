import type {
  ExecutionPlanDraftDisplay,
  ExecutionPlanOperationDisplay,
  ExecutionPlanStepDisplay,
} from '@pickle-spec/runner'
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
import { Input } from '../../components/ui/input'
import { Label } from '../../components/ui/label'
import type {
  StudioExecutionPlanEditRequest,
  StudioWebLocator,
} from './execution-plan.contracts'

type EditableOperation = Omit<
  ExecutionPlanOperationDisplay,
  'editable' | 'target'
> & {
  editable: { instructionDigest: string }
  target: NonNullable<ExecutionPlanOperationDisplay['target']>
}

type DraftSaveResult =
  | { ok: true; value: ExecutionPlanDraftDisplay }
  | { ok: false; message: string }

interface ExecutionPlanEditorProps {
  draft: ExecutionPlanDraftDisplay
  onSave(request: StudioExecutionPlanEditRequest): Promise<DraftSaveResult>
  onDiscard(): void
}

interface EditingTarget {
  stepIndex: number
  instructionIndex: number
  instructionDigest: string
  selector: string
  nth: string
}

function templateText(
  template: NonNullable<ExecutionPlanOperationDisplay['target']>['selector'],
): string {
  return template.segments
    .map((segment) => {
      if (segment.kind === 'literal') return segment.value
      if (segment.kind === 'variable') return `<${segment.name}>`
      return '<redacted>'
    })
    .join('')
}

function shortRevision(revisionId: string): string {
  return `${revisionId.slice(0, 8)}…${revisionId.slice(-8)}`
}

function locatorFromText(
  selector: string,
  nth: string,
): StudioWebLocator | undefined {
  const segments: Array<{ literal: string } | { variable: string }> = []
  let cursor = 0
  const variablePattern = /<([A-Za-z_][A-Za-z0-9_.-]*)>/g
  for (const match of selector.matchAll(variablePattern)) {
    if (match.index > cursor) {
      segments.push({ literal: selector.slice(cursor, match.index) })
    }
    const variable = match[1]
    if (!variable) return undefined
    segments.push({ variable })
    cursor = match.index + match[0].length
  }
  if (cursor < selector.length)
    segments.push({ literal: selector.slice(cursor) })
  if (segments.length === 0) return undefined
  if (nth.trim() === '') return { selector: { segments } }
  const parsedNth = Number(nth)
  if (!Number.isSafeInteger(parsedNth) || parsedNth < 0) return undefined
  return { selector: { segments }, nth: parsedNth }
}

function isEditable(
  operation: ExecutionPlanOperationDisplay,
): operation is EditableOperation {
  return operation.editable !== undefined && operation.target !== undefined
}

function DraftHeader(props: {
  draft: ExecutionPlanDraftDisplay
  onDiscard(): void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Edit cached plan</CardTitle>
        <CardDescription>
          Change one action target at a time. The active execution plan stays
          unchanged until a later validation step.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-wrap items-center gap-2 text-xs">
        <Badge>Draft · inactive</Badge>
        <span className="font-mono text-muted-foreground">
          Revision {shortRevision(props.draft.revisionId)}
        </span>
        <details className="w-full text-muted-foreground">
          <summary className="cursor-pointer">What can I change?</summary>
          <p className="mt-2 max-w-prose">
            Click, fill, type, hover, and select-option targets are editable.
            Checks, values, navigation, waits, insertion, deletion, and
            reordering stay protected.
          </p>
        </details>
        <Button type="button" variant="outline" onClick={props.onDiscard}>
          Discard draft
        </Button>
      </CardContent>
    </Card>
  )
}

function TargetForm(props: {
  editing: EditingTarget
  error?: string
  saving: boolean
  onChange(value: EditingTarget): void
  onSave(): void
  onCancel(): void
}) {
  const id = `plan-target-${props.editing.stepIndex}-${props.editing.instructionIndex}`
  const errorId = `${id}-error`
  return (
    <div className="space-y-3 rounded-lg border border-border bg-muted/20 p-3">
      <div>
        <p className="text-sm font-medium">Change locator</p>
        <p className="text-xs text-muted-foreground">
          Enter the selector that should be used for this action.
        </p>
      </div>
      <Label htmlFor={`${id}-selector`}>New locator</Label>
      <Input
        id={`${id}-selector`}
        name={`${id}-selector`}
        autoComplete="off"
        className="text-base sm:text-sm"
        placeholder="#submit or [data-test='submit']"
        aria-invalid={props.error ? true : undefined}
        aria-describedby={props.error ? errorId : undefined}
        value={props.editing.selector}
        onChange={(event) =>
          props.onChange({ ...props.editing, selector: event.target.value })
        }
      />
      <Label htmlFor={`${id}-nth`}>Match number</Label>
      <Input
        id={`${id}-nth`}
        name={`${id}-nth`}
        autoComplete="off"
        className="text-base sm:text-sm"
        inputMode="numeric"
        placeholder="0"
        aria-invalid={props.error ? true : undefined}
        aria-describedby={props.error ? errorId : undefined}
        value={props.editing.nth}
        onChange={(event) =>
          props.onChange({ ...props.editing, nth: event.target.value })
        }
      />
      <p className="text-xs text-muted-foreground">
        Use 0 for the first match. Use <code>&lt;variable&gt;</code> for a
        required runtime value.
      </p>
      {props.error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {props.error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={props.saving} onClick={props.onSave}>
          {props.saving ? 'Saving…' : 'Save draft'}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={props.saving}
          onClick={props.onCancel}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

function DraftOperationRow(props: {
  operation: ExecutionPlanOperationDisplay
  stepIndex: number
  editing?: EditingTarget
  error?: string
  saving: boolean
  onEdit(operation: EditableOperation, stepIndex: number): void
  onChange(value: EditingTarget): void
  onSave(): void
  onCancel(): void
}) {
  const { operation } = props
  const editableOperation = isEditable(operation) ? operation : undefined
  const active =
    props.editing?.stepIndex === props.stepIndex &&
    props.editing.instructionIndex === operation.index
  const target = operation.target
  return (
    <li className="space-y-2 text-sm">
      <p className="font-medium">{operation.summary}</p>
      {target ? (
        <p className="break-all text-muted-foreground">
          {active ? 'Original target ' : 'Target '}
          {templateText(target.selector)}
          {target.nth === undefined ? '' : ` · match ${target.nth + 1}`}
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
      <OperationControls
        operation={operation}
        editableOperation={editableOperation}
        active={active}
        editing={props.editing}
        error={props.error}
        saving={props.saving}
        stepIndex={props.stepIndex}
        onEdit={props.onEdit}
        onChange={props.onChange}
        onSave={props.onSave}
        onCancel={props.onCancel}
      />
    </li>
  )
}

function OperationControls(props: {
  operation: ExecutionPlanOperationDisplay
  editableOperation?: EditableOperation
  active: boolean
  editing?: EditingTarget
  error?: string
  saving: boolean
  stepIndex: number
  onEdit(operation: EditableOperation, stepIndex: number): void
  onChange(value: EditingTarget): void
  onSave(): void
  onCancel(): void
}) {
  if (props.editableOperation && props.active && props.editing) {
    return (
      <TargetForm
        editing={props.editing}
        error={props.error}
        saving={props.saving}
        onChange={props.onChange}
        onSave={props.onSave}
        onCancel={props.onCancel}
      />
    )
  }
  if (props.editableOperation) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() =>
          props.onEdit(
            props.editableOperation as EditableOperation,
            props.stepIndex,
          )
        }
      >
        Change locator
      </Button>
    )
  }
  if (props.operation.check) return null
  return (
    <p className="text-xs text-muted-foreground">
      This operation is protected in the first editing slice.
    </p>
  )
}

function DraftStepCard(props: {
  step: ExecutionPlanStepDisplay
  editing?: EditingTarget
  error?: string
  saving: boolean
  onEdit(operation: EditableOperation, stepIndex: number): void
  onChange(value: EditingTarget): void
  onSave(): void
  onCancel(): void
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>
          {props.step.keyword.trim()} {props.step.text}
        </CardTitle>
        <CardDescription>
          Step {props.step.index + 1} · choose an editable action below
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="space-y-3">
          {props.step.operations.map((operation) => (
            <DraftOperationRow
              key={operation.index}
              operation={operation}
              stepIndex={props.step.index}
              editing={props.editing}
              error={props.error}
              saving={props.saving}
              onEdit={props.onEdit}
              onChange={props.onChange}
              onSave={props.onSave}
              onCancel={props.onCancel}
            />
          ))}
        </ol>
      </CardContent>
    </Card>
  )
}

function DraftStepList(props: {
  draft: ExecutionPlanDraftDisplay
  editing?: EditingTarget
  error?: string
  saving: boolean
  onEdit(operation: EditableOperation, stepIndex: number): void
  onChange(value: EditingTarget): void
  onSave(): void
  onCancel(): void
}) {
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      {props.draft.steps.map((step) => (
        <DraftStepCard
          key={step.index}
          step={step}
          editing={props.editing}
          error={props.error}
          saving={props.saving}
          onEdit={props.onEdit}
          onChange={props.onChange}
          onSave={props.onSave}
          onCancel={props.onCancel}
        />
      ))}
    </div>
  )
}

async function saveTarget(props: {
  draft: ExecutionPlanDraftDisplay
  editing?: EditingTarget
  onSave(request: StudioExecutionPlanEditRequest): Promise<DraftSaveResult>
  setEditing(value: EditingTarget | undefined): void
  setError(value: string | undefined): void
  setSaving(value: boolean): void
}) {
  if (!props.editing) return
  const locator = locatorFromText(props.editing.selector, props.editing.nth)
  if (!locator) {
    props.setError('Enter a locator and a non-negative match number.')
    return
  }
  props.setError(undefined)
  props.setSaving(true)
  let result: DraftSaveResult
  try {
    result = await props.onSave({
      scenarioId: props.draft.scope.scenarioId,
      profileId: props.draft.scope.executionTargetProfileId,
      applicationRevision: props.draft.scope.applicationRevision,
      parentRevisionId: props.draft.revisionId,
      step: {
        scenarioRevision: props.draft.scope.scenarioRevision,
        index: props.editing.stepIndex,
      },
      instructionIndex: props.editing.instructionIndex,
      expectedInstructionDigest: props.editing.instructionDigest,
      locator,
    })
  } catch {
    props.setSaving(false)
    props.setError(
      'Unable to save this draft. Check the connection and try again.',
    )
    return
  }
  props.setSaving(false)
  if (!result.ok) {
    props.setError(result.message)
    return
  }
  props.setEditing(undefined)
}

export function ExecutionPlanEditor(props: ExecutionPlanEditorProps) {
  const [editing, setEditing] = useState<EditingTarget>()
  const [error, setError] = useState<string>()
  const [saving, setSaving] = useState(false)

  function beginEdit(operation: EditableOperation, stepIndex: number) {
    setError(undefined)
    setEditing({
      stepIndex,
      instructionIndex: operation.index,
      instructionDigest: operation.editable.instructionDigest,
      selector: templateText(operation.target.selector),
      nth:
        operation.target.nth === undefined ? '' : String(operation.target.nth),
    })
  }

  return (
    <section className="space-y-3 p-3" aria-label="Execution plan draft editor">
      <DraftHeader
        draft={props.draft}
        onDiscard={() => {
          setEditing(undefined)
          setError(undefined)
          props.onDiscard()
        }}
      />
      <DraftStepList
        draft={props.draft}
        editing={editing}
        error={error}
        saving={saving}
        onEdit={beginEdit}
        onChange={(value) => setEditing(value)}
        onSave={() =>
          void saveTarget({
            draft: props.draft,
            editing,
            onSave: props.onSave,
            setEditing,
            setError,
            setSaving,
          })
        }
        onCancel={() => {
          setEditing(undefined)
          setError(undefined)
        }}
      />
    </section>
  )
}
