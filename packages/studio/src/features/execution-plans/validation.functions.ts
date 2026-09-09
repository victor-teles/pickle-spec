import { createServerFn } from '@tanstack/react-start'
import '../../start-context'
import {
  planValidationInspectionSchema,
  planValidationReviewSchema,
  planValidationStatusSchema,
} from './validation.schemas'

export const inspectPlanValidation = createServerFn({ method: 'GET' })
  .inputValidator((value) => planValidationInspectionSchema.parse(value))
  .handler(({ context, data }) => {
    if (!context.studio.executionPlans?.validation)
      throw new Error('Candidate validation is unavailable')
    return context.studio.executionPlans.validation.inspect(data)
  })

export const reviewPlanValidation = createServerFn({ method: 'POST' })
  .inputValidator((value) => planValidationReviewSchema.parse(value))
  .handler(({ context, data }) => {
    if (!context.studio.executionPlans?.validation)
      throw new Error('Candidate validation is unavailable')
    return context.studio.executionPlans.validation.review(data)
  })

export const getPlanValidationStatus = createServerFn({ method: 'GET' })
  .inputValidator((value) => planValidationStatusSchema.parse(value))
  .handler(({ context, data }) => {
    if (!context.studio.executionPlans?.validation)
      throw new Error('Candidate validation is unavailable')
    return context.studio.executionPlans.validation.status(data)
  })
