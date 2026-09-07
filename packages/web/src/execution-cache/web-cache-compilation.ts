import type { ScenarioStep, ScenarioVariableBinding } from '@pickle-spec/spec'
import { z } from 'zod'
import { requiredValue } from '../required-value'
import type {
  WebInstruction,
  WebLocator,
  WebTemplate,
} from './web-cache-schema'
import { navigationUrl } from './web-step'
import {
  appendWebTemplate,
  bindWebTemplate,
  parameterizeWebValue,
} from './web-template'

const assertionLocatorFields = {
  selector: z
    .string()
    .min(1)
    .describe('CSS or Playwright selector for the element'),
  nth: z
    .number()
    .int()
    .nonnegative()
    .optional()
    .describe('0-based match index when the selector hits multiple nodes'),
}

export const webAssertionDraftSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('exists'), ...assertionLocatorFields }),
  z.strictObject({ kind: z.literal('visible'), ...assertionLocatorFields }),
  z.strictObject({ kind: z.literal('hidden'), ...assertionLocatorFields }),
  z.strictObject({
    kind: z.literal('text-equals'),
    ...assertionLocatorFields,
    expected: z
      .string()
      .describe('Exact inner text required by the expectation'),
  }),
  z.strictObject({
    kind: z.literal('text-contains'),
    ...assertionLocatorFields,
    expected: z
      .string()
      .describe('Substring that must appear in the element text'),
  }),
  z.strictObject({
    kind: z.literal('value-equals'),
    ...assertionLocatorFields,
    expected: z
      .string()
      .describe('Exact input value required by the expectation'),
  }),
  z.strictObject({
    kind: z.literal('count-equals'),
    ...assertionLocatorFields,
    expected: z
      .union([z.number().int().nonnegative(), z.string()])
      .describe('Exact number of matches required by the expectation'),
  }),
  z.strictObject({
    kind: z.literal('url-equals'),
    expected: z.string().describe('Exact page URL required by the expectation'),
  }),
])

export const webAssertionCompileSchema = z.object({
  assertions: z
    .array(webAssertionDraftSchema)
    .min(1)
    .describe(
      'One deterministic browser assertion per check in the expectation',
    ),
})

export type WebAssertionDraft = z.infer<typeof webAssertionDraftSchema>

interface ObservedActionPayload {
  selector: string
  method?: string
  arguments?: string[]
}

const observedActionPayloadSchema = z.strictObject({
  selector: z.string().min(1),
  description: z.string().optional(),
  method: z.string().optional(),
  arguments: z.array(z.string()).optional(),
})

const parseObservedActionPayloadSchema = z
  .unknown()
  .transform((value) => observedActionPayloadSchema.safeParse(value).data)
export const parseObservedActionPayload =
  parseObservedActionPayloadSchema.parse.bind(parseObservedActionPayloadSchema)

