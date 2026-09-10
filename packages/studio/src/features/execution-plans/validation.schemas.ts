import { z } from 'zod'

const digestSchema = z.string().regex(/^[0-9a-f]{64}$/)
export const planValidationInspectionSchema = z.strictObject({
  revisionId: digestSchema,
})
export const planValidationReviewSchema = planValidationInspectionSchema.extend(
  {
    rationale: z.string().trim().min(1),
    evidenceRunIds: z.array(z.string().min(1)),
  },
)
export const planValidationStatusSchema = planValidationInspectionSchema.extend(
  { reviewId: digestSchema },
)
export const planValidationRequestSchema = planValidationStatusSchema.extend({
  resetConfirmed: z.literal(true),
})
