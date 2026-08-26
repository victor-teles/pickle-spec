import type {
  ExecutionCacheUncacheableReason,
  OpenSessionInput,
  ResolvedAction,
  StepExecution,
  StepExecutionContext,
  TargetSessionCompletion,
} from '@pickle-spec/runner'
import type { ScenarioStep } from '@pickle-spec/spec'
import type { WebAutomation } from '../adapter/web-automation'
import {
  defaultModelName,
  type WebAdapterOptions,
} from '../adapter/web-options'
import {
  createWebInstructionExecutor,
  resolvedInstructions,
} from './web-cache-instructions'
import {
  compileObservedWebAction,
  compileWebAssertion,
  compileWebNavigation,
  instructionCoversStepVariables,
  parseObservedActionPayload,
  type WebAssertionDraft,
  type WebExecutionCachePayload,
  type WebInstruction,
} from './web-execution-cache'
import { navigationTarget, navigationUrl, promptFor } from './web-step'

interface CreateAdaptiveSessionInput {
  input: OpenSessionInput
  options: WebAdapterOptions
  automation: WebAutomation
}

function definedInstructions(
  values: readonly (WebInstruction | undefined)[],
): values is WebInstruction[] {
  return values.every((value) => value !== undefined)
}

function definedSteps(
  values: readonly (WebExecutionCachePayload['steps'][number] | undefined)[],
): values is WebExecutionCachePayload['steps'] {
  return values.every((value) => value !== undefined)
}

async function compileAssertionDraft(
  automation: WebAutomation,
  prompt: string,
  signal: AbortSignal | undefined,
): Promise<WebAssertionDraft | undefined> {
  try {
    return await automation.compileAssertion?.(prompt, signal)
  } catch {
    return undefined
  }
}

