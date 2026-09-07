import { createServerFn } from '@tanstack/react-start'
import '../../start-context'
import { z } from 'zod'

const variableNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/)
const digestSchema = z.string().regex(/^[0-9a-f]{64}$/)
const locatorSegmentSchema = z.union([
  z.strictObject({ literal: z.string() }),
  z.strictObject({ variable: variableNameSchema }),
])
const locatorSchema = z.object({
  selector: z.object({ segments: z.array(locatorSegmentSchema).min(1) }),
  nth: z.number().int().nonnegative().optional(),
})
const executionPlanRequestSchema = z.object({
  scenarioId: z.string().min(1),
  profileId: z.string().min(1),
  applicationRevision: z.string().min(1).optional(),
})
const executionPlanEditRequestSchema = executionPlanRequestSchema.extend({
  parentRevisionId: digestSchema,
  step: z.object({
    scenarioRevision: z.string().min(1),
    index: z.number().int().nonnegative(),
  }),
  instructionIndex: z.number().int().nonnegative(),
  expectedInstructionDigest: digestSchema,
  locator: locatorSchema,
})

export const getExecutionPlan = createServerFn({ method: 'GET' })
  .inputValidator((value) => executionPlanRequestSchema.parse(value))
  .handler(({ context, data }) => {
    if (!context.studio.executionPlans) {
      throw new Error('Readable execution plans are unavailable')
    }
    return context.studio.executionPlans.read(data)
  })

export const captureExecutionPlan = createServerFn({ method: 'POST' })
  .inputValidator((value) => executionPlanRequestSchema.parse(value))
  .handler(({ context, data }) => {
    if (!context.studio.executionPlans) {
      throw new Error('Editable execution plans are unavailable')
    }
    return context.studio.executionPlans.captureDraft(data)
  })

export const editExecutionPlan = createServerFn({ method: 'POST' })
  .inputValidator((value) => executionPlanEditRequestSchema.parse(value))
  .handler(({ context, data }) => {
    if (!context.studio.executionPlans) {
      throw new Error('Editable execution plans are unavailable')
    }
    return context.studio.executionPlans.edit(data)
  })
