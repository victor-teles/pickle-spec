import type { ResolvedAction, StepExecution } from '@pickle-spec/runner'
import type { ScenarioStep, ScenarioVariableBinding } from '@pickle-spec/spec'
import { abortError, isAbortError } from '../adapter/abort'
import type { WebAutomation } from '../adapter/web-automation'
import {
  parameterizeWebValue,
  type WebInstruction,
} from './web-execution-cache'
import { errorMessage } from './web-step'

type InstructionOrigin = 'cached' | 'resolved'

export function instructionDescription(
  instruction: WebInstruction,
  origin: InstructionOrigin,
): string {
  switch (instruction.kind) {
    case 'navigate':
      return `Navigate to the ${origin} URL`
    case 'click':
      return `Click the ${origin} locator`
    case 'fill':
      return `Fill the ${origin} locator`
    case 'type':
      return `Type into the ${origin} locator`
    case 'hover':
      return `Hover the ${origin} locator`
    case 'select-option':
      return `Select ${origin} option values`
    case 'wait-for':
      return `Wait for ${origin} locator to be ${instruction.state}`
    default:
      return `Assert ${instruction.kind}`
  }
}

export function resolvedInstructions(
  instructions: readonly WebInstruction[],
  origin: InstructionOrigin,
): ResolvedAction[] {
  return instructions.map((instruction) => ({
    description: instructionDescription(instruction, origin),
  }))
}

function isAssertion(instruction: WebInstruction): boolean {
  return (
    instruction.kind === 'exists' ||
    instruction.kind === 'visible' ||
    instruction.kind === 'hidden' ||
    instruction.kind === 'text-equals' ||
    instruction.kind === 'text-contains' ||
    instruction.kind === 'value-equals' ||
    instruction.kind === 'count-equals' ||
    instruction.kind === 'url-equals'
  )
}

export function validInstructionsForStep(
  instructions: readonly WebInstruction[],
  step: ScenarioStep,
): boolean {
  if (instructions.length === 0) return false
  const substantive =
    instructions[0]?.kind === 'navigate' ? instructions.slice(1) : instructions
  return step.type === 'outcome'
    ? substantive.length > 0 && substantive.every(isAssertion)
    : instructions.every((instruction) => !isAssertion(instruction))
}

interface CreateInstructionExecutorInput {
  automation: WebAutomation
  baseUrl: string
  bindings: readonly ScenarioVariableBinding[]
  replay: boolean
}

export interface WebInstructionExecutor {
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
  setOrigin(origin: InstructionOrigin): void
}

class DirectWebInstructionExecutor implements WebInstructionExecutor {
  private navigated = false
  private instructionOrigin: InstructionOrigin

  constructor(private readonly input: CreateInstructionExecutorInput) {
    this.instructionOrigin = input.replay ? 'cached' : 'resolved'
  }

  private failure(instruction: WebInstruction, message: string): StepExecution {
    return {
      state: 'failed',
      resolvedActions: [
        {
          description: instructionDescription(
            instruction,
            this.instructionOrigin,
          ),
        },
      ],
      message,
    }
  }

  private failurePrefix(): string {
    return this.instructionOrigin === 'cached'
      ? 'Replay diverged'
      : 'Deterministic web instruction failed'
  }

  private failedResultMessage(
    instruction: WebInstruction,
    result: { message?: string; actualState?: string },
  ): string {
    return (
      result.message ??
      `${this.failurePrefix()}: ${result.actualState ?? instruction.kind}`
    )
  }

  private async executeDirect(
    instruction: WebInstruction,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution | undefined> {
    if (!this.input.automation.executeInstruction) {
      return this.failure(
        instruction,
        `${this.failurePrefix()}: direct browser execution is unavailable`,
      )
    }
    try {
      const result = await this.input.automation.executeInstruction(
        instruction,
        this.input.bindings,
        signal,
      )
      if (result.success) return undefined
      return this.failure(
        instruction,
        this.failedResultMessage(instruction, result),
      )
    } catch (error) {
      if (isAbortError(error, signal)) throw abortError()
      return this.failure(
        instruction,
        `${this.failurePrefix()}: ${errorMessage(error)}`,
      )
    }
  }

  async executeSequence(
    instructions: readonly WebInstruction[],
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    const resolvedActions = resolvedInstructions(
      instructions,
      this.instructionOrigin,
    )
    for (const instruction of instructions) {
      const failed = await this.executeDirect(instruction, signal)
      if (failed) return { ...failed, resolvedActions }
      if (instruction.kind === 'navigate') this.navigated = true
    }
    return { state: 'passed', resolvedActions }
  }

  async implicitNavigation(
    instructions: WebInstruction[],
    signal: AbortSignal | undefined,
    persist = true,
  ): Promise<StepExecution | undefined> {
    if (this.navigated) return undefined
    const url = parameterizeWebValue(this.input.baseUrl, this.input.bindings, {
      template: this.input.baseUrl,
    })
    if (!url) {
      return this.failure(
        {
          kind: 'navigate',
          url: { segments: [{ literal: this.input.baseUrl }] },
        },
        'Deterministic web instruction failed: base URL is not cacheable',
      )
    }
    const navigation: WebInstruction = { kind: 'navigate', url }
    const failed = await this.executeDirect(navigation, signal)
    if (failed) return failed
    if (persist) instructions.push(navigation)
    this.navigated = true
  }

  markNavigated(): void {
    this.navigated = true
  }

  setOrigin(origin: InstructionOrigin): void {
    this.instructionOrigin = origin
  }
}

export function createWebInstructionExecutor({
  automation,
  baseUrl,
  bindings,
  replay,
}: CreateInstructionExecutorInput): WebInstructionExecutor {
  return new DirectWebInstructionExecutor({
    automation,
    baseUrl,
    bindings,
    replay,
  })
}
