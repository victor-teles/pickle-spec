import type { ExecutionCacheUncacheableReason } from '@pickle-spec/runner'
import {
  type MobileExecutionCachePayload,
  mobileReplayVariableName,
} from '../execution-cache/mobile-execution-cache'
import { requiredValue } from '../required-value'
import type {
  MobilePlatform,
  MobileStep,
  MobileWorkerScenario,
} from '../worker/worker-protocol'

export type MobileAssertionPredicate =
  | 'text'
  | 'visible'
  | 'hidden'
  | 'exists'
  | 'editable'
  | 'selected'
  | 'focused'

type ParameterizedArgument = {
  template: string
  runtime: string
}

type MobileDeterministicOperation =
  | { kind: 'wait-text'; target: ParameterizedArgument }
  | { kind: 'find-click'; target: ParameterizedArgument }
  | {
      kind: 'assert'
      predicate: MobileAssertionPredicate
      target: ParameterizedArgument
      expected?: ParameterizedArgument
    }

export interface CompiledMobileScenario {
  payload: MobileExecutionCachePayload
  requiredVariables: string[]
  runtimeEnv: string[]
  descriptions: string[]
  uncacheableReason?: ExecutionCacheUncacheableReason
}

interface CompileMobileScenarioInput {
  platform: MobilePlatform
  applicationId: string
  scenario: MobileWorkerScenario
}

const assertionPattern =
  /^(text|visible|hidden|exists|editable|selected|focused):\s*(.+)$/

function quote(value: string): string {
  return JSON.stringify(value)
}

function replaceVariables(
  template: string,
  runtime: string,
  replayVariables: ReadonlyMap<string, string>,
): ParameterizedArgument {
  return {
    template: template.replaceAll(/<([^>]+)>/g, (match, name: string) =>
      replayVariables.has(name) ? `\${${replayVariables.get(name)}}` : match,
    ),
    runtime,
  }
}