function verificationExecution(
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

async function observeActions(
  automation: WebAutomation,
  prompt: string,
  signal: AbortSignal | undefined,
  onInference: () => void,
): Promise<ObservedActions> {
  let actions = await automation.observe(prompt, signal)
  onInference()
  if (actions.length > 0) return actions
  actions = await automation.observe(prompt, signal)
  onInference()
  return actions
}

async function executeObservedActions(
  automation: WebAutomation,
  actions: ObservedActions,
  signal: AbortSignal | undefined,
  onInference: () => void,
): Promise<StepExecution> {
  const resolvedActions: ResolvedAction[] = []
  for (const action of actions) {
    onInference()
    const result = await automation.act(action, signal)
    resolvedActions.push({ description: action.description })
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

export function createWebAdaptiveSession({
  input,
  options,
  automation,
}: CreateAdaptiveSessionInput) {
  const runtimeBindings = input.runtimeBindings ?? []
  const requiredVariables =
    input.scenarioTemplate?.variableNames ??
    input.scenario.template?.variableNames ??
    []
  const executor = createWebInstructionExecutor({
    automation,
    baseUrl: options.baseUrl,
    bindings: runtimeBindings,
    replay: false,
  })
  const compiledSteps: Array<
    WebExecutionCachePayload['steps'][number] | undefined
  > = []
  let uncacheableReason: ExecutionCacheUncacheableReason | undefined
  let inferenceCount = 0

  async function executeCompiledStep(
    instructions: WebInstruction[],
    executableInstructions: readonly WebInstruction[],
    index: number,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    const result = await executor.executeSequence(
      executableInstructions,
      signal,
    )
    if (result.state === 'passed') compiledSteps[index] = { instructions }
    return {
      ...result,
      resolvedActions: resolvedInstructions(instructions, 'resolved'),
    }
  }

  async function adaptiveNavigation(
    templateStep: ScenarioStep,
    target: string,
    index: number,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    const url = navigationUrl(options.baseUrl, target)
    const templateTarget = navigationTarget(promptFor(templateStep))
    const instruction = templateTarget
      ? compileWebNavigation(
          options.baseUrl,
          target,
          templateTarget,
          runtimeBindings,
        )
      : undefined
    if (
      instruction &&
      instructionCoversStepVariables([instruction], templateStep)
    ) {
      return executeCompiledStep([instruction], [instruction], index, signal)
    }
    uncacheableReason = 'bound-parameter-value'
    await automation.navigate(url, signal)
    executor.markNavigated()
    return {
      state: 'passed',
      resolvedActions: [{ description: `Navigate to ${url}` }],
    }
  }

  async function adaptiveOutcome(
    prompt: string,
    templateStep: ScenarioStep,
    index: number,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    const instructions: WebInstruction[] = []
    const navigationFailure = await executor.implicitNavigation(
      instructions,
      signal,
    )
    if (navigationFailure) return navigationFailure
    inferenceCount++
    const draft = await compileAssertionDraft(automation, prompt, signal)
    const assertion = draft
      ? compileWebAssertion(draft, runtimeBindings)
      : undefined
    if (
      assertion &&
      instructionCoversStepVariables([assertion], templateStep)
    ) {
      instructions.push(assertion)
      return executeCompiledStep(instructions, [assertion], index, signal)
    }
    uncacheableReason = draft
      ? 'bound-parameter-value'
      : 'non-deterministic-assertion'
    inferenceCount++
    const verification = await automation.verify(prompt, signal)
    return verificationExecution(
      prompt,
      verification.meetsExpectation,
      verification.actualState,
    )
  }

  async function adaptiveAction(
    prompt: string,
    templateStep: ScenarioStep,
    index: number,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    const instructions: WebInstruction[] = []
    const navigationFailure = await executor.implicitNavigation(
      instructions,
      signal,
    )
    if (navigationFailure) return navigationFailure
    const actions = await observeActions(
      automation,
      prompt,
      signal,
      () => inferenceCount++,
    )
    const compiled = actions.map((action) => {
      const payload = parseObservedActionPayload(action.handle)
      return payload
        ? compileObservedWebAction(payload, runtimeBindings)
        : undefined
    })
    if (
      actions.length > 0 &&
      definedInstructions(compiled) &&
      instructionCoversStepVariables(compiled, templateStep)
    ) {
      instructions.push(...compiled)
      return executeCompiledStep(instructions, compiled, index, signal)
    }
    uncacheableReason = 'non-deterministic-action'
    return executeObservedActions(
      automation,
      actions,
      signal,
      () => inferenceCount++,
    )
  }

  return {
    executeStep(
      step: ScenarioStep,
      prompt: string,
      context: StepExecutionContext,
      signal: AbortSignal | undefined,
    ): Promise<StepExecution> {
      const target = navigationTarget(prompt)
      if (target) {
        return adaptiveNavigation(
          context.templateStep,
          target,
          context.stepIndex,
          signal,
        )
      }
      return step.type === 'outcome'
        ? adaptiveOutcome(
            prompt,
            context.templateStep,
            context.stepIndex,
            signal,
          )
        : adaptiveAction(
            prompt,
            context.templateStep,
            context.stepIndex,
            signal,
          )
    },
    async complete(): Promise<TargetSessionCompletion> {
      const evaluationModel = options.browser?.modelName ?? defaultModelName
      if (uncacheableReason) {
        return {
          inferenceCount,
          evaluationModel,
          replayRepresentation: { cacheable: false, reason: uncacheableReason },
        }
      }
      if (
        compiledSteps.length !== input.scenario.steps.length ||
        !definedSteps(compiledSteps)
      ) {
        return {
          inferenceCount,
          evaluationModel,
          replayRepresentation: {
            cacheable: false,
            reason: 'non-deterministic-action',
          },
        }
      }
      return {
        inferenceCount,
        evaluationModel,
        replayRepresentation: {
          cacheable: true,
          requiredVariables,
          adapterPayload: {
            schemaVersion: 1,
            steps: compiledSteps,
          },
        },
      }
    },
  }
}
