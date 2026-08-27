import type { ScenarioVariableBinding } from '@pickle-spec/spec'
import {
  compileWebAssertion,
  parseObservedActionPayload,
  type WebAssertionDraft,
} from './web-cache-compilation'
import type { WebInstruction } from './web-cache-schema'

interface ObservedOutcome {
  description: string
  handle: unknown
}

function quotedExpectationTexts(prompt: string): string[] {
  return [...prompt.matchAll(/"([^"]+)"|'([^']+)'/g)].map(
    (match) => match[1] ?? match[2]!,
  )
}

function shownCount(prompt: string): string | undefined {
  return (
    prompt.match(/\b(?:show(?:s)?|display(?:s)?)\s+(\d+)\b/i)?.[1] ??
    prompt.match(/\b(\d+)\s+items?\b/i)?.[1]
  )
}

function takeQuotedExpectation(
  description: string,
  remaining: string[],
): string | undefined {
  const index = remaining.findIndex((text) =>
    description.toLowerCase().includes(text.toLowerCase()),
  )
  if (index >= 0) return remaining.splice(index, 1)[0]
  return remaining.shift()
}

function isControlVisibilityPrompt(prompt: string): boolean {
  if (/\b(?:hidden|not visible)\b/i.test(prompt)) return false
  if (!/\bvisible\b/i.test(prompt)) return false
  return /\b(?:fields?|inputs?|buttons?|checkboxes?|links?|menus?)\b/i.test(
    prompt,
  )
}

function outcomeDraftFor(
  selector: string,
  description: string,
  prompt: string,
  remainingTexts: string[],
): WebAssertionDraft {
  if (/\b(?:hidden|not visible)\b/i.test(prompt)) {
    takeQuotedExpectation(description, remainingTexts)
    return { kind: 'hidden', selector }
  }
  if (isControlVisibilityPrompt(prompt)) {
    takeQuotedExpectation(description, remainingTexts)
    return { kind: 'visible', selector }
  }
  const quoted = takeQuotedExpectation(description, remainingTexts)
  if (quoted) return { kind: 'text-contains', selector, expected: quoted }
  const count = shownCount(prompt)
  if (count) return { kind: 'text-contains', selector, expected: count }
  return { kind: 'visible', selector }
}

function literalExpected(instruction: WebInstruction): string | undefined {
  if (!('expected' in instruction)) return undefined
  const expected = instruction.expected
  if (typeof expected === 'number') return String(expected)
  if ('variable' in expected) return undefined
  const segment = expected.segments[0]
  return expected.segments.length === 1 && segment && 'literal' in segment
    ? segment.literal
    : undefined
}

function outcomeCountCovered(
  prompt: string,
  instructions: readonly WebInstruction[],
): boolean {
  const count = shownCount(prompt)
  if (!count) return true
  return instructions.some(
    (instruction) => literalExpected(instruction) === count,
  )
}

export function compileObservedOutcomes(
  actions: readonly ObservedOutcome[],
  prompt: string,
  bindings: readonly ScenarioVariableBinding[],
): WebInstruction[] | undefined {
  if (actions.length === 0) return undefined
  const remainingTexts = quotedExpectationTexts(prompt)
  const instructions: WebInstruction[] = []
  for (const action of actions) {
    const payload = parseObservedActionPayload(action.handle)
    if (!payload) return undefined
    const instruction = compileWebAssertion(
      outcomeDraftFor(
        payload.selector,
        action.description,
        prompt,
        remainingTexts,
      ),
      bindings,
    )
    if (!instruction) return undefined
    instructions.push(instruction)
  }
  return remainingTexts.length === 0 &&
    outcomeCountCovered(prompt, instructions)
    ? instructions
    : undefined
}
