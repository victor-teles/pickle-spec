import type {
  OpenSessionInput,
  StepExecution,
  StepExecutionContext,
  StepTargetSession,
} from '@pickle-spec/runner'
import type { ScenarioStep } from '@pickle-spec/spec'
import { abortError, isAbortError } from '../adapter/abort'
import type { WebAutomation } from '../adapter/web-automation'
import type { WebAdapterOptions } from '../adapter/web-options'
import { createWebAdaptiveSession } from './web-cache-adaptive-session'
import { createWebReplaySession } from './web-cache-replay-session'
import { errorMessage, promptFor } from './web-step'

type FinishStep = (
  execution: StepExecution,
  step: ScenarioStep,
) => Promise<StepExecution>

interface CreateWebCacheSessionInput {
  input: OpenSessionInput
  options: WebAdapterOptions
  automation: WebAutomation
  finish: FinishStep
}

export function createWebCacheSession({
  input,
  options,
  automation,
  finish,
}: CreateWebCacheSessionInput): Omit<StepTargetSession, 'close'> {
  const runtime =
    (input.mode ?? 'adaptive') === 'replay'
      ? createWebReplaySession({ input, options, automation })
      : createWebAdaptiveSession({ input, options, automation })
  const runtimeBindings = input.runtimeBindings ?? []
  let fallbackStepIndex = 0

  function executionContext(
    step: ScenarioStep,
    context?: StepExecutionContext,
  ): StepExecutionContext {
    return (
      context ?? {
        stepIndex: fallbackStepIndex++,
        templateStep: step,
        runtimeBindings,
      }
    )
  }

  return {
    async executeStep(step, signal, context) {
      const operationSignal = signal ?? input.signal
      if (operationSignal?.aborted) throw abortError()
      try {
        const result = await runtime.executeStep(
          step,
          promptFor(step),
          executionContext(step, context),
          operationSignal,
        )
        return finish(result, step)
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
    complete: runtime.complete,
  }
}
