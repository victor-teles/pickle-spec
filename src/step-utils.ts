import { z } from 'zod'
import { StepKeywordType } from '@cucumber/messages'
import type { PickleStep, Step, GherkinDocument } from '@cucumber/messages'

/**
 * Effective step type for dispatch: Context (Given), Action (When), Outcome (Then).
 */
export type EffectiveStepType = 'Context' | 'Action' | 'Outcome'

/**
 * Build a map from AST Step ID to its keyword and keyword type.
 */
export function buildStepInfoMap(document: GherkinDocument): Map<string, { keyword: string; type: EffectiveStepType }> {
  const map = new Map<string, { keyword: string; type: EffectiveStepType }>()

  if (!document.feature) return map

  function processSteps(steps: readonly Step[], previousType: EffectiveStepType = 'Context') {
    let lastEffective: EffectiveStepType = previousType
    for (const step of steps) {
      let effective: EffectiveStepType
      switch (step.keywordType) {
        case StepKeywordType.CONTEXT:
          effective = 'Context'
          break
        case StepKeywordType.ACTION:
          effective = 'Action'
          break
        case StepKeywordType.OUTCOME:
          effective = 'Outcome'
          break
        case StepKeywordType.CONJUNCTION:
        default:
          effective = lastEffective
          break
      }
      lastEffective = effective
      map.set(step.id, { keyword: step.keyword, type: effective })
    }
  }

  for (const child of document.feature.children) {
    if (child.background) {
      processSteps(child.background.steps)
    }
    if (child.scenario) {
      processSteps(child.scenario.steps)
    }
    if (child.rule) {
      for (const ruleChild of child.rule.children) {
        if (ruleChild.background) {
          processSteps(ruleChild.background.steps)
        }
        if (ruleChild.scenario) {
          processSteps(ruleChild.scenario.steps)
        }
      }
    }
  }

  return map
}

/**
 * Build prompt text for a step, including data table or doc string arguments.
 */
export function buildStepPrompt(step: PickleStep): string {
  let prompt = step.text

  if (step.argument?.dataTable) {
    const rows = step.argument.dataTable.rows
    if (rows.length > 0) {
      const headers = rows[0]!.cells.map(c => c.value)
      const dataRows = rows.slice(1)
      prompt += '\n\nWith the following data:\n'
      prompt += headers.join(' | ') + '\n'
      for (const row of dataRows) {
        prompt += row.cells.map(c => c.value).join(' | ') + '\n'
      }
    }
  }

  if (step.argument?.docString) {
    prompt += '\n\n' + step.argument.docString.content
  }

  return prompt
}

export const VerificationSchema = z.object({
  meetsExpectation: z.boolean().describe(
    'Whether the current page state matches the expected condition',
  ),
  actualState: z.string().describe(
    'Description of the actual state observed on the page',
  ),
})

/**
 * Multilingual regex to detect navigation patterns in step text.
 * Supports English, Portuguese, Spanish, and French.
 */
export const NAVIGATION_PATTERN = new RegExp(
  '(?:' +
    'I (?:am on|navigate to|visit|go to|open)' +               // English
    '|(?:eu )?(?:navego para|visito|abro|estou em)' +           // Portuguese
    '|(?:yo )?(?:navego a|visito|abro|estoy en)' +              // Spanish
    '|(?:je )?(?:navigue vers|visite|ouvre|suis sur)' +          // French
  ')' +
  '\\s+(?:(?:the|a|o|la|le|el|à)\\s+)?' +                      // optional articles
  '["\'"]?(.+?)["\'"]?\\s*$',                                   // capture target (non-greedy)
  'i',
)
