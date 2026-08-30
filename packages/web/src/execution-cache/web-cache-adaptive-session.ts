import type {
  ExecutionCacheUncacheableReason,
  OpenSessionInput,
  StepExecution,
  StepExecutionContext,
} from '@pickle-spec/runner'
import type { ScenarioStep } from '@pickle-spec/spec'
import type { WebAutomation } from '../adapter/automation/web-automation'
import type { WebAdapterOptions } from '../adapter/configuration/web-options'
import {
  compileAssertionDrafts,
  definedInstructions,
  executeObservedActions,
  observeActions,
  observeOnce,
  verificationExecution,
} from './web-adaptive-operations'
import { resolvedInstructions } from './web-cache-instructions'
import {
  compileObservedOutcomes,
  compileObservedWebAction,
  compileWebAssertion,
  compileWebNavigation,
  instructionCoversStepVariables,
  parseObservedActionPayload,
  stepVariableNames,
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

interface WebAdaptiveRuntime {
  executeStep(
    step: ScenarioStep,
    prompt: string,
    context: StepExecutionContext,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution>
}

class AdaptiveWebRuntime implements WebAdaptiveRuntime {
  private readonly runtimeBindings

  constructor(private readonly context: CreateAdaptiveRuntimeInput) {
    this.runtimeBindings = context.input.runtimeBindings ?? []
  }

  private async executeCompiledStep(
    instructions: WebInstruction[],
    executableInstructions: readonly WebInstruction[],
    index: number,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    const result = await this.context.executor.executeSequence(
      executableInstructions,
      signal,
    )
    if (
      result.state === 'passed' &&
      this.context.uncacheable.reason === undefined
    ) {
      this.context.compiledSteps[index] = { instructions }
    }
    return {
      ...result,
      resolvedActions: resolvedInstructions(instructions, 'resolved'),
    }
  }

  private async adaptiveNavigation(
    templateStep: ScenarioStep,
    target: string,
    index: number,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    const url = navigationUrl(this.context.options.baseUrl, target)
    const templateTarget = navigationTarget(promptFor(templateStep))
    const instruction = templateTarget
      ? compileWebNavigation(
          this.context.options.baseUrl,
          target,
          templateTarget,
          this.runtimeBindings,
        )
      : undefined
    if (
      instruction &&
      instructionCoversStepVariables([instruction], templateStep)
    ) {
      return this.executeCompiledStep(
        [instruction],
        [instruction],
        index,
        signal,
      )
    }
    this.context.uncacheable.reason = 'bound-parameter-value'
    await this.context.automation.navigate(url, signal)
    this.context.executor.markNavigated()
    return {
      state: 'passed',
      resolvedActions: [{ description: `Navigate to ${url}` }],
    }
  }

  private usableInstructions(
    compiled: WebInstruction[] | undefined,
    templateStep: ScenarioStep,
  ): WebInstruction[] | undefined {
    if (!compiled || compiled.length === 0) return undefined
    return instructionCoversStepVariables(compiled, templateStep)
      ? compiled
      : undefined
  }

  private async compileObservedOutcomeInstructions(
    step: ScenarioStep,
    prompt: string,
    templateStep: ScenarioStep,
    signal: AbortSignal | undefined,
  ): Promise<WebInstruction[] | undefined> {
    if (stepVariableNames(templateStep).length > 0) return undefined
    const actions = await observeOnce(
      this.context.automation,
      observeInstruction(step),
      signal,
      () => this.context.inference.count++,
    )
    return this.usableInstructions(
      compileObservedOutcomes(actions, prompt, this.runtimeBindings),
      templateStep,
    )
  }

  private async compileExtractedOutcomeInstructions(
    prompt: string,
    templateStep: ScenarioStep,
    signal: AbortSignal | undefined,
  ): Promise<WebInstruction[] | undefined> {
    this.context.inference.count++
    const drafts = await compileAssertionDrafts(
      this.context.automation,
      prompt,
      signal,
    )
    const compiled = drafts.map((draft) =>
      compileWebAssertion(draft, this.runtimeBindings),
    )
    const usable = definedInstructions(compiled)
      ? this.usableInstructions(compiled, templateStep)
      : undefined
    if (usable) return usable
    if (drafts.length > 0)
      this.context.uncacheable.reason = 'bound-parameter-value'
    return undefined
  }

  private async adaptiveOutcome(
    step: ScenarioStep,
    prompt: string,
    templateStep: ScenarioStep,
    index: number,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    const instructions: WebInstruction[] = []
    const navigationFailure = await this.context.executor.implicitNavigation(
      instructions,
      signal,
    )
    if (navigationFailure) return navigationFailure
    const compiled =
      (await this.compileObservedOutcomeInstructions(
        step,
        prompt,
        templateStep,
        signal,
      )) ??
      (await this.compileExtractedOutcomeInstructions(
        prompt,
        templateStep,
        signal,
      ))
    if (compiled) {
      instructions.push(...compiled)
      return this.executeCompiledStep(instructions, compiled, index, signal)
    }
    if (this.context.uncacheable.reason === undefined) {
      this.context.uncacheable.reason = 'non-deterministic-assertion'
    }
    this.context.inference.count++
    const verification = await this.context.automation.verify(prompt, signal)
    return verificationExecution(
      prompt,
      verification.meetsExpectation,
      verification.actualState,
    )
  }

  private async adaptiveAction(
    prompt: string,
    templateStep: ScenarioStep,
    index: number,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    const instructions: WebInstruction[] = []
    const navigationFailure = await this.context.executor.implicitNavigation(
      instructions,
      signal,
    )
    if (navigationFailure) return navigationFailure
    const actions = await observeActions(
      this.context.automation,
      prompt,
      signal,
      () => this.context.inference.count++,
    )
    const compiled = actions.map((action) => {
      const payload = parseObservedActionPayload(action.handle)
      return payload
        ? compileObservedWebAction(payload, this.runtimeBindings)
        : undefined
    })
    if (
      actions.length > 0 &&
      definedInstructions(compiled) &&
      instructionCoversStepVariables(compiled, templateStep)
    ) {
      instructions.push(...compiled)
      return this.executeCompiledStep(instructions, compiled, index, signal)
    }
    this.context.uncacheable.reason = 'non-deterministic-action'
    return executeObservedActions(
      this.context.automation,
      actions,
      signal,
      () => this.context.inference.count++,
    )
  }

  executeStep(
    step: ScenarioStep,
    prompt: string,
    context: StepExecutionContext,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    const target = navigationTarget(prompt)
    if (target) {
      return this.adaptiveNavigation(
        context.templateStep,
        target,
        context.stepIndex,
        signal,
      )
    }
    return step.type === 'outcome'
      ? this.adaptiveOutcome(
          step,
          prompt,
          context.templateStep,
          context.stepIndex,
          signal,
        )
      : this.adaptiveAction(
          observeInstruction(step),
          context.templateStep,
          context.stepIndex,
          signal,
        )
  }
}

export function createWebAdaptiveRuntime(
  input: CreateAdaptiveRuntimeInput,
): WebAdaptiveRuntime {
  return new AdaptiveWebRuntime(input)
}
