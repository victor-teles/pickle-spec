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
import { captureWebAction } from '../evidence/web-action-evidence'
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
  takePendingActions(): ResolvedAction[]
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
  context: StepExecutionContext,
  options: WebAdapterOptions,
  signal: AbortSignal | undefined,
  onInference: () => void,
): Promise<StepExecution> {
  const resolvedActions: ResolvedAction[] = []
  for (const action of actions) {
    onInference()
    const captured = await captureWebAction({
      automation,
      context,
      description: action.description,
      options,
      perform: () => automation.act(action, signal),
      outcome: (outcome) => ({
        state: outcome.success ? 'passed' : 'failed',
        message: outcome.message,
      }),
    })
    const result = captured.result
    resolvedActions.push({
      description: action.description,
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
  return actions.length > 0
    ? { state: 'passed', resolvedActions }
    : {
        state: 'failed',
        resolvedActions,
        message: 'Observe returned no actions',
      }
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
      resolvedActions: result.resolvedActions,
    }
  }

  private async adaptiveNavigation(
    templateStep: ScenarioStep,
    target: string,
    index: number,
    context: StepExecutionContext,
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
    const captured = await captureWebAction({
      automation: this.context.automation,
      context,
      description: `Navigate to ${url}`,
      options: this.context.options,
      perform: () => this.context.automation.navigate(url, signal),
      outcome: () => ({ state: 'passed' }),
    })
    this.context.executor.markNavigated()
    return {
      state: 'passed',
      resolvedActions: [
        { description: `Navigate to ${url}`, evidence: captured.evidence },
      ],
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
    context: StepExecutionContext,
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
    const description = `Verify: ${prompt}`
    const captured = await captureWebAction({
      automation: this.context.automation,
      context,
      description,
      options: this.context.options,
      perform: () => this.context.automation.verify(prompt, signal),
      outcome: (result) => ({
        state: result.meetsExpectation ? 'passed' : 'failed',
        message: result.meetsExpectation ? undefined : result.actualState,
      }),
    })
    const execution = verificationExecution(
      prompt,
      captured.result.meetsExpectation,
      captured.result.actualState,
    )
    return {
      ...execution,
      resolvedActions: [
        ...this.context.executor.takePendingActions(),
        ...execution.resolvedActions.map((action) => ({
          ...action,
          evidence: captured.evidence,
        })),
      ],
    }
  }

  private async adaptiveAction(
    prompt: string,
    templateStep: ScenarioStep,
    index: number,
    signal: AbortSignal | undefined,
    context: StepExecutionContext,
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
    const execution = await executeObservedActions(
      this.context.automation,
      actions,
      context,
      this.context.options,
      signal,
      () => this.context.inference.count++,
    )
    const pendingActions = this.context.executor.takePendingActions()
    return pendingActions.length > 0
      ? {
          ...execution,
          resolvedActions: [...pendingActions, ...execution.resolvedActions],
        }
      : execution
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
        context,
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
          context,
        )
      : this.adaptiveAction(
          observeInstruction(step),
          context.templateStep,
          context.stepIndex,
          signal,
          context,
        )
  }
}

export function createWebAdaptiveRuntime(
  input: CreateAdaptiveRuntimeInput,
): WebAdaptiveRuntime {
  return new AdaptiveWebRuntime(input)
}
