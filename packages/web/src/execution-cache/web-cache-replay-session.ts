import type {
  OpenSessionInput,
  StepExecution,
  StepExecutionContext,
  TargetSessionCompletion,
} from '@pickle-spec/runner'
import type { ScenarioStep } from '@pickle-spec/spec'
import type { WebAutomation } from '../adapter/web-automation'
import type { WebAdapterOptions } from '../adapter/web-options'
import {
  createWebInstructionExecutor,
  validInstructionsForStep,
} from './web-cache-instructions'
import { parseWebExecutionCachePayload } from './web-execution-cache'

interface CreateReplaySessionInput {
  input: OpenSessionInput
  options: WebAdapterOptions
  automation: WebAutomation
}

export function createWebReplaySession({
  input,
  options,
  automation,
}: CreateReplaySessionInput) {
  const runtimeBindings = input.runtimeBindings ?? []
  const cachedPayload = input.executionCache
    ? parseWebExecutionCachePayload(
        input.executionCache.adapterPayload,
        input.executionCache.requiredVariables,
      )
    : undefined
  const executor = createWebInstructionExecutor({
    automation,
    baseUrl: options.baseUrl,
    bindings: runtimeBindings,
    replay: true,
  })

  return {
    async executeStep(
      step: ScenarioStep,
      _prompt: string,
      context: StepExecutionContext,
      signal: AbortSignal | undefined,
    ): Promise<StepExecution> {
      const cached = cachedPayload?.steps[context.stepIndex]
      if (
        !cached ||
        cachedPayload?.steps.length !== input.scenario.steps.length ||
        !validInstructionsForStep(cached.instructions, step)
      ) {
        return {
          state: 'failed',
          replayDiverged: true,
          resolvedActions: [],
          message: 'Replay diverged: cached web step is not applicable',
        }
      }
      if (cached.instructions[0]?.kind !== 'navigate') {
        const failed = await executor.implicitNavigation([], signal, false)
        if (failed) return failed
      }
      return executor.executeSequence(cached.instructions, signal)
    },
    async complete(): Promise<TargetSessionCompletion> {
      return { inferenceCount: 0 }
    },
  }
}
