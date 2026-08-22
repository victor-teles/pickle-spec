import type { ScenarioStep, ScenarioVariableBinding } from '@pickle-spec/spec'
import { z } from 'zod'
import type { ResolvedFidelity } from './fidelity'
import type { WebAdapterBehavior } from './web-adapter'
import type { WebAdapterOptions } from './web-options'

export const defaultWebActionTimeoutMs = 15_000
export const defaultWebNavigationTimeoutMs = 15_000

const variableName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]*$/)
const templateSegmentSchema = z.union([
  z.strictObject({ literal: z.string() }),
  z.strictObject({ variable: variableName }),
])
const webTemplateSchema = z.strictObject({
  segments: z.array(templateSegmentSchema).min(1),
})
const webLocatorSchema = z.strictObject({
  selector: webTemplateSchema,
  nth: z.number().int().nonnegative().optional(),
})
const webCountLocatorSchema = z.strictObject({ selector: webTemplateSchema })

const webInstructionSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('navigate'), url: webTemplateSchema }),
  z.strictObject({ kind: z.literal('click'), locator: webLocatorSchema }),
  z.strictObject({
    kind: z.literal('fill'),
    locator: webLocatorSchema,
    value: webTemplateSchema,
  }),
  z.strictObject({
    kind: z.literal('type'),
    locator: webLocatorSchema,
    value: webTemplateSchema,
  }),
  z.strictObject({ kind: z.literal('hover'), locator: webLocatorSchema }),
  z.strictObject({
    kind: z.literal('select-option'),
    locator: webLocatorSchema,
    values: z.array(webTemplateSchema).min(1),
  }),
  z.strictObject({
    kind: z.literal('wait-for'),
    locator: webLocatorSchema,
    state: z.enum(['attached', 'detached', 'visible', 'hidden']),
  }),
  z.strictObject({ kind: z.literal('exists'), locator: webLocatorSchema }),
  z.strictObject({ kind: z.literal('visible'), locator: webLocatorSchema }),
  z.strictObject({ kind: z.literal('hidden'), locator: webLocatorSchema }),
  z.strictObject({
    kind: z.literal('text-equals'),
    locator: webLocatorSchema,
    expected: webTemplateSchema,
  }),
  z.strictObject({
    kind: z.literal('text-contains'),
    locator: webLocatorSchema,
    expected: webTemplateSchema,
  }),
  z.strictObject({
    kind: z.literal('value-equals'),
    locator: webLocatorSchema,
    expected: webTemplateSchema,
  }),
  z.strictObject({
    kind: z.literal('count-equals'),
    locator: webCountLocatorSchema,
    expected: z.union([
      z.number().int().nonnegative(),
      z.strictObject({ variable: variableName }),
    ]),
  }),
  z.strictObject({
    kind: z.literal('url-equals'),
    expected: webTemplateSchema,
  }),
])

const webExecutionCachePayloadSchema = z.strictObject({
  schemaVersion: z.literal(1),
  steps: z.array(
    z.strictObject({ instructions: z.array(webInstructionSchema).min(1) }),
  ),
})

export type WebTemplate = z.infer<typeof webTemplateSchema>
export type WebLocator = z.infer<typeof webLocatorSchema>
export type WebInstruction = z.infer<typeof webInstructionSchema>
export type WebExecutionCachePayload = z.infer<
  typeof webExecutionCachePayloadSchema
>

export type WebAssertionDraft =
  | { kind: 'exists' | 'visible' | 'hidden'; selector: string; nth?: number }
  | {
      kind: 'text-equals' | 'text-contains' | 'value-equals'
      selector: string
      nth?: number
      expected: string
    }
  | {
      kind: 'count-equals'
      selector: string
      nth?: number
      expected: number | string
    }
  | { kind: 'url-equals'; expected: string }

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

export function parseObservedActionPayload(
  value: unknown,
): ObservedActionPayload | undefined {
  return observedActionPayloadSchema.safeParse(value).data
}

function addLiteral(segments: WebTemplate['segments'], literal: string): void {
  if (!literal) return
  const previous = segments.at(-1)
  if (previous && 'literal' in previous) previous.literal += literal
  else segments.push({ literal })
}

export function parameterizeWebValue(
  value: string,
  bindings: readonly ScenarioVariableBinding[],
): WebTemplate | undefined {
  const byValue = new Map<string, string>()
  for (const binding of bindings) {
    if (!binding.value) continue
    const previous = byValue.get(binding.value)
    if (
      previous &&
      previous !== binding.name &&
      value.includes(binding.value)
    ) {
      return undefined
    }
    byValue.set(binding.value, binding.name)
  }
  for (const binding of bindings) {
    if (!binding.value) continue
    const derivedValues = new Set([encodeURIComponent(binding.value)])
    if (binding.value.length >= 4) {
      derivedValues.add(binding.value.toLocaleLowerCase())
      derivedValues.add(binding.value.toLocaleUpperCase())
    }
    if (
      [...derivedValues].some(
        (derived) => derived !== binding.value && value.includes(derived),
      )
    ) {
      return undefined
    }
  }
  const candidates = [...byValue]
    .map(([runtimeValue, name]) => ({ runtimeValue, name }))
    .sort((left, right) => right.runtimeValue.length - left.runtimeValue.length)
  const segments: WebTemplate['segments'] = []
  let offset = 0
  while (offset < value.length) {
    let matchIndex = -1
    let match: (typeof candidates)[number] | undefined
    for (const candidate of candidates) {
      const index = value.indexOf(candidate.runtimeValue, offset)
      if (
        index >= 0 &&
        (matchIndex < 0 ||
          index < matchIndex ||
          (index === matchIndex &&
            candidate.runtimeValue.length > (match?.runtimeValue.length ?? 0)))
      ) {
        matchIndex = index
        match = candidate
      }
    }
    if (!match || matchIndex < 0) {
      addLiteral(segments, value.slice(offset))
      break
    }
    addLiteral(segments, value.slice(offset, matchIndex))
    segments.push({ variable: match.name })
    offset = matchIndex + match.runtimeValue.length
  }
  if (segments.length === 0) segments.push({ literal: value })
  return { segments }
}

