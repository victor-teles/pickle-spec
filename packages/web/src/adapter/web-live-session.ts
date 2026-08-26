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

function replayPayload(handle: unknown): Record<string, unknown> | undefined {
  if (!handle || typeof handle !== 'object') return undefined
  try {
    return JSON.parse(JSON.stringify(handle)) as Record<string, unknown>
  } catch {
    return undefined
  }
}

export function createWebLiveSession({
  input,
  options,
  automation,
  finish,
  initiallyNavigated,
}: CreateWebLiveSessionInput): Omit<StepTargetSession, 'close'> {
  let navigated = initiallyNavigated

  async function ensureNavigation(signal?: AbortSignal): Promise<void> {
    if (navigated) return
    await automation.navigate(options.baseUrl, signal)
    navigated = true
  }

  async function resolveByObservation(
    prompt: string,
    signal?: AbortSignal,
  ): Promise<StepExecution> {
    let actions = await automation.observe(prompt, signal)
    if (actions.length === 0) actions = await automation.observe(prompt, signal)
    if (actions.length === 0) {
      return {
        state: 'failed',
        resolvedActions: [],
        message: 'Observe returned no actions',
      }
    }

    const resolvedActions: ResolvedAction[] = []
    for (const action of actions) {
      const result = await automation.act(action, signal)
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

  return {
    async executeStep(step, signal) {
      const operationSignal = signal ?? input.signal
      if (operationSignal?.aborted) throw abortError()
      const prompt = promptFor(step)

      try {
        const target = navigationTarget(prompt)
        if (target) {
          const url = navigationUrl(options.baseUrl, target)
          await automation.navigate(url, operationSignal)
          navigated = true
          return finish(
            {
              state: 'passed',
              resolvedActions: [{ description: `Navigate to ${url}` }],
            },
            step,
          )
        }

        await ensureNavigation(operationSignal)
        if (step.type !== 'outcome') {
          return finish(
            await resolveByObservation(prompt, operationSignal),
            step,
          )
        }

        const verification = await automation.verify(prompt, operationSignal)
        const resolvedActions = [{ description: `Verify: ${prompt}` }]
        if (verification.meetsExpectation) {
          return finish({ state: 'passed', resolvedActions }, step)
        }
        return finish(
          {
            state: 'failed',
            resolvedActions,
            message: `Expected: "${prompt}" | Actual: ${verification.actualState}`,
          },
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
