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
