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
  compileObservedOutcomes,
  compileObservedWebAction,
  compileWebAssertion,
  compileWebNavigation,
  instructionCoversStepVariables,
  parseObservedActionPayload,
  stepVariableNames,
  type WebAssertionDraft,
  type WebExecutionCachePayload,
  type WebInstruction,
} from './web-execution-cache'
import {
  navigationTarget,
  navigationUrl,
  observeInstruction,
  promptFor,
} from './web-step'

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

async function compileAssertionDrafts(
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

async function observeOnce(
  automation: WebAutomation,
  prompt: string,
  signal: AbortSignal | undefined,
  onInference: () => void,
): Promise<ObservedActions> {
  const actions = await automation.observe(prompt, signal)
  onInference()
  return actions
}

async function observeActions(
  automation: WebAutomation,
  prompt: string,
  signal: AbortSignal | undefined,
  onInference: () => void,
): Promise<ObservedActions> {
  const actions = await observeOnce(automation, prompt, signal, onInference)
  if (actions.length > 0) return actions
  return observeOnce(automation, prompt, signal, onInference)
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

  function usableInstructions(
    compiled: WebInstruction[] | undefined,
    templateStep: ScenarioStep,
  ): WebInstruction[] | undefined {
    if (!compiled || compiled.length === 0) return undefined
    return instructionCoversStepVariables(compiled, templateStep)
      ? compiled
      : undefined
  }

  async function compileObservedOutcomeInstructions(
    step: ScenarioStep,
    prompt: string,
    templateStep: ScenarioStep,
    signal: AbortSignal | undefined,
  ): Promise<WebInstruction[] | undefined> {
    if (stepVariableNames(templateStep).length > 0) return undefined
    const actions = await observeOnce(
      automation,
      observeInstruction(step),
      signal,
      () => inference.count++,
    )
    return usableInstructions(
      compileObservedOutcomes(actions, prompt, runtimeBindings),
      templateStep,
    )
  }

  async function compileExtractedOutcomeInstructions(
    prompt: string,
    templateStep: ScenarioStep,
    signal: AbortSignal | undefined,
  ): Promise<WebInstruction[] | undefined> {
    inference.count++
    const drafts = await compileAssertionDrafts(automation, prompt, signal)
    const compiled = drafts.map((draft) =>
      compileWebAssertion(draft, runtimeBindings),
    )
    const usable = definedInstructions(compiled)
      ? usableInstructions(compiled, templateStep)
      : undefined
    if (usable) return usable
    if (drafts.length > 0) uncacheable.reason = 'bound-parameter-value'
    return undefined
  }

  async function adaptiveOutcome(
    step: ScenarioStep,
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
    const compiled =
      (await compileObservedOutcomeInstructions(
        step,
        prompt,
        templateStep,
        signal,
      )) ??
      (await compileExtractedOutcomeInstructions(prompt, templateStep, signal))
    if (compiled) {
      instructions.push(...compiled)
      return executeCompiledStep(instructions, compiled, index, signal)
    }
    if (uncacheable.reason === undefined) {
      uncacheable.reason = 'non-deterministic-assertion'
    }
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
            step,
            prompt,
            context.templateStep,
            context.stepIndex,
            signal,
          )
        : adaptiveAction(
            observeInstruction(step),
            context.templateStep,
            context.stepIndex,
            signal,
          )
    },
  }
}
