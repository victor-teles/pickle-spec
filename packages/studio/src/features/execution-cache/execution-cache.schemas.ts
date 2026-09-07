import { executionCacheKeySchema } from '@pickle-spec/runner/schemas'
import { z } from 'zod'
import type { StudioExecutionCacheInspection } from './execution-cache.contracts'

export const executionCacheInspectionSchema: z.ZodType<StudioExecutionCacheInspection> =
  z.object({
    projectKey: z.string(),
    maxBytes: z.number(),
    entries: z.array(
      z.object({
        key: executionCacheKeySchema,
        createdAt: z.string(),
        lastUsedAt: z.string(),
        hitCount: z.number(),
        payloadDigest: z.string(),
        sizeBytes: z.number(),
        sourceRunId: z.string(),
        evaluationModel: z.string().optional(),
        evaluationInferenceCount: z.number(),
      }),
    ),
  })
export const executionCacheClearSchema = z.object({
  clearedEntries: z.number(),
})