function escapedTextSelector(value: string): string {
  return `text="${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function assertionOperation(
  templateStep: MobileStep,
  runtimeStep: MobileStep,
  replayVariables: ReadonlyMap<string, string>,
): MobileDeterministicOperation {
  const match = assertionPattern.exec(templateStep.text)
  const runtimeMatch = assertionPattern.exec(runtimeStep.text)
  if (!match || !runtimeMatch) {
    return {
      kind: 'assert',
      predicate: 'visible',
      target: replaceVariables(
        escapedTextSelector(templateStep.text),
        escapedTextSelector(runtimeStep.text),
        replayVariables,
      ),
    }
  }
  const predicate = match[1] as MobileAssertionPredicate
  const templateBody = requiredValue(match[2])
  const runtimeBody = requiredValue(runtimeMatch[2])
  if (predicate !== 'text') {
    return {
      kind: 'assert',
      predicate,
      target: replaceVariables(templateBody, runtimeBody, replayVariables),
    }
  }
  const separator = templateBody.indexOf(' = ')
  const runtimeSeparator = runtimeBody.indexOf(' = ')
  if (separator === -1 || runtimeSeparator === -1) {
    return {
      kind: 'assert',
      predicate: 'text',
      target: replaceVariables(templateBody, runtimeBody, replayVariables),
      expected: { template: '', runtime: '' },
    }
  }
  return {
    kind: 'assert',
    predicate: 'text',
    target: replaceVariables(
      templateBody.slice(0, separator),
      runtimeBody.slice(0, runtimeSeparator),
      replayVariables,
    ),
    expected: replaceVariables(
      templateBody.slice(separator + 3),
      runtimeBody.slice(runtimeSeparator + 3),
      replayVariables,
    ),
  }
}

function operationFor(
  templateStep: MobileStep,
  runtimeStep: MobileStep,
  replayVariables: ReadonlyMap<string, string>,
): MobileDeterministicOperation {
  if (templateStep.type === 'context') {
    return {
      kind: 'wait-text',
      target: replaceVariables(
        templateStep.text,
        runtimeStep.text,
        replayVariables,
      ),
    }
  }
  if (templateStep.type === 'action') {
    return {
      kind: 'find-click',
      target: replaceVariables(
        templateStep.text,
        runtimeStep.text,
        replayVariables,
      ),
    }
  }
  return assertionOperation(templateStep, runtimeStep, replayVariables)
}

function operationLine(operation: MobileDeterministicOperation): string {
  switch (operation.kind) {
    case 'wait-text':
      return `wait text ${quote(operation.target.template)}`
    case 'find-click':
      return `find ${quote(operation.target.template)} click`
    case 'assert':
      return `is ${operation.predicate} ${quote(operation.target.template)}${
        operation.predicate === 'text'
          ? ` ${quote(operation.expected?.template ?? '')}`
          : ''
      }`
  }
}

function operationDescription(
  step: MobileStep,
  operation: MobileDeterministicOperation,
): string {
  if (step.type === 'context') return `Wait: ${step.text}`
  if (step.type === 'action') return `Act: ${step.text}`
  const match = assertionPattern.exec(step.text)
  return match
    ? `Assert ${operation.kind === 'assert' ? operation.predicate : 'visible'}: ${match[2]}`
    : `Assert visible: ${step.text}`
}

function uncacheableReasonFor(
  input: CompileMobileScenarioInput,
  hasArguments: boolean,
  hasInvalidTextAssertion: boolean,
): ExecutionCacheUncacheableReason | undefined {
  if (hasInvalidTextAssertion) return 'non-deterministic-assertion'
  if (!hasArguments) return undefined
  const hasOutcomeArgument = input.scenario.templateSteps.some(
    (step) => step.type === 'outcome' && step.argument !== undefined,
  )
  return hasOutcomeArgument
    ? 'non-deterministic-assertion'
    : 'non-deterministic-action'
}

function usedVariableNames(script: string, names: readonly string[]): string[] {
  return names.filter((name) =>
    script.includes(`\${${mobileReplayVariableName(name)}}`),
  )
}

function mobileOperations(
  input: CompileMobileScenarioInput,
): MobileDeterministicOperation[] {
  const replayVariables = new Map(
    input.scenario.runtimeBindings.map((binding) => [
      binding.name,
      mobileReplayVariableName(binding.name),
    ]),
  )
  return input.scenario.templateSteps.map((templateStep, index) =>
    operationFor(
      templateStep,
      input.scenario.steps[index] ?? templateStep,
      replayVariables,
    ),
  )
}

export function compileMobileScenario(
  input: CompileMobileScenarioInput,
): CompiledMobileScenario {
  const operations = mobileOperations(input)
  const lines = [
    `context platform=${input.platform}`,
    `open ${quote(input.applicationId)} --relaunch`,
    ...operations.map(operationLine),
  ]
  const script = `${lines.join('\n')}\n`
  const requiredVariables = usedVariableNames(
    script,
    input.scenario.runtimeBindings.map((binding) => binding.name),
  )
  const bindings = new Map(
    input.scenario.runtimeBindings.map((binding) => [
      binding.name,
      binding.value,
    ]),
  )
  const hasArguments = input.scenario.templateSteps.some(
    (step) => step.argument !== undefined,
  )
  const hasInvalidTextAssertion = operations.some(
    (operation) =>
      operation.kind === 'assert' &&
      operation.predicate === 'text' &&
      operation.expected?.template === '',
  )

  return {
    payload: {
      format: 'agent-device-ad',
      script,
      stepRanges: operations.map((_, index) => ({
        from: index + 2,
        to: index + 2,
      })),
    },
    requiredVariables,
    runtimeEnv: requiredVariables.map(
      (name) => `${mobileReplayVariableName(name)}=${bindings.get(name) ?? ''}`,
    ),
    descriptions: operations.map((operation, index) =>
      operationDescription(
        requiredValue(input.scenario.templateSteps[index]),
        operation,
      ),
    ),
    uncacheableReason: uncacheableReasonFor(
      input,
      hasArguments,
      hasInvalidTextAssertion,
    ),
  }
}
