import type {
  OpenSessionInput,
  ResolvedAction,
  StepExecution,
  StepExecutionContext,
  StepTargetSession,
} from '@pickle-spec/runner'
import type { ScenarioStep } from '@pickle-spec/spec'
import {
  capturedActionFromError,
  captureWebAction,
} from '../evidence/web-action-evidence'
import {
  errorMessage,
  navigationTarget,
  navigationUrl,
  observeInstruction,
  promptFor,
} from '../execution-cache/web-step'
import { abortError, isAbortError } from './abort'
import type { WebAutomation } from './web-automation'
import type { WebAdapterOptions } from './web-options'

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

function stepExecutionContext(
  state: WebLiveSessionState,
  step: ScenarioStep,
  context: StepExecutionContext | undefined,
): StepExecutionContext {
  return (
    context ?? {
      stepIndex: 0,
      templateStep: step,
      runtimeBindings: state.input.runtimeBindings ?? [],
    }
  )
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
  context: StepExecutionContext,
  signal?: AbortSignal,
): Promise<ResolvedAction | undefined> {
  const sessionState = state
  if (sessionState.navigated) return
  const description = `Navigate to ${sessionState.options.baseUrl}`
  const captured = await captureWebAction({
    automation: sessionState.automation,
    context,
    description,
    options: sessionState.options,
    perform: () =>
      sessionState.automation.navigate(sessionState.options.baseUrl, signal),
    outcome: () => ({ state: 'passed' }),
  })
  sessionState.navigated = true
  return { description, evidence: captured.evidence }
}

async function resolveByObservation(
  state: WebLiveSessionState,
  prompt: string,
  context: StepExecutionContext,
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
    const captured = await captureWebAction({
      automation: state.automation,
      context,
      description: action.description,
      options: state.options,
      perform: () => state.automation.act(action, signal),
      outcome: (outcome) => ({
        state: outcome.success ? 'passed' : 'failed',
        message: outcome.message,
      }),
    })
    const result = captured.result
    resolvedActions.push({
      description: action.description,
      replay: replayPayload(action.handle),
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
  return { state: 'passed', resolvedActions }
}

async function executePrompt(
  state: WebLiveSessionState,
  step: ScenarioStep,
  prompt: string,
  context: StepExecutionContext,
  signal: AbortSignal | undefined,
): Promise<StepExecution> {
  const target = navigationTarget(prompt)
  if (target) {
    const sessionState = state
    const url = navigationUrl(sessionState.options.baseUrl, target)
    const captured = await captureWebAction({
      automation: sessionState.automation,
      context,
      description: `Navigate to ${url}`,
      options: sessionState.options,
      perform: () => sessionState.automation.navigate(url, signal),
      outcome: () => ({ state: 'passed' }),
    })
    sessionState.navigated = true
    return {
      state: 'passed',
      resolvedActions: [
        { description: `Navigate to ${url}`, evidence: captured.evidence },
      ],
    }
  }
  const navigation = await ensureNavigation(state, context, signal)
  if (step.type !== 'outcome') {
    const execution = await resolveByObservation(
      state,
      observeInstruction(step),
      context,
      signal,
    )
    return navigation
      ? {
          ...execution,
          resolvedActions: [navigation, ...execution.resolvedActions],
        }
      : execution
  }
  const description = `Verify: ${prompt}`
  const captured = await captureWebAction({
    automation: state.automation,
    context,
    description,
    options: state.options,
    perform: () => state.automation.verify(prompt, signal),
    outcome: (result) => ({
      state: result.meetsExpectation ? 'passed' : 'failed',
      message: result.meetsExpectation ? undefined : result.actualState,
    }),
  })
  const verification = captured.result
  const resolvedActions = [
    ...(navigation ? [navigation] : []),
    { description, evidence: captured.evidence },
  ]
  return verification.meetsExpectation
    ? { state: 'passed', resolvedActions }
    : {
        state: 'failed',
        resolvedActions,
        message: `Expected: "${prompt}" | Actual: ${verification.actualState}`,
      }
}

async function executeLiveStep(
  state: WebLiveSessionState,
  step: ScenarioStep,
  signal: AbortSignal | undefined,
  context: StepExecutionContext | undefined,
): Promise<StepExecution> {
  const operationSignal = signal ?? state.input.signal
  if (operationSignal?.aborted) throw abortError()
  try {
    const execution = await executePrompt(
      state,
      step,
      promptFor(step),
      stepExecutionContext(state, step, context),
      operationSignal,
    )
    return state.finish(execution, step)
  } catch (error) {
    if (isAbortError(error, operationSignal)) throw abortError()
    const capturedAction = capturedActionFromError(error)
    return state.finish(
      {
        state: 'infrastructure-error',
        resolvedActions: capturedAction ? [capturedAction] : [],
        message: errorMessage(error),
      },
      step,
    )
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
    executeStep: (step, signal, context) =>
      executeLiveStep(state, step, signal, context),
  }
}
