import type {
  OpenSessionInput,
  ResolvedAction,
  StepExecution,
  StepExecutionContext,
  StepTargetSession,
} from '@pickle-spec/runner'
import type { ScenarioStep } from '@pickle-spec/spec'
import { abortError } from './abort'
import type { WebAutomation } from './web-adapter'
import {
  compileObservedWebAction,
  compileWebAssertion,
  instructionCoversStepVariables,
  parameterizeWebValue,
  parseObservedActionPayload,
  parseWebExecutionCachePayload,
  type WebAssertionDraft,
  type WebExecutionCachePayload,
  type WebInstruction,
} from './web-execution-cache'
import { defaultModelName, type WebAdapterOptions } from './web-options'

type FinishStep = (
  step: ScenarioStep,
  execution: StepExecution,
) => Promise<StepExecution>

interface CreateWebCacheSessionInput {
  input: OpenSessionInput
  options: WebAdapterOptions
  automation: WebAutomation
  finish: FinishStep
}

const navigationPattern = new RegExp(
  '(?:' +
    'I (?:am on|navigate to|visit|go to|open)' +
    '|(?:eu )?(?:navego para|visito|abro|estou em)' +
    '|(?:yo )?(?:navego a|visito|abro|estoy en)' +
    '|(?:je )?(?:navigue vers|visite|ouvre|suis sur)' +
    ')' +
    '\\s+(?:(?:the|a|o|la|le|el|à)\\s+)?' +
    '["\']?(.+?)["\']?\\s*$',
  'i',
)

function promptFor(step: ScenarioStep): string {
  let prompt = step.text
  if (step.argument?.dataTable) {
    prompt += '\n\nWith the following data:\n'
    prompt += step.argument.dataTable.map((row) => row.join(' | ')).join('\n')
  }
  if (step.argument?.docString) prompt += `\n\n${step.argument.docString}`
  return prompt
}

