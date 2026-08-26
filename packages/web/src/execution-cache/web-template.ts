import type { ScenarioVariableBinding } from '@pickle-spec/spec'
import type { WebTemplate } from './web-cache-schema'

export interface WebValueProvenance {
  template: string
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
  provenance?: WebValueProvenance,
): WebTemplate | undefined {
  if (bindings.length > 0 && !provenance) return undefined
  const source = provenance?.template ?? value
  const bindingNames = new Set(bindings.map((binding) => binding.name))
  const segments: WebTemplate['segments'] = []
  let offset = 0

  for (const match of source.matchAll(/<([A-Za-z_][A-Za-z0-9_.-]*)>/g)) {
    const name = match[1]!
    if (!bindingNames.has(name)) return undefined
    addLiteral(segments, source.slice(offset, match.index))
    segments.push({ variable: name })
    offset = match.index + match[0].length
  }

  addLiteral(segments, source.slice(offset))
  if (segments.length === 0) segments.push({ literal: source })
  const template = { segments }
  return bindWebTemplate(template, bindings) === value ? template : undefined
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
    if ('literal' in segment) {
      result += segment.literal
      continue
    }
    const value = values.get(segment.variable)
    if (value === undefined) return undefined
    result += value
  }
  return result
}

export function appendWebTemplate(
  segments: WebTemplate['segments'],
  template: WebTemplate,
): void {
  for (const segment of template.segments) {
    if ('literal' in segment) addLiteral(segments, segment.literal)
    else segments.push(segment)
  }
}
