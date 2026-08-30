import type { Scenario, Specification } from '@pickle-spec/spec'
import type { runScenario } from '../../../../index'
import { requiredValue } from '../../../../src/required-value'

export type TimedRunScenarioInput = Parameters<typeof runScenario>[0] & {
  now: () => Date
}

export type ScenarioRunResult = Awaited<
  ReturnType<typeof runScenario>
>['result']

export function finalAttempt(result: ScenarioRunResult) {
  return requiredValue(result.attempts.at(-1))
}

export const scenario: Scenario = {
  name: 'Complete a purchase',
  tags: [],
  steps: [
    { keyword: 'Given', text: 'a product is in the basket', type: 'context' },
    { keyword: 'Then', text: 'the purchase succeeds', type: 'outcome' },
  ],
}

export const specification: Specification = {
  name: 'Checkout',
  source: { uri: 'features/checkout.feature', language: 'en' },
  tags: [],
  scenarios: [scenario],
}
