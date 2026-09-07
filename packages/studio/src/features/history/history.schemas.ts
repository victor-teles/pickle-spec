import type { TestRunComparison } from '@pickle-spec/runner'
import { testResultSchema } from '@pickle-spec/runner/schemas'
import { z } from 'zod'

export const historyComparisonRequestSchema = z.object({
  baselineRunId: z.string().optional(),
  candidateRunId: z.string().optional(),
})
const resultIdentity = {
  scenarioId: z.string(),
  executionTargetProfileId: z.string(),
}
const comparedSideSchema = z.object({
  ...resultIdentity,
  result: testResultSchema,
})
export const testRunComparisonSchema: z.ZodType<TestRunComparison> = z.object({
  schemaVersion: z.literal(1),
  baselineRunId: z.string(),
  candidateRunId: z.string(),
  pairs: z.array(
    z.object({
      ...resultIdentity,
      baseline: testResultSchema,
      candidate: testResultSchema,
      changes: z.array(
        z.enum([
          'state',
          'duration',
          'flaky',
          'execution-mode',
          'cache-outcome',
          'inference-count',
          'resolved-actions',
          'artifacts',
        ]),
      ),
    }),
  ),
  removed: z.array(comparedSideSchema),
  added: z.array(comparedSideSchema),
})
export const historyPinSchema = z.object({
  runId: z.string(),
  pinned: z.boolean(),
})
export const historyDeletionSchema = z.object({ removed: z.array(z.string()) })
