import type {
  ExecutionPlanOperationDisplay,
  ExecutionPlanStepDisplay,
  ExecutionPlanTemplateDisplay,
} from '@pickle-spec/runner'
import { planDigest } from '@pickle-spec/runner'
import type { ScenarioStep } from '@pickle-spec/spec'
import { z } from 'zod'
import { validInstructionsForStep } from './web-cache-instructions'
import type {
  WebExecutionCachePayload,
  WebInstruction,
  WebLocator,
  WebTemplate,
} from './web-cache-schema'

const sensitiveUrlParameter =
  /(?:token|key|secret|password|credential|session|auth)/i
type ProjectedOperation = Omit<ExecutionPlanOperationDisplay, 'index'>
type WebCheckInstruction = Extract<
  WebInstruction,
  {
    kind:
      | 'wait-for'
      | 'exists'
      | 'visible'
      | 'hidden'
      | 'text-equals'
      | 'text-contains'
      | 'value-equals'
      | 'count-equals'
      | 'url-equals'
  }
>
type WebAggregateCheck = Extract<
  WebInstruction,
  { kind: 'count-equals' | 'url-equals' }
>

function publicUrlLiteral(value: string): string {
  try {
    const url = new URL(value)
    url.username = ''
    url.password = ''
    for (const name of url.searchParams.keys()) {
      if (sensitiveUrlParameter.test(name)) {
        url.searchParams.set(name, '<redacted>')
      }
    }
    return url.toString()
  } catch {
    return value
      .replace(/(\/\/)[^/@\s]+@/g, '$1')
      .replace(
        /([?&](?:[^=&]*(?:token|key|secret|password|credential|session|auth)[^=&]*)=)[^&#]*/gi,
        '$1<redacted>',
      )
  }
}

function inputTemplates(instruction: WebInstruction): readonly WebTemplate[] {
  if (instruction.kind === 'select-option') return instruction.values
  if (instruction.kind === 'fill' || instruction.kind === 'type') {
    return [instruction.value]
  }
  return []
}

function sensitiveInputLiterals(
  payload: WebExecutionCachePayload,
): Set<string> {
  return new Set(
    payload.steps
      .flatMap((step) => step.instructions)
      .flatMap(inputTemplates)
      .flatMap((template) => template.segments)
      .flatMap((segment) =>
        'literal' in segment && segment.literal ? [segment.literal] : [],
      ),
  )
}

function templateDisplay(
  template: WebTemplate,
  sensitiveLiterals: ReadonlySet<string>,
  policy: 'public' | 'input' | 'url' = 'public',
): ExecutionPlanTemplateDisplay {
  const splitUrl = policy === 'url' && template.segments.length > 1
  return {
    segments: template.segments.map((segment) => {
      if ('variable' in segment) {
        return { kind: 'variable' as const, name: segment.variable }
      }
      if (policy === 'input' || splitUrl) return { kind: 'redacted' as const }
      if (
        [...sensitiveLiterals].some((literal) =>
          segment.literal.includes(literal),
        )
      ) {
        return { kind: 'redacted' as const }
      }
      return {
        kind: 'literal' as const,
        value:
          policy === 'url'
            ? publicUrlLiteral(segment.literal)
            : segment.literal,
      }
    }),
  }
}

function targetDisplay(
  locator: WebLocator,
  sensitiveLiterals: ReadonlySet<string>,
) {
  return {
    selector: templateDisplay(locator.selector, sensitiveLiterals),
    nth: locator.nth,
  }
}

function targetOperation(
  instruction: Extract<WebInstruction, { locator: WebLocator }>,
  summary: string,
  sensitiveLiterals: ReadonlySet<string>,
): ProjectedOperation {
  return {
    kind: instruction.kind,
    summary,
    target: targetDisplay(instruction.locator, sensitiveLiterals),
  }
}

function instructionDisplay(
  instruction: WebInstruction,
  sensitiveLiterals: ReadonlySet<string>,
): ProjectedOperation {
  switch (instruction.kind) {
    case 'navigate':
      return {
        kind: instruction.kind,
        summary: 'Navigate',
        value: templateDisplay(instruction.url, sensitiveLiterals, 'url'),
      }
    case 'click':
      return targetOperation(instruction, 'Click', sensitiveLiterals)
    case 'fill':
    case 'type':
      return {
        ...targetOperation(
          instruction,
          instruction.kind === 'fill' ? 'Fill' : 'Type',
          sensitiveLiterals,
        ),
        value: templateDisplay(instruction.value, sensitiveLiterals, 'input'),
      }
    case 'hover':
      return targetOperation(instruction, 'Hover', sensitiveLiterals)
    case 'select-option':
      return {
        ...targetOperation(instruction, 'Select option', sensitiveLiterals),
        value: {
          segments: instruction.values.flatMap((value, index) => [
            ...(index > 0 ? [{ kind: 'literal' as const, value: ', ' }] : []),
            ...templateDisplay(value, sensitiveLiterals, 'input').segments,
          ]),
        },
      }
    default:
      return checkDisplay(instruction, sensitiveLiterals)
  }
}

function editableInstruction(instruction: WebInstruction): boolean {
  return (
    instruction.kind === 'click' ||
    instruction.kind === 'fill' ||
    instruction.kind === 'type' ||
    instruction.kind === 'hover' ||
    instruction.kind === 'select-option'
  )
}

function checkDisplay(
  instruction: WebCheckInstruction,
  sensitiveLiterals: ReadonlySet<string>,
): ProjectedOperation {
  switch (instruction.kind) {
    case 'wait-for':
      return {
        ...targetOperation(instruction, 'Wait for target', sensitiveLiterals),
        check: instruction.state,
      }
    case 'exists':
    case 'visible':
    case 'hidden':
      return {
        ...targetOperation(
          instruction,
          `Check ${instruction.kind}`,
          sensitiveLiterals,
        ),
        check: instruction.kind,
      }
    case 'text-equals':
    case 'text-contains':
      return {
        ...targetOperation(
          instruction,
          `Check ${instruction.kind}`,
          sensitiveLiterals,
        ),
        value: templateDisplay(instruction.expected, sensitiveLiterals),
        check: instruction.kind,
      }
    case 'value-equals':
      return {
        ...targetOperation(
          instruction,
          'Check value-equals',
          sensitiveLiterals,
        ),
        value: templateDisplay(
          instruction.expected,
          sensitiveLiterals,
          'input',
        ),
        check: instruction.kind,
      }
    case 'count-equals':
    case 'url-equals':
      return aggregateCheckDisplay(instruction, sensitiveLiterals)
  }
}

function aggregateCheckDisplay(
  instruction: WebAggregateCheck,
  sensitiveLiterals: ReadonlySet<string>,
): ProjectedOperation {
  if (instruction.kind === 'url-equals') {
    return {
      kind: instruction.kind,
      summary: 'Check URL',
      value: templateDisplay(instruction.expected, sensitiveLiterals, 'url'),
      check: instruction.kind,
    }
  }
  const expectedVariable = z
    .strictObject({ variable: z.string() })
    .safeParse(instruction.expected)
  const segments = expectedVariable.success
    ? [{ kind: 'variable' as const, name: expectedVariable.data.variable }]
    : [{ kind: 'literal' as const, value: String(instruction.expected) }]
  return {
    kind: instruction.kind,
    summary: 'Check count',
    target: {
      selector: templateDisplay(
        instruction.locator.selector,
        sensitiveLiterals,
      ),
    },
    value: { segments },
    check: instruction.kind,
  }
}

export function projectWebExecutionPlan(
  payload: WebExecutionCachePayload,
  scenarioSteps: readonly ScenarioStep[],
): readonly ExecutionPlanStepDisplay[] {
  const sensitiveLiterals = sensitiveInputLiterals(payload)
  return payload.steps.map((step, index) => {
    const scenarioStep = scenarioSteps[index]
    if (!scenarioStep) {
      throw new Error('Web execution cache contains an unknown Scenario step')
    }
    if (!validInstructionsForStep(step.instructions, scenarioStep)) {
      throw new Error(
        'Web execution cache does not match the Scenario step role',
      )
    }
    return {
      index,
      keyword: scenarioStep.keyword,
      text: scenarioStep.text,
      operations: step.instructions.map((instruction, operationIndex) => {
        const operation = {
          ...instructionDisplay(instruction, sensitiveLiterals),
          index: operationIndex,
        }
        if (
          scenarioStep.type !== 'outcome' &&
          editableInstruction(instruction)
        ) {
          return {
            ...operation,
            editable: { instructionDigest: planDigest(instruction) },
          }
        }
        return operation
      }),
    }
  })
}
