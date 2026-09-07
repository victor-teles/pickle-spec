import type {
  ExecutionPlanDraftDisplay,
  ExecutionPlanOperationDisplay,
} from '@pickle-spec/runner'
import { useRef, useState } from 'react'
import type { StudioExecutionPlanEditRequest } from './execution-plan.contracts'
import {
  type LocatorErrors,
  type LocatorInput,
  parseLocatorInput,
} from './locator-form'
import { templateText } from './plan-steps'

type DraftSaveResult =
  | { ok: true; value: ExecutionPlanDraftDisplay }
  | { ok: false; message: string }

export interface LocatorEditProps {
  draft: ExecutionPlanDraftDisplay
  onSave(request: StudioExecutionPlanEditRequest): Promise<DraftSaveResult>
}

interface EditingTarget {
  stepIndex: number
  operation: ExecutionPlanOperationDisplay
  original: LocatorInput
  value: LocatorInput
  saving: boolean
  errors?: LocatorErrors
}

export function hasChanges(editing: EditingTarget): boolean {
  return (
    editing.value.selector !== editing.original.selector ||
    editing.value.match !== editing.original.match
  )
}

interface SaveTargetProps extends LocatorEditProps {
  editing?: EditingTarget
  setEditing(value: EditingTarget): void
  finishEdit(message: string): void
}

async function saveTarget(props: SaveTargetProps) {
  const { editing, setEditing, finishEdit } = props
  if (
    !editing ||
    editing.saving ||
    !hasChanges(editing) ||
    !editing.operation.editable
  )
    return
  const parsed = parseLocatorInput(editing.value)
  if (!parsed.ok) {
    setEditing({ ...editing, errors: parsed.errors })
    return
  }
  setEditing({ ...editing, saving: true, errors: undefined })
  let result: DraftSaveResult
  try {
    result = await props.onSave({
      scenarioId: props.draft.scope.scenarioId,
      profileId: props.draft.scope.executionTargetProfileId,
      applicationRevision: props.draft.scope.applicationRevision,
      parentRevisionId: props.draft.revisionId,
      step: {
        scenarioRevision: props.draft.scope.scenarioRevision,
        index: editing.stepIndex,
      },
      instructionIndex: editing.operation.index,
      expectedInstructionDigest: editing.operation.editable.instructionDigest,
      locator: parsed.locator,
    })
  } catch {
    result = {
      ok: false,
      message: 'Unable to save this draft. Check the connection and try again.',
    }
  }
  if (!result.ok) {
    setEditing({
      ...editing,
      saving: false,
      errors: { save: result.message },
    })
    return
  }
  finishEdit('Saved to draft')
}

export function useLocatorEdit(props: LocatorEditProps) {
  const [editing, setEditing] = useState<EditingTarget>()
  const [notice, setNotice] = useState('')
  const editButtonRef = useRef<HTMLButtonElement | null>(null)
  const blocked = Boolean(editing && (editing.saving || hasChanges(editing)))

  function beginEdit(
    operation: ExecutionPlanOperationDisplay,
    stepIndex: number,
    button: HTMLButtonElement,
  ) {
    if (blocked || !operation.editable || !operation.target) return
    const original = {
      selector: templateText(operation.target.selector),
      match:
        operation.target.nth === undefined
          ? ''
          : String(operation.target.nth + 1),
    }
    editButtonRef.current = button
    setNotice('')
    setEditing({
      stepIndex,
      operation,
      original,
      value: original,
      saving: false,
    })
  }

  function finishEdit(message: string) {
    setEditing(undefined)
    setNotice(message)
    requestAnimationFrame(() => editButtonRef.current?.focus())
  }

  let status = notice
  if (blocked)
    status =
      'Save or cancel your change before editing another action or closing the draft.'
  if (editing?.saving) status = 'Saving change…'
  return {
    editing,
    blocked,
    status,
    beginEdit,
    finishEdit,
    change: (value: LocatorInput) => {
      if (editing && !editing.saving)
        setEditing({ ...editing, value, errors: undefined })
    },
    save: () => saveTarget({ ...props, editing, setEditing, finishEdit }),
  }
}