export function bindWebTemplate(
  template: WebTemplate,
  bindings: readonly ScenarioVariableBinding[],
): string | undefined {
  const values = new Map(
    bindings.map((binding) => [binding.name, binding.value]),
  )
  let result = ''
  for (const segment of template.segments) {
    if ('literal' in segment) result += segment.literal
    else {
      const value = values.get(segment.variable)
      if (value === undefined) return undefined
      result += value
    }
  }
  return result
}

export function webInstructionVariables(
  instruction: WebInstruction,
): Set<string> {
  const variables = new Set<string>()
  referencedVariables(instruction, variables)
  return variables
}

export function stepVariableNames(step: ScenarioStep): string[] {
  const variables = new Set<string>()
  const collect = (value: string) => {
    for (const match of value.matchAll(/<([^>]+)>/g)) variables.add(match[1]!)
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
  return { selector: parameterized, ...(nth === undefined ? {} : { nth }) }
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
    if (draft.nth !== undefined) return undefined
    if (typeof draft.expected === 'number') {
      return { kind: draft.kind, locator, expected: draft.expected }
    }
    const expected = parameterizeWebValue(draft.expected, bindings)
    if (expected?.segments.length !== 1) return undefined
    const segment = expected.segments[0]!
    if ('literal' in segment) {
      const count = Number(segment.literal)
      return Number.isSafeInteger(count) && count >= 0
        ? { kind: draft.kind, locator, expected: count }
        : undefined
    }
    return { kind: draft.kind, locator, expected: segment }
  }
  if (!('expected' in draft)) return undefined
  const expected = parameterizeWebValue(draft.expected, bindings)
  return expected ? { kind: draft.kind, locator, expected } : undefined
}

export function compileObservedWebAction(
  payload: ObservedActionPayload,
  bindings: readonly ScenarioVariableBinding[],
): WebInstruction | undefined {
  const locator = locatorFrom(payload.selector, undefined, bindings)
  if (!locator) return undefined
  const method = payload.method ?? 'click'
  const args = payload.arguments ?? []
  if (method === 'click' && args.length === 0) return { kind: 'click', locator }
  if (method === 'hover' && args.length === 0) return { kind: 'hover', locator }
  if ((method === 'fill' || method === 'type') && args.length === 1) {
    const value = parameterizeWebValue(args[0]!, bindings)
    return value ? { kind: method, locator, value } : undefined
  }
  if (method === 'selectOption' && args.length > 0) {
    const values = args.map((value) => parameterizeWebValue(value, bindings))
    return values.every((value) => value !== undefined)
      ? { kind: 'select-option', locator, values: values as WebTemplate[] }
      : undefined
  }
  if (method === 'waitForSelector' && args.length === 1) {
    const state = args[0]
    if (
      state === 'attached' ||
      state === 'detached' ||
      state === 'visible' ||
      state === 'hidden'
    ) {
      return { kind: 'wait-for', locator, state }
    }
  }
  return undefined
}

function referencedVariables(value: unknown, variables: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) referencedVariables(item, variables)
    return
  }
  if (!value || typeof value !== 'object') return
  if (
    'variable' in value &&
    typeof (value as { variable?: unknown }).variable === 'string'
  ) {
    variables.add((value as { variable: string }).variable)
  }
  for (const item of Object.values(value)) referencedVariables(item, variables)
}

export function parseWebExecutionCachePayload(
  payload: unknown,
  requiredVariables: readonly string[],
): WebExecutionCachePayload | undefined {
  const parsed = webExecutionCachePayloadSchema.safeParse(payload)
  if (!parsed.success) return undefined
  const allowed = new Set(requiredVariables)
  const referenced = new Set<string>()
  referencedVariables(parsed.data, referenced)
  if ([...referenced].some((variable) => !allowed.has(variable)))
    return undefined
  return parsed.data
}

interface WebFingerprintInput {
  options: WebAdapterOptions
  behavior: WebAdapterBehavior
  fidelity: ResolvedFidelity
}

export function webTargetConfigurationFingerprint({
  options,
  behavior,
  fidelity,
}: WebFingerprintInput): string {
  const source = JSON.stringify({
    schemaVersion: 1,
    baseUrl: new URL(options.baseUrl).toString(),
    environment: options.browser?.environment ?? 'local',
    headless: options.browser?.headless ?? true,
    fidelity: {
      profile: fidelity.profile,
      tradeOffs: fidelity.tradeOffs,
    },
    navigationPolicy: behavior.navigationPolicy ?? 'delayed',
    navigationTimeoutMs:
      options.browser?.navigationTimeoutMs ?? defaultWebNavigationTimeoutMs,
    actionTimeoutMs: options.browser?.actTimeoutMs ?? defaultWebActionTimeoutMs,
  })
  return new Bun.CryptoHasher('sha256').update(source).digest('hex')
}
