import { z } from 'zod'
import type { ExecutionTargetAdapter } from '@pickle-spec/runner'
import type { WebAutomationFactory } from '@pickle-spec/web'

export interface SpecificationAuthoringInput {
  prompt: string
  currentSource?: string
}

export interface Extensions {
  adapter?: ExecutionTargetAdapter
  adapters?: Record<string, ExecutionTargetAdapter>
  webAutomationFactory?: WebAutomationFactory
  authorSpecification?: (
    input: SpecificationAuthoringInput,
  ) => Promise<{ source: string }>
}

const adapterSchema = z.custom<ExecutionTargetAdapter>(
  (value) => z.object({ openSession: z.function() }).safeParse(value).success,
  'Extension adapters must expose openSession(input)',
)
const webAutomationFactorySchema = z.custom<WebAutomationFactory>(
  (value) => z.object({ launch: z.function() }).safeParse(value).success,
  'webAutomationFactory must expose launch(input)',
)
const authorSpecificationSchema = z.custom<
  NonNullable<Extensions['authorSpecification']>
>(
  (value) => z.function().safeParse(value).success,
  'authorSpecification must be a function',
)
export const extensionsSchema = z.object({
  adapter: adapterSchema.optional(),
  adapters: z.record(z.string(), adapterSchema).optional(),
  webAutomationFactory: webAutomationFactorySchema.optional(),
  authorSpecification: authorSpecificationSchema.optional(),
})