function navigationUrl(baseUrl: string, target: string): string {
  if (/^https?:\/\//i.test(target)) return target
  if (target.startsWith('/')) return new URL(target, baseUrl).toString()
  return baseUrl
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function instructionDescription(instruction: WebInstruction): string {
  switch (instruction.kind) {
    case 'navigate':
      return 'Navigate to the cached URL'
    case 'click':
      return 'Click the cached locator'
    case 'fill':
      return 'Fill the cached locator'
    case 'type':
      return 'Type into the cached locator'
    case 'hover':
      return 'Hover the cached locator'
    case 'select-option':
      return 'Select cached option values'
    case 'wait-for':
      return `Wait for cached locator to be ${instruction.state}`
    default:
      return `Assert ${instruction.kind}`
  }
}

function resolvedInstructions(
  instructions: readonly WebInstruction[],
): ResolvedAction[] {
  return instructions.map((instruction) => ({
    description: instructionDescription(instruction),
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

function validInstructionsForStep(
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

export function createWebCacheSession({
  input,
  options,
  automation,
  finish,
}: CreateWebCacheSessionInput): Omit<StepTargetSession, 'close'> {
  const mode = input.mode ?? 'adaptive'
  const replay = mode === 'replay'
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
  > = []
  let uncacheableReason:
    | 'non-deterministic-action'
    | 'non-deterministic-assertion'
    | 'bound-parameter-value'
    | undefined
  let inferenceCount = 0
  let navigated = false
  let fallbackStepIndex = 0

  async function executeDirect(
    instruction: WebInstruction,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution | undefined> {
    if (!automation.executeInstruction) {
      return {
        state: 'failed',
        replayDiverged: true,
        resolvedActions: [{ description: instructionDescription(instruction) }],
        message: 'Replay diverged: direct browser execution is unavailable',
      }
    }
    try {
      const result = await automation.executeInstruction(
        instruction,
        runtimeBindings,
        signal,
      )
      if (result.success) return undefined
      return {
        state: 'failed',
        ...(replay ? { replayDiverged: true } : {}),
        resolvedActions: [{ description: instructionDescription(instruction) }],
        message:
          result.message ??
          `${replay ? 'Replay diverged' : 'Deterministic web instruction failed'}: ${result.actualState ?? instruction.kind}`,
      }
    } catch (error) {
      if (
        signal?.aborted ||
        (error instanceof Error && error.name === 'AbortError')
      ) {
        throw abortError()
      }
      return {
        state: 'failed',
        ...(replay ? { replayDiverged: true } : {}),
        resolvedActions: [{ description: instructionDescription(instruction) }],
        message: `${replay ? 'Replay diverged' : 'Deterministic web instruction failed'}: ${errorMessage(error)}`,
      }
    }
  }

  async function executeSequence(
    instructions: readonly WebInstruction[],
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    const resolvedActions = resolvedInstructions(instructions)
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
    const navigation: WebInstruction = {
      kind: 'navigate',
      url: parameterizeWebValue(options.baseUrl, runtimeBindings)!,
    }
    const failed = await executeDirect(navigation, signal)
    if (failed) return failed
    if (persist) instructions.push(navigation)
    navigated = true
  }

  function executionContext(
    step: ScenarioStep,
    context?: StepExecutionContext,
  ): StepExecutionContext {
    return (
      context ?? {
        stepIndex: fallbackStepIndex++,
        templateStep: step,
        runtimeBindings,
      }
    )
  }

  async function replayStep(
    step: ScenarioStep,
    index: number,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    const cached = cachedPayload?.steps[index]
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
    if (!navigated && cached.instructions[0]?.kind !== 'navigate') {
      const failed = await implicitNavigation([], signal, false)
      if (failed) return failed
    }
    return executeSequence(cached.instructions, signal)
  }

  async function adaptiveNavigation(
    templateStep: ScenarioStep,
    target: string,
    index: number,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    const url = navigationUrl(options.baseUrl, target)
    const parameterized = parameterizeWebValue(url, runtimeBindings)
    const instruction: WebInstruction | undefined = parameterized
      ? { kind: 'navigate', url: parameterized }
      : undefined
    if (
      instruction &&
      instructionCoversStepVariables([instruction], templateStep)
    ) {
      const result = await executeSequence([instruction], signal)
      if (result.state === 'passed') {
        compiledSteps[index] = { instructions: [instruction] }
      }
      return result
    }
    uncacheableReason = 'bound-parameter-value'
    await automation.navigate(url, signal)
    navigated = true
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
    const navigationFailure = await implicitNavigation(instructions, signal)
    if (navigationFailure) return navigationFailure
    inferenceCount++
    let draft: WebAssertionDraft | undefined
    try {
      draft = await automation.compileAssertion?.(prompt, signal)
    } catch {
      draft = undefined
    }
    const assertion = draft
      ? compileWebAssertion(draft, runtimeBindings)
      : undefined
    if (
      assertion &&
      instructionCoversStepVariables([assertion], templateStep)
    ) {
      instructions.push(assertion)
      const result = await executeSequence([assertion], signal)
      if (result.state === 'passed') compiledSteps[index] = { instructions }
      return { ...result, resolvedActions: resolvedInstructions(instructions) }
    }
    uncacheableReason = draft
      ? 'bound-parameter-value'
      : 'non-deterministic-assertion'
    inferenceCount++
    const verification = await automation.verify(prompt, signal)
    return verification.meetsExpectation
      ? {
          state: 'passed',
          resolvedActions: [{ description: `Verify: ${prompt}` }],
        }
      : {
          state: 'failed',
          resolvedActions: [{ description: `Verify: ${prompt}` }],
          message: `Expected: "${prompt}" | Actual: ${verification.actualState}`,
        }
  }

  async function adaptiveAction(
    prompt: string,
    templateStep: ScenarioStep,
    index: number,
    signal: AbortSignal | undefined,
  ): Promise<StepExecution> {
    const instructions: WebInstruction[] = []
    const navigationFailure = await implicitNavigation(instructions, signal)
    if (navigationFailure) return navigationFailure
    let actions = await automation.observe(prompt, signal)
    inferenceCount++
    if (actions.length === 0) {
      actions = await automation.observe(prompt, signal)
      inferenceCount++
    }
    const compiled = actions.map((action) => {
      const payload = parseObservedActionPayload(action.handle)
      return payload
        ? compileObservedWebAction(payload, runtimeBindings)
        : undefined
    })
    if (
      actions.length > 0 &&
      compiled.every((instruction) => instruction !== undefined) &&
      instructionCoversStepVariables(compiled as WebInstruction[], templateStep)
    ) {
      instructions.push(...(compiled as WebInstruction[]))
      const result = await executeSequence(compiled as WebInstruction[], signal)
      if (result.state === 'passed') compiledSteps[index] = { instructions }
      return { ...result, resolvedActions: resolvedInstructions(instructions) }
    }
    uncacheableReason = 'non-deterministic-action'
    const resolvedActions: ResolvedAction[] = []
    for (const action of actions) {
      inferenceCount++
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

  return {
    async executeStep(step, signal, context) {
      const operationSignal = signal ?? input.signal
      if (operationSignal?.aborted) throw abortError()
      const prompt = promptFor(step)
      const current = executionContext(step, context)
      try {
        const result = replay
          ? await replayStep(step, current.stepIndex, operationSignal)
          : await (async () => {
              const navigation = prompt.match(navigationPattern)
              if (navigation) {
                return adaptiveNavigation(
                  current.templateStep,
                  navigation[1]!.trim(),
                  current.stepIndex,
                  operationSignal,
                )
              }
              return step.type === 'outcome'
                ? adaptiveOutcome(
                    prompt,
                    current.templateStep,
                    current.stepIndex,
                    operationSignal,
                  )
                : adaptiveAction(
                    prompt,
                    current.templateStep,
                    current.stepIndex,
                    operationSignal,
                  )
            })()
        return finish(step, result)
      } catch (error) {
        if (
          operationSignal?.aborted ||
          (error instanceof Error && error.name === 'AbortError')
        ) {
          throw abortError()
        }
        return finish(step, {
          state: 'infrastructure-error',
          resolvedActions: [],
          message: errorMessage(error),
        })
      }
    },
    async complete() {
      if (replay) return { inferenceCount: 0 }
      const evaluationModel = options.browser?.modelName ?? defaultModelName
      if (uncacheableReason) {
        return {
          inferenceCount,
          evaluationModel,
          cacheCandidate: {
            cacheable: false as const,
            reason: uncacheableReason,
          },
        }
      }
      if (
        compiledSteps.length !== input.scenario.steps.length ||
        compiledSteps.some((step) => step === undefined)
      ) {
        return {
          inferenceCount,
          evaluationModel,
          cacheCandidate: {
            cacheable: false as const,
            reason: 'non-deterministic-action' as const,
          },
        }
      }
      const steps = compiledSteps as WebExecutionCachePayload['steps']
      return {
        inferenceCount,
        evaluationModel,
        cacheCandidate: {
          cacheable: true as const,
          requiredVariables,
          adapterPayload: {
            schemaVersion: 1 as const,
            steps,
          },
        },
      }
    },
  }
}
