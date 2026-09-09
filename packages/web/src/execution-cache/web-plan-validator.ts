import {
  type PlanResult,
  planDigest,
  type StepIdentity,
} from '@pickle-spec/runner'
import type { ScenarioStep } from '@pickle-spec/spec'
import {
  parseWebExecutionCachePayload,
  webPrefixStepCount,
} from './web-execution-cache'
import { replaceWebInteractionTarget } from './web-plan-editor'
import { projectWebExecutionPlan } from './web-plan-projector'
import type {
  WebExecutionCachePayload,
  WebInstruction,
  WebLocator,
} from './web-cache-schema'
import { webExecutionCachePayloadSchema } from './web-cache-schema'

export const webPlanValidatorVersion = '1'

export interface ValidatedWebExecutionPlan {
  baselinePayload: WebExecutionCachePayload
  payload: WebExecutionCachePayload
  assertionDigest: string
}

interface ValidateWebExecutionPlanCandidateInput {
  baselinePayload: unknown
  candidatePayload: unknown
  steps: readonly StepIdentity[]
  scenarioRevision: string
  scenarioSteps: readonly ScenarioStep[]
  requiredVariables: readonly string[]
}

function failure(
  reason: 'invalid-payload' | 'incomplete-plan' | 'assertion-change',
  message: string,
): PlanResult<never> {
  return { ok: false, reason, message }
}

function assertionBasis(
  payload: WebExecutionCachePayload,
  scenarioSteps: readonly ScenarioStep[],
) {
  return {
    scenarioSteps,
    checks: payload.steps.flatMap((step, stepIndex) =>
      step.instructions.flatMap((instruction, instructionIndex) =>
        'locator' in instruction && isEditable(instruction)
          ? []
          : [{ stepIndex, instructionIndex, instruction }],
      ),
    ),
  }
}

function isEditable(
  instruction: WebInstruction,
): instruction is Extract<WebInstruction, { locator: WebLocator }> {
  return (
    instruction.kind === 'click' ||
    instruction.kind === 'fill' ||
    instruction.kind === 'type' ||
    instruction.kind === 'hover' ||
    instruction.kind === 'select-option'
  )
}

function reconstructCandidate(
  baseline: WebExecutionCachePayload,
  candidate: WebExecutionCachePayload,
  steps: readonly StepIdentity[],
  requiredVariables: readonly string[],
): PlanResult<WebExecutionCachePayload> {
  let reconstructed = baseline
  for (const [stepIndex, baselineStep] of baseline.steps.entries()) {
    const candidateStep = candidate.steps[stepIndex]
    if (
      !candidateStep ||
      candidateStep.instructions.length !== baselineStep.instructions.length
    ) {
      return failure(
        'assertion-change',
        'The candidate must preserve every baseline instruction',
      )
    }
    for (const [
      instructionIndex,
      baselineInstruction,
    ] of baselineStep.instructions.entries()) {
      const candidateInstruction = candidateStep.instructions[instructionIndex]
      if (!candidateInstruction) {
        return failure(
          'assertion-change',
          'The candidate must preserve every baseline instruction',
        )
      }
      if (planDigest(baselineInstruction) === planDigest(candidateInstruction))
        continue
      if (
        !isEditable(baselineInstruction) ||
        !isEditable(candidateInstruction)
      ) {
        return failure(
          'assertion-change',
          'The candidate changes a protected instruction',
        )
      }
      if (baselineInstruction.kind !== candidateInstruction.kind) {
        return failure(
          'assertion-change',
          'The candidate changes instruction behavior',
        )
      }
      const step = steps[stepIndex]
      const currentInstruction =
        reconstructed.steps[stepIndex]?.instructions[instructionIndex]
      if (!step || !currentInstruction) {
        return failure(
          'invalid-payload',
          'The candidate has an unknown Scenario instruction',
        )
      }
      const replaced = replaceWebInteractionTarget(
        reconstructed,
        steps,
        requiredVariables,
        {
          step,
          instructionIndex,
          expectedInstructionDigest: planDigest(currentInstruction),
          locator: candidateInstruction.locator,
        },
      )
      if (!replaced.ok) return replaced
      reconstructed = replaced.value
    }
  }
  return planDigest(reconstructed) === planDigest(candidate)
    ? { ok: true, value: reconstructed }
    : failure(
        'assertion-change',
        'Only supported interaction locators may change',
      )
}

export function validateWebExecutionPlanCandidate(
  input: ValidateWebExecutionPlanCandidateInput,
): PlanResult<ValidatedWebExecutionPlan> {
  const baselineResult = webExecutionCachePayloadSchema.safeParse(
    input.baselinePayload,
  )
  const candidateResult = webExecutionCachePayloadSchema.safeParse(
    input.candidatePayload,
  )
  if (!baselineResult.success || !candidateResult.success) {
    return failure(
      'invalid-payload',
      'The web execution plan payload is invalid',
    )
  }
  const baseline = parseWebExecutionCachePayload(
    baselineResult.data,
    input.requiredVariables,
  )
  const candidate = parseWebExecutionCachePayload(
    candidateResult.data,
    input.requiredVariables,
  )
  if (!baseline || !candidate) {
    return failure(
      'invalid-payload',
      'The web execution plan references an unknown variable',
    )
  }
  if (
    webPrefixStepCount(candidate) !== input.scenarioSteps.length ||
    input.steps.length !== input.scenarioSteps.length ||
    input.steps.some(
      (step, index) =>
        step.index !== index ||
        step.scenarioRevision !== input.scenarioRevision,
    )
  ) {
    return failure(
      'incomplete-plan',
      'Validation requires a complete Scenario plan',
    )
  }
  try {
    projectWebExecutionPlan(baseline, input.scenarioSteps)
    projectWebExecutionPlan(candidate, input.scenarioSteps)
  } catch (error) {
    return failure(
      'invalid-payload',
      error instanceof Error
        ? error.message
        : 'The web execution plan is invalid',
    )
  }
  const reconstructed = reconstructCandidate(
    baseline,
    candidate,
    input.steps,
    input.requiredVariables,
  )
  if (!reconstructed.ok) return reconstructed
  return {
    ok: true,
    value: {
      baselinePayload: baseline,
      payload: reconstructed.value,
      assertionDigest: planDigest(
        assertionBasis(baseline, input.scenarioSteps),
      ),
    },
  }
}
