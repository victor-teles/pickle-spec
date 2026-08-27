import type {
  ExecutionCacheUncacheableReason,
  OpenSessionInput,
  StepExecution,
  StepExecutionContext,
  StepTargetSession,
  TargetSessionCompletion,
} from '@pickle-spec/runner'
import type { ScenarioStep } from '@pickle-spec/spec'
import { abortError, isAbortError } from '../adapter/abort'
import type { WebAutomation } from '../adapter/web-automation'
import {
  defaultModelName,
  type WebAdapterOptions,
} from '../adapter/web-options'
import { createWebAdaptiveRuntime } from './web-cache-adaptive-session'
import {
  createWebInstructionExecutor,
  validInstructionsForStep,
} from './web-cache-instructions'
import {
  parseWebExecutionCachePayload,
  sealWebCompiledSteps,
  type WebExecutionCachePayload,
} from './web-execution-cache'
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
  const runtimeBindings = input.runtimeBindings ?? []
  const requiredVariables =
    input.scenarioTemplate?.variableNames ??
    input.scenario.template?.variableNames ??
    []
  const cachedPayload = input.executionCache
    ? parseWebExecutionCachePayload(
        input.executionCache.adapterPayload,
        input.executionCache.requiredVariables,
      )
    : undefined
  const compiledSteps: Array<
    WebExecutionCachePayload['steps'][number] | undefined
  > = cachedPayload ? [...cachedPayload.steps] : []
  const inference = { count: 0 }
  const uncacheable: { reason?: ExecutionCacheUncacheableReason } = {}
  const executor = createWebInstructionExecutor({
    automation,
    baseUrl: options.baseUrl,
    bindings: runtimeBindings,
    replay: false,
  })
  const adaptive = createWebAdaptiveRuntime({
    input,
    options,
    automation,
    executor,
    compiledSteps,
    inference,
    uncacheable,
  })
  let fallbackStepIndex = 0

  function executionContext(
    step: ScenarioStep,
    context?: StepExecutionContext,
  ): StepExecutionContext {
    const resolved = context ?? {
      stepIndex: fallbackStepIndex++,
      templateStep: step,
      runtimeBindings,
    }
    return {
      ...resolved,
      evaluation:
        resolved.evaluation ??
        (cachedPayload && resolved.stepIndex < cachedPayload.steps.length
          ? 'replay'
          : 'adaptive'),
    }
  }

  async function executeReplayStep(
    step: ScenarioStep,
    context: StepExecutionContext,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    const cached = cachedPayload?.steps[context.stepIndex]
    if (!cached || !validInstructionsForStep(cached.instructions, step)) {
      return {
        state: 'failed',
        replayDiverged: true,
        resolvedActions: [],
        message: 'Replay diverged: cached web step is not applicable',
      }
    }
    executor.setOrigin('cached')
    if (cached.instructions[0]?.kind !== 'navigate') {
      const failed = await executor.implicitNavigation([], signal, false)
      if (failed) return failed
    }
    return executor.executeSequence(cached.instructions, signal)
  }

  async function runStep(
    step: ScenarioStep,
    context: StepExecutionContext,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    if (context.evaluation === 'adaptive') {
      compiledSteps.length = Math.min(compiledSteps.length, context.stepIndex)
      executor.setOrigin('resolved')
      return adaptive.executeStep(step, promptFor(step), context, signal)
    }
    return executeReplayStep(step, context, signal)
  }

  return {
    async executeStep(step, signal, context) {
      const operationSignal = signal ?? input.signal
      if (operationSignal?.aborted) throw abortError()
      const resolved = executionContext(step, context)
      try {
        return finish(await runStep(step, resolved, operationSignal), step)
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
    async complete(): Promise<TargetSessionCompletion> {
      const evaluationModel = options.browser?.modelName ?? defaultModelName
      const steps = sealWebCompiledSteps(compiledSteps)
      if (steps.length >= 1) {
        return {
          inferenceCount: inference.count,
          evaluationModel,
          replayRepresentation: {
            cacheable: true,
            requiredVariables,
            adapterPayload: {
              schemaVersion: 1,
              steps,
            },
          },
        }
      }
      return {
        inferenceCount: inference.count,
        evaluationModel,
        replayRepresentation: {
          cacheable: false,
          reason: uncacheable.reason ?? 'non-deterministic-action',
        },
      }
    },
  }
}
