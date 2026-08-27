import type { ScenarioStep } from '@pickle-spec/spec'

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

export function promptFor(step: ScenarioStep): string {
  let prompt = step.text
  if (step.argument?.dataTable) {
    prompt += '\n\nWith the following data:\n'
    prompt += step.argument.dataTable.map((row) => row.join(' | ')).join('\n')
  }
  if (step.argument?.docString) prompt += `\n\n${step.argument.docString}`
  return prompt
}

export function observeInstruction(step: ScenarioStep): string {
  const prompt = promptFor(step)
  if (step.type === 'outcome') {
    return (
      'Find the elements, by type and visible label, that confirm this ' +
      `expectation. Do not click or type. Expectation: ${prompt}`
    )
  }
  return `Find the controls, by type and visible label, needed to: ${prompt}`
}

export function navigationTarget(prompt: string): string | undefined {
  return prompt.match(navigationPattern)?.[1]?.trim()
}

export function navigationUrl(baseUrl: string, target: string): string {
  if (/^https?:\/\//i.test(target)) return target
  if (target.startsWith('/')) return new URL(target, baseUrl).toString()
  return baseUrl
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
