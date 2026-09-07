import { createServerFn } from '@tanstack/react-start'
import '../../start-context'
import type {
  StudioExecutionPlanEditRequest,
  StudioExecutionPlanRequest,
  StudioWebLocator,
} from './execution-plan.contracts'

function executionPlanRequest(value: unknown): StudioExecutionPlanRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A Scenario and profile are required')
  }
  const input = value as Record<string, unknown>
  if (
    typeof input.scenarioId !== 'string' ||
    input.scenarioId.length === 0 ||
    typeof input.profileId !== 'string' ||
    input.profileId.length === 0 ||
    (input.applicationRevision !== undefined &&
      (typeof input.applicationRevision !== 'string' ||
        input.applicationRevision.length === 0))
  ) {
    throw new Error('A valid Scenario and profile are required')
  }
  return {
    scenarioId: input.scenarioId,
    profileId: input.profileId,
    applicationRevision: input.applicationRevision,
  }
}

function isDigest(value: unknown): value is string {
  return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
}

function parseLocator(value: unknown): StudioWebLocator {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A valid web locator is required')
  }
  const input = value as Record<string, unknown>
  const selector = input.selector
  if (!selector || typeof selector !== 'object' || Array.isArray(selector)) {
    throw new Error('A valid web locator is required')
  }
  const selectorInput = selector as Record<string, unknown>
  if (
    !Array.isArray(selectorInput.segments) ||
    selectorInput.segments.length < 1
  ) {
    throw new Error('A valid web locator is required')
  }
  const segments = selectorInput.segments.map((segment) => {
    if (!segment || typeof segment !== 'object' || Array.isArray(segment)) {
      throw new Error('A valid web locator is required')
    }
    const item = segment as Record<string, unknown>
    if (typeof item.literal === 'string' && Object.keys(item).length === 1) {
      return { literal: item.literal }
    }
    if (
      typeof item.variable === 'string' &&
      /^[A-Za-z_][A-Za-z0-9_.-]*$/.test(item.variable) &&
      Object.keys(item).length === 1
    ) {
      return { variable: item.variable }
    }
    throw new Error('A valid web locator is required')
  })
  if (
    input.nth !== undefined &&
    (!Number.isSafeInteger(input.nth) || (input.nth as number) < 0)
  ) {
    throw new Error('A valid web locator is required')
  }
  return {
    selector: { segments },
    ...(input.nth === undefined ? {} : { nth: input.nth as number }),
  }
}

function executionPlanEditRequest(
  value: unknown,
): StudioExecutionPlanEditRequest {
  const base = executionPlanRequest(value)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A valid execution plan edit is required')
  }
  const input = value as Record<string, unknown>
  const step = input.step
  const parentRevisionId = input.parentRevisionId
  const expectedInstructionDigest = input.expectedInstructionDigest
  if (
    !step ||
    typeof step !== 'object' ||
    Array.isArray(step) ||
    typeof (step as Record<string, unknown>).scenarioRevision !== 'string' ||
    !isDigest(parentRevisionId) ||
    !isDigest(expectedInstructionDigest) ||
    !Number.isSafeInteger(input.instructionIndex) ||
    (input.instructionIndex as number) < 0
  ) {
    throw new Error('A valid execution plan edit is required')
  }
  const stepInput = step as Record<string, unknown>
  const scenarioRevision = stepInput.scenarioRevision
  if (
    typeof scenarioRevision !== 'string' ||
    !Number.isSafeInteger(stepInput.index) ||
    (stepInput.index as number) < 0
  ) {
    throw new Error('A valid execution plan edit is required')
  }
  return {
    ...base,
    parentRevisionId,
    step: {
      scenarioRevision,
      index: stepInput.index as number,
    },
    instructionIndex: input.instructionIndex as number,
    expectedInstructionDigest,
    locator: parseLocator(input.locator),
  }
}

export const getExecutionPlan = createServerFn({ method: 'GET' })
  .inputValidator(executionPlanRequest)
  .handler(({ context, data }) => {
    if (!context.studio.executionPlans) {
      throw new Error('Readable execution plans are unavailable')
    }
    return context.studio.executionPlans.read(data)
  })

export const captureExecutionPlan = createServerFn({ method: 'POST' })
  .inputValidator(executionPlanRequest)
  .handler(({ context, data }) => {
    if (!context.studio.executionPlans) {
      throw new Error('Editable execution plans are unavailable')
    }
    return context.studio.executionPlans.captureDraft(data)
  })

export const editExecutionPlan = createServerFn({ method: 'POST' })
  .inputValidator(executionPlanEditRequest)
  .handler(({ context, data }) => {
    if (!context.studio.executionPlans) {
      throw new Error('Editable execution plans are unavailable')
    }
    return context.studio.executionPlans.edit(data)
  })
