import type { ScenarioSelection } from '@pickle-spec/spec'
import type { runScenarios } from '../../../../index'

export type TimedRunScenariosInput = Parameters<typeof runScenarios>[0] & {
  now: () => Date
}

export const selections: ScenarioSelection[] = [
  'First',
  'Ignored',
  'Third',
].map((name, index) => {
  const scenario = {
    name,
    tags: index === 1 ? ['@ignore'] : [],
    steps: [
      {
        keyword: 'Then',
        text: `${name} completes`,
        type: 'outcome' as const,
      },
    ],
  }
  return {
    specification: {
      name: 'Scheduling',
      source: { uri: 'features/scheduling.feature', language: 'en' },
      tags: [],
      scenarios: [scenario],
    },
    scenario,
  }
})