function absoluteNavigationTemplate(
  baseUrl: string,
  target: string,
  targetTemplate: WebTemplate,
  bindings: readonly ScenarioVariableBinding[],
): WebTemplate | undefined {
  if (/^https?:\/\//i.test(target)) return targetTemplate
  if (!target.startsWith('/')) {
    return parameterizeWebValue(baseUrl, bindings, { template: baseUrl })
  }
  const segments: WebTemplate['segments'] = [
    {
      literal: new URL(baseUrl).origin,
    },
  ]
  appendWebTemplate(segments, targetTemplate)
  const template = { segments }
  return bindWebTemplate(template, bindings) === navigationUrl(baseUrl, target)
    ? template
    : undefined
}

export function compileWebNavigation(
  baseUrl: string,
  target: string,
  templateTarget: string,
  bindings: readonly ScenarioVariableBinding[],
): WebInstruction | undefined {
  const targetTemplate = parameterizeWebValue(target, bindings, {
    template: templateTarget,
  })
  if (!targetTemplate) return undefined
  const url = absoluteNavigationTemplate(
    baseUrl,
    target,
    targetTemplate,
    bindings,
  )
  return url ? { kind: 'navigate', url } : undefined
}

export function webInstructionVariables(
  instruction: WebInstruction,
): Set<string> {
  const variables = new Set<string>()
  const templates: WebTemplate[] = []
  if ('locator' in instruction) templates.push(instruction.locator.selector)
  if ('url' in instruction) templates.push(instruction.url)
  if ('value' in instruction) templates.push(instruction.value)
  if ('values' in instruction) templates.push(...instruction.values)
  if ('expected' in instruction && instruction.expected instanceof Object) {
    if ('variable' in instruction.expected)
      variables.add(instruction.expected.variable)
    else templates.push(instruction.expected)
  }
  for (const template of templates) {
    for (const segment of template.segments) {
      if ('variable' in segment) variables.add(segment.variable)
    }
  }
  return variables
}

export function stepVariableNames(step: ScenarioStep): string[] {
  const variables = new Set<string>()
  const collect = (value: string) => {
    for (const match of value.matchAll(/<([^>]+)>/g))
      variables.add(requiredValue(match[1]))
  }
  collect(step.text)
  for (const row of step.argument?.dataTable ?? []) {
    for (const cell of row) collect(cell)
  }
  if (step.argument?.docString) collect(step.argument.docString)
  return [...variables]
}

export function instructionCoversStepVariables(
  instructions: readonly WebInstruction[],
  step: ScenarioStep,
): boolean {
  const referenced = new Set(
    instructions.flatMap((instruction) => [
      ...webInstructionVariables(instruction),
    ]),
  )
  return stepVariableNames(step).every((variable) => referenced.has(variable))
}

function locatorFrom(
  selector: string,
  nth: number | undefined,
  bindings: readonly ScenarioVariableBinding[],
): WebLocator | undefined {
  const parameterized = parameterizeWebValue(selector, bindings)
  if (!parameterized) return undefined
  const locator: WebLocator = { selector: parameterized }
  if (nth !== undefined) locator.nth = nth
  return locator
}

export function compileWebAssertion(
  draft: WebAssertionDraft,
  bindings: readonly ScenarioVariableBinding[],
): WebInstruction | undefined {
  if (draft.kind === 'url-equals') {
    const expected = parameterizeWebValue(draft.expected, bindings)
    return expected ? { kind: draft.kind, expected } : undefined
  }
  const locator = locatorFrom(draft.selector, draft.nth, bindings)
  if (!locator) return undefined
  if (
    draft.kind === 'exists' ||
    draft.kind === 'visible' ||
    draft.kind === 'hidden'
  ) {
    return { kind: draft.kind, locator }
  }
  if (draft.kind === 'count-equals') {
    return compileCountAssertion(draft, locator, bindings)
  }
  const expected = parameterizeWebValue(draft.expected, bindings)
  return expected ? { kind: draft.kind, locator, expected } : undefined
}

function compileCountAssertion(
  draft: Extract<WebAssertionDraft, { kind: 'count-equals' }>,
  locator: WebLocator,
  bindings: readonly ScenarioVariableBinding[],
): WebInstruction | undefined {
  if (draft.nth !== undefined) return undefined
  const countValue = z.number().safeParse(draft.expected)
  if (countValue.success) {
    return { kind: draft.kind, locator, expected: countValue.data }
  }
  const expected = parameterizeWebValue(String(draft.expected), bindings)
  if (expected?.segments.length !== 1) return undefined
  const segment = requiredValue(expected.segments[0])
  if (!('literal' in segment))
    return { kind: draft.kind, locator, expected: segment }
  const count = Number(segment.literal)
  return Number.isSafeInteger(count) && count >= 0
    ? { kind: draft.kind, locator, expected: count }
    : undefined
}

export function compileObservedWebAction(
  payload: ObservedActionPayload,
  bindings: readonly ScenarioVariableBinding[],
): WebInstruction | undefined {
  const locator = locatorFrom(payload.selector, undefined, bindings)
  if (!locator) return undefined
  const method = payload.method ?? 'click'
  const args = payload.arguments ?? []
  const simple = compileSimpleAction(method, args, locator)
  if (simple) return simple
  return compileActionWithArguments(method, args, locator, bindings)
}

function compileSimpleAction(
  method: string,
  args: readonly string[],
  locator: WebLocator,
): WebInstruction | undefined {
  if (args.length !== 0) return undefined
  if (method === 'click') return { kind: 'click', locator }
  if (method === 'hover') return { kind: 'hover', locator }
  return undefined
}

function compileActionWithArguments(
  method: string,
  args: readonly string[],
  locator: WebLocator,
  bindings: readonly ScenarioVariableBinding[],
): WebInstruction | undefined {
  switch (method) {
    case 'fill':
    case 'type': {
      if (args.length !== 1) return undefined
      const value = parameterizeWebValue(requiredValue(args[0]), bindings)
      return value ? { kind: method, locator, value } : undefined
    }
    case 'selectOption':
      return compileSelectOption(locator, args, bindings)
    case 'waitForSelector':
      return compileWaitFor(locator, args)
    default:
      return undefined
  }
}

function compileSelectOption(
  locator: WebLocator,
  args: readonly string[],
  bindings: readonly ScenarioVariableBinding[],
): WebInstruction | undefined {
  if (args.length === 0) return undefined
  const values = args.map((value) => parameterizeWebValue(value, bindings))
  return values.every((value) => value !== undefined)
    ? { kind: 'select-option', locator, values: values }
    : undefined
}

function compileWaitFor(
  locator: WebLocator,
  args: readonly string[],
): WebInstruction | undefined {
  if (args.length !== 1) return undefined
  const state = args[0]
  if (
    state !== 'attached' &&
    state !== 'detached' &&
    state !== 'visible' &&
    state !== 'hidden'
  ) {
    return undefined
  }
  return { kind: 'wait-for', locator, state }
}
