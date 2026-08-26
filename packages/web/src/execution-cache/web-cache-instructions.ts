import type { ResolvedAction, StepExecution } from '@pickle-spec/runner'
import type { ScenarioStep, ScenarioVariableBinding } from '@pickle-spec/spec'
import { abortError } from '../adapter/abort'
import type { WebAutomation } from '../adapter/web-adapter'
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

export function createWebInstructionExecutor({
  automation,
  baseUrl,
  bindings,
  replay,
}: CreateInstructionExecutorInput) {
  let navigated = false
  const instructionOrigin = replay ? 'cached' : 'resolved'

  function failure(
    instruction: WebInstruction,
    message: string,
  ): StepExecution {
    const execution: StepExecution = {
      state: 'failed',
      resolvedActions: [
        { description: instructionDescription(instruction, instructionOrigin) },
      ],
      message,
    }
    if (replay) execution.replayDiverged = true
    return execution
  }

  async function executeDirect(
    instruction: WebInstruction,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution | undefined> {
    if (!automation.executeInstruction) {
      return failure(
        instruction,
        replay
          ? 'Replay diverged: direct browser execution is unavailable'
          : 'Deterministic web instruction failed: direct browser execution is unavailable',
      )
    }
    try {
      const result = await automation.executeInstruction(
        instruction,
        bindings,
        signal,
      )
      if (result.success) return undefined
      return failure(
        instruction,
        result.message ??
          `${replay ? 'Replay diverged' : 'Deterministic web instruction failed'}: ${result.actualState ?? instruction.kind}`,
      )
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw abortError()
      }
      return failure(
        instruction,
        `${replay ? 'Replay diverged' : 'Deterministic web instruction failed'}: ${errorMessage(error)}`,
      )
    }
  }

  async function executeSequence(
    instructions: readonly WebInstruction[],
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    const resolvedActions = resolvedInstructions(
      instructions,
      instructionOrigin,
    )
    for (const instruction of instructions) {
      const failed = await executeDirect(instruction, signal)
      if (failed) return { ...failed, resolvedActions }
      if (instruction.kind === 'navigate') navigated = true
    }
    return { state: 'passed', resolvedActions }
  }

  async function implicitNavigation(
    instructions: WebInstruction[],
    signal: AbortSignal | undefined,
    persist = true,
  ): Promise<StepExecution | undefined> {
    if (navigated) return undefined
    const url = parameterizeWebValue(baseUrl, bindings, { template: baseUrl })
    if (!url) {
      return failure(
        { kind: 'navigate', url: { segments: [{ literal: baseUrl }] } },
        'Deterministic web instruction failed: base URL is not cacheable',
      )
    }
    const navigation: WebInstruction = { kind: 'navigate', url }
    const failed = await executeDirect(navigation, signal)
    if (failed) return failed
    if (persist) instructions.push(navigation)
    navigated = true
  }

  return {
    executeSequence,
    implicitNavigation,
    markNavigated() {
      navigated = true
    },
  }
}
