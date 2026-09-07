import {
  type PlanResult,
  planDigest,
  type StepIdentity,
} from '@pickle-spec/runner'
import type {
  WebExecutionCachePayload,
  WebInstruction,
  WebLocator,
} from './web-cache-schema'
import { webExecutionCachePayloadSchema } from './web-cache-schema'

type LocatorInstruction = Extract<WebInstruction, { locator: WebLocator }>

export interface ReplaceWebInteractionTarget {
  step: StepIdentity
  instructionIndex: number
  expectedInstructionDigest: string
  locator: WebLocator
}

const editableKinds = new Set<WebInstruction['kind']>([
  'click',
  'fill',
  'type',
  'hover',
  'select-option',
])

const assertionKinds = new Set<WebInstruction['kind']>([
  'wait-for',
  'exists',
  'visible',
  'hidden',
  'text-equals',
  'text-contains',
  'value-equals',
  'count-equals',
  'url-equals',
])

const sensitiveVariable =
  /(?:password|secret|token|credential|auth|api[-_.]?key)/i

function failure(
  reason: 'invalid-payload' | 'assertion-change' | 'write-conflict',
  message: string,
): PlanResult<never> {
  return { ok: false, reason, message }
}

function locatorVariables(locator: WebLocator): readonly string[] {
  return locator.selector.segments.flatMap((segment) =>
    'variable' in segment ? [segment.variable] : [],
  )
}

function valueVariables(instruction: WebInstruction): readonly string[] {
  if (instruction.kind === 'fill' || instruction.kind === 'type') {
    return instruction.value.segments.flatMap((segment) =>
      'variable' in segment ? [segment.variable] : [],
    )
  }
  if (instruction.kind === 'select-option') {
    return instruction.values.flatMap((value) =>
      value.segments.flatMap((segment) =>
        'variable' in segment ? [segment.variable] : [],
      ),
    )
  }
  return []
}

function stepMatches(
  step: StepIdentity | undefined,
  expected: StepIdentity,
): boolean {
  return (
    step?.index === expected.index &&
    step.scenarioRevision === expected.scenarioRevision
  )
}

interface ValidatedEdit {
  step: WebExecutionCachePayload['steps'][number]
  instruction: WebInstruction
}

function validateInstruction(
  instruction: WebInstruction,
  requiredVariables: readonly string[],
  edit: ReplaceWebInteractionTarget,
): PlanResult<true> {
  if (assertionKinds.has(instruction.kind)) {
    return failure(
      'assertion-change',
      'Assertion and wait instructions are protected',
    )
  }
  if (!editableKinds.has(instruction.kind)) {
    return failure(
      'assertion-change',
      `The ${instruction.kind} instruction cannot be edited`,
    )
  }
  if (planDigest(instruction) !== edit.expectedInstructionDigest) {
    return failure(
      'write-conflict',
      'The instruction changed since it was inspected',
    )
  }
  if (
    locatorVariables(edit.locator).some(
      (variable) => !requiredVariables.includes(variable),
    )
  ) {
    return failure(
      'invalid-payload',
      'The locator references an unknown variable',
    )
  }
  if (
    valueVariables(instruction).some((variable) =>
      sensitiveVariable.test(variable),
    )
  ) {
    return failure(
      'assertion-change',
      'Locator edits for sensitive input bindings are unsupported',
    )
  }
  return { ok: true, value: true }
}

function validateEdit(
  payload: WebExecutionCachePayload,
  steps: readonly StepIdentity[],
  requiredVariables: readonly string[],
  edit: ReplaceWebInteractionTarget,
): PlanResult<ValidatedEdit> {
  if (
    !Number.isSafeInteger(edit.instructionIndex) ||
    edit.instructionIndex < 0
  ) {
    return failure('invalid-payload', 'The instruction index is invalid')
  }
  if (!stepMatches(steps[edit.step.index], edit.step)) {
    return failure(
      'invalid-payload',
      'The requested Scenario step is not in the parent plan',
    )
  }
  const step = payload.steps[edit.step.index]
  const instruction = step?.instructions[edit.instructionIndex]
  if (!step || !instruction) {
    return failure(
      'invalid-payload',
      'The requested instruction is not in the parent plan',
    )
  }
  const semantics = validateInstruction(instruction, requiredVariables, edit)
  return semantics.ok ? { ok: true, value: { step, instruction } } : semantics
}

/** Replace one action locator while preserving the rest of the web payload. */
export function replaceWebInteractionTarget(
  payload: WebExecutionCachePayload,
  steps: readonly StepIdentity[],
  requiredVariables: readonly string[],
  edit: ReplaceWebInteractionTarget,
): PlanResult<WebExecutionCachePayload> {
  const validated = validateEdit(payload, steps, requiredVariables, edit)
  if (!validated.ok) return validated
  const stepsCopy = payload.steps.slice()
  const instructionsCopy = validated.value.step.instructions.slice()
  if (!('locator' in validated.value.instruction)) {
    return failure('invalid-payload', 'The edited instruction has no locator')
  }
  const locatorInstruction = validated.value.instruction
  const replacement: LocatorInstruction = {
    ...locatorInstruction,
    locator: edit.locator,
  }
  instructionsCopy[edit.instructionIndex] = replacement
  stepsCopy[edit.step.index] = { instructions: instructionsCopy }
  const result = webExecutionCachePayloadSchema.safeParse({
    ...payload,
    steps: stepsCopy,
  })
  return result.success
    ? { ok: true, value: result.data }
    : failure('invalid-payload', 'The edited web plan payload is invalid')
}
