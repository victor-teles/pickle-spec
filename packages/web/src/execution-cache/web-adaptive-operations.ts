import type {
  ResolvedAction,
  StepExecution,
  StepExecutionContext,
} from '@pickle-spec/runner'
import type { WebAutomation } from '../adapter/automation/web-automation'
import type { WebAdapterOptions } from '../adapter/configuration/web-options'
import { captureWebAction } from '../evidence/web-action-evidence'
import type { WebAssertionDraft, WebInstruction } from './web-execution-cache'

export function definedInstructions(
  values: readonly (WebInstruction | undefined)[],
): values is WebInstruction[] {
  return values.every((value) => value !== undefined)
}

export async function compileAssertionDrafts(
  automation: WebAutomation,
  prompt: string,
  signal: AbortSignal | undefined,
): Promise<WebAssertionDraft[]> {
  try {
    const drafts = await automation.compileAssertion?.(prompt, signal)
    if (drafts === undefined) return []
    if ('kind' in drafts) return [drafts]
    return [...drafts]
  } catch {
    return []
  }
}

export function verificationExecution(
  prompt: string,
  meetsExpectation: boolean,
  actualState: string,
): StepExecution {
  const resolvedActions = [{ description: `Verify: ${prompt}` }]
  return meetsExpectation
    ? { state: 'passed', resolvedActions }
    : {
        state: 'failed',
        resolvedActions,
        message: `Expected: "${prompt}" | Actual: ${actualState}`,
      }
}

type ObservedActions = Awaited<ReturnType<WebAutomation['observe']>>

export async function observeOnce(
  automation: WebAutomation,
  prompt: string,
  signal: AbortSignal | undefined,
  onInference: () => void,
): Promise<ObservedActions> {
  const actions = await automation.observe(prompt, signal)
  onInference()
  return actions
}

export async function observeActions(
  automation: WebAutomation,
  prompt: string,
  signal: AbortSignal | undefined,
  onInference: () => void,
): Promise<ObservedActions> {
  const actions = await observeOnce(automation, prompt, signal, onInference)
  if (actions.length > 0) return actions
  return observeOnce(automation, prompt, signal, onInference)
}

export async function executeObservedActions(
  automation: WebAutomation,
  actions: ObservedActions,
  context: StepExecutionContext,
  options: WebAdapterOptions,
  signal: AbortSignal | undefined,
  onInference: () => void,
): Promise<StepExecution> {
  const resolvedActions: ResolvedAction[] = []
  for (const action of actions) {
    onInference()
    const captured = await captureWebAction({
      automation,
      context,
      description: action.description,
      options,
      perform: () => automation.act(action, signal),
      outcome: (outcome) => ({
        state: outcome.success ? 'passed' : 'failed',
        message: outcome.message,
      }),
    })
    const result = captured.result
    resolvedActions.push({
      description: action.description,
      evidence: captured.evidence,
    })
    if (!result.success) {
      return {
        state: 'failed',
        resolvedActions,
        message: result.message ?? 'Web action failed',
      }
    }
  }
  return actions.length > 0
    ? { state: 'passed', resolvedActions }
    : {
        state: 'failed',
        resolvedActions,
        message: 'Observe returned no actions',
      }
}
