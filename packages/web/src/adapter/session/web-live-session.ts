import type {
  OpenSessionInput,
  ResolvedAction,
  StepExecution,
  StepTargetSession,
} from '@pickle-spec/runner'
import type { ScenarioStep } from '@pickle-spec/spec'
import {
  errorMessage,
  navigationTarget,
  navigationUrl,
  observeInstruction,
  promptFor,
} from '../../execution-cache/web-step'
import { abortError, isAbortError } from '../automation/abort'
import type { WebAutomation } from '../automation/web-automation'
import type { WebAdapterOptions } from '../configuration/web-options'

type FinishStep = (
  execution: StepExecution,
  step: ScenarioStep,
) => Promise<StepExecution>

interface CreateWebLiveSessionInput {
  input: OpenSessionInput
  options: WebAdapterOptions
  automation: WebAutomation
  finish: FinishStep
  initiallyNavigated: boolean
}

interface WebLiveSessionState extends CreateWebLiveSessionInput {
  navigated: boolean
}

function replayPayload(handle: unknown): Record<string, unknown> | undefined {
  if (!handle || typeof handle !== 'object') return undefined
  try {
    return JSON.parse(JSON.stringify(handle)) as Record<string, unknown>
  } catch {
    return undefined
  }
}

async function ensureNavigation(
  state: WebLiveSessionState,
  signal?: AbortSignal,
): Promise<void> {
  const sessionState = state
  if (sessionState.navigated) return
  await sessionState.automation.navigate(sessionState.options.baseUrl, signal)
  sessionState.navigated = true
}

async function resolveByObservation(
  state: WebLiveSessionState,
  prompt: string,
  signal?: AbortSignal,
): Promise<StepExecution> {
  let actions = await state.automation.observe(prompt, signal)
  if (actions.length === 0)
    actions = await state.automation.observe(prompt, signal)
  if (actions.length === 0) {
    return {
      state: 'failed',
      resolvedActions: [],
      message: 'Observe returned no actions',
    }
  }
  const resolvedActions: ResolvedAction[] = []
  for (const action of actions) {
    const result = await state.automation.act(action, signal)
    resolvedActions.push({
      description: action.description,
      replay: replayPayload(action.handle),
    })
    if (!result.success) {
      return {
        state: 'failed',
        resolvedActions,
        message: result.message ?? 'Web action failed',
      }
    }
  }
  return { state: 'passed', resolvedActions }
}

async function executePrompt(
  state: WebLiveSessionState,
  step: ScenarioStep,
  prompt: string,
  signal: AbortSignal | undefined,
): Promise<StepExecution> {
  const target = navigationTarget(prompt)
  if (target) {
    const sessionState = state
    const url = navigationUrl(sessionState.options.baseUrl, target)
    await sessionState.automation.navigate(url, signal)
    sessionState.navigated = true
    return {
      state: 'passed',
      resolvedActions: [{ description: `Navigate to ${url}` }],
    }
  }
  await ensureNavigation(state, signal)
  if (step.type !== 'outcome') {
    return resolveByObservation(state, observeInstruction(step), signal)
  }
  const verification = await state.automation.verify(prompt, signal)
  const resolvedActions = [{ description: `Verify: ${prompt}` }]
  return verification.meetsExpectation
    ? { state: 'passed', resolvedActions }
    : {
        state: 'failed',
        resolvedActions,
        message: `Expected: "${prompt}" | Actual: ${verification.actualState}`,
      }
}

export function createWebLiveSession({
  input,
  options,
  automation,
  finish,
  initiallyNavigated,
}: CreateWebLiveSessionInput): Omit<StepTargetSession, 'close'> {
  const state: WebLiveSessionState = {
    input,
    options,
    automation,
    finish,
    initiallyNavigated,
    navigated: initiallyNavigated,
  }

  return {
    async executeStep(step, signal) {
      const operationSignal = signal ?? input.signal
      if (operationSignal?.aborted) throw abortError()
      const prompt = promptFor(step)

      try {
        return finish(
          await executePrompt(state, step, prompt, operationSignal),
          step,
        )
      } catch (error) {
        if (isAbortError(error, operationSignal)) throw abortError()
        return finish(
          {
            state: 'infrastructure-error',
            resolvedActions: [],
            message: errorMessage(error),
          },
          step,
        )
      }
    },
  }
}
