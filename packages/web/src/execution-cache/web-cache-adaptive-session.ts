import type {
  ExecutionCacheUncacheableReason,
  OpenSessionInput,
  ResolvedAction,
  StepExecution,
  StepExecutionContext,
} from '@pickle-spec/runner'
import type { ScenarioStep } from '@pickle-spec/spec'
import type { WebAutomation } from '../adapter/web-automation'
import type { WebAdapterOptions } from '../adapter/web-options'
import { resolvedInstructions } from './web-cache-instructions'
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

type WebInstructionRuntime = {
  executeSequence(
    instructions: readonly WebInstruction[],
    signal: AbortSignal | undefined,
  ): Promise<StepExecution>
  implicitNavigation(
    instructions: WebInstruction[],
    signal: AbortSignal | undefined,
    persist?: boolean,
  ): Promise<StepExecution | undefined>
  markNavigated(): void
}

interface CreateAdaptiveRuntimeInput {
  input: OpenSessionInput
  options: WebAdapterOptions
  automation: WebAutomation
  executor: WebInstructionRuntime
  compiledSteps: Array<WebExecutionCachePayload['steps'][number] | undefined>
  inference: { count: number }
  uncacheable: { reason?: ExecutionCacheUncacheableReason }
}

function definedInstructions(
  values: readonly (WebInstruction | undefined)[],
): values is WebInstruction[] {
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

export function createWebAdaptiveRuntime({
  input,
  options,
  automation,
  executor,
  compiledSteps,
  inference,
  uncacheable,
}: CreateAdaptiveRuntimeInput) {
  const runtimeBindings = input.runtimeBindings ?? []

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
    if (result.state === 'passed' && uncacheable.reason === undefined) {
      compiledSteps[index] = { instructions }
    }
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
    uncacheable.reason = 'bound-parameter-value'
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
    inference.count++
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
    uncacheable.reason = draft
      ? 'bound-parameter-value'
      : 'non-deterministic-assertion'
    inference.count++
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
      () => inference.count++,
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
    uncacheable.reason = 'non-deterministic-action'
    return executeObservedActions(
      automation,
      actions,
      signal,
      () => inference.count++,
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
  }
}
