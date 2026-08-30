import type { TestResultState } from '@pickle-spec/runner'

type ResultBadgeVariant = 'default' | 'failed' | 'passed'

export function resultBadgeVariant(state: TestResultState): ResultBadgeVariant {
  if (state === 'failed' || state === 'infrastructure-error') return 'failed'
  if (state === 'passed') return 'passed'
  return 'default'
}

export function reasonMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
