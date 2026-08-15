import type { ExecutionTargetAdapter } from '@pickle-spec/runner'
import type { WebAutomationFactory } from '@pickle-spec/web'

export interface Extensions {
  adapter?: ExecutionTargetAdapter
  adapters?: Record<string, ExecutionTargetAdapter>
  webAutomationFactory?: WebAutomationFactory
}
