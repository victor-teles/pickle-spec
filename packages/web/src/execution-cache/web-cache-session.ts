import type {
  ExecutionCacheUncacheableReason,
  OpenSessionInput,
  StepExecution,
  StepExecutionContext,
  StepTargetSession,
  TargetSessionCompletion,
} from '@pickle-spec/runner'
import type { ScenarioStep } from '@pickle-spec/spec'
import { abortError, isAbortError } from '../adapter/automation/abort'
import type { WebAutomation } from '../adapter/automation/web-automation'
import {
  defaultModelName,
  type WebAdapterOptions,
} from '../adapter/configuration/web-options'
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

class WebCacheTargetSession implements Omit<StepTargetSession, 'close'> {
  private readonly runtimeBindings
  private readonly requiredVariables
  private readonly cachedPayload
  private readonly compiledSteps: Array<
    WebExecutionCachePayload['steps'][number] | undefined
  >
  private readonly inference = { count: 0 }
  private readonly uncacheable: {
    reason?: ExecutionCacheUncacheableReason
  } = {}
  private readonly executor
  private readonly adaptive
  private fallbackStepIndex = 0

  constructor(private readonly context: CreateWebCacheSessionInput) {
    const { input, options, automation } = context
    this.runtimeBindings = input.runtimeBindings ?? []
    this.requiredVariables =
      input.scenarioTemplate?.variableNames ??
      input.scenario.template?.variableNames ??
      []
    this.cachedPayload = input.executionCache
      ? parseWebExecutionCachePayload(
          input.executionCache.adapterPayload,
          input.executionCache.requiredVariables,
        )
      : undefined
    this.compiledSteps = this.cachedPayload ? [...this.cachedPayload.steps] : []
    this.executor = createWebInstructionExecutor({
      automation,
      baseUrl: options.baseUrl,
      bindings: this.runtimeBindings,
      replay: false,
    })
    this.adaptive = createWebAdaptiveRuntime({
      input,
      options,
      automation,
      executor: this.executor,
      compiledSteps: this.compiledSteps,
      inference: this.inference,
      uncacheable: this.uncacheable,
    })
  }

  private executionContext(
    step: ScenarioStep,
    context?: StepExecutionContext,
  ): StepExecutionContext {
    const resolved = context ?? {
      stepIndex: this.fallbackStepIndex++,
      templateStep: step,
      runtimeBindings: this.runtimeBindings,
    }
    let evaluation = resolved.evaluation
    if (!evaluation) {
      evaluation =
        this.cachedPayload &&
        resolved.stepIndex < this.cachedPayload.steps.length
          ? 'replay'
          : 'adaptive'
    }
    return { ...resolved, evaluation }
  }

  private async executeReplayStep(
    step: ScenarioStep,
    context: StepExecutionContext,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    const cached = this.cachedPayload?.steps[context.stepIndex]
    if (!cached || !validInstructionsForStep(cached.instructions, step)) {
      return {
        state: 'failed',
        replayDiverged: true,
        resolvedActions: [],
        message: 'Replay diverged: cached web step is not applicable',
      }
    }
    this.executor.setOrigin('cached')
    if (cached.instructions[0]?.kind !== 'navigate') {
      const failed = await this.executor.implicitNavigation([], signal, false)
      if (failed) return failed
    }
    return this.executor.executeSequence(cached.instructions, signal)
  }

  private runStep(
    step: ScenarioStep,
    context: StepExecutionContext,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    if (context.evaluation !== 'adaptive') {
      return this.executeReplayStep(step, context, signal)
    }
    this.compiledSteps.length = Math.min(
      this.compiledSteps.length,
      context.stepIndex,
    )
    this.executor.setOrigin('resolved')
    return this.adaptive.executeStep(step, promptFor(step), context, signal)
  }

  async executeStep(
    step: ScenarioStep,
    signal?: AbortSignal,
    context?: StepExecutionContext,
  ): Promise<StepExecution> {
    const operationSignal = signal ?? this.context.input.signal
    if (operationSignal?.aborted) throw abortError()
    const resolved = this.executionContext(step, context)
    try {
      return this.context.finish(
        await this.runStep(step, resolved, operationSignal),
        step,
      )
    } catch (error) {
      if (isAbortError(error, operationSignal)) throw abortError()
      return this.context.finish(
        {
          state: 'infrastructure-error',
          resolvedActions: [],
          message: errorMessage(error),
        },
        step,
      )
    }
  }

  async complete(): Promise<TargetSessionCompletion> {
    const evaluationModel =
      this.context.options.browser?.modelName ?? defaultModelName
    const steps = sealWebCompiledSteps(this.compiledSteps)
    if (steps.length >= 1) {
      return {
        inferenceCount: this.inference.count,
        evaluationModel,
        replayRepresentation: {
          cacheable: true,
          requiredVariables: this.requiredVariables,
          adapterPayload: { schemaVersion: 1, steps },
        },
      }
    }
    return {
      inferenceCount: this.inference.count,
      evaluationModel,
      replayRepresentation: {
        cacheable: false,
        reason: this.uncacheable.reason ?? 'non-deterministic-action',
      },
    }
  }
}

export function createWebCacheSession({
  input,
  options,
  automation,
  finish,
}: CreateWebCacheSessionInput): Omit<StepTargetSession, 'close'> {
  return new WebCacheTargetSession({ input, options, automation, finish })
}
