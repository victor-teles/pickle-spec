import { z } from 'zod'
import type { ExecutionCachePayloadValidator } from '@pickle-spec/runner'

const payloadSchema = z.object({
  operation: z.literal('fill'),
  value: z.object({ variable: z.string() }),
})
export type FillCachePayload = z.infer<typeof payloadSchema>
export const fillCachePayloadValidator: ExecutionCachePayloadValidator<FillCachePayload> =
  {
    adapterKind: 'test',
    adapterCacheSchemaVersion: 'test.1',
    parse(payload) {
      return payloadSchema.parse(payload)
    },
    prefixStepCount() {
      return 1
    },
  }
