import { expect, mock, test } from 'bun:test'
import type { ScenarioSelection } from '@pickle-spec/spec'
import { runScenarios, type ExecutionTargetAdapter } from '../index'

const selections: ScenarioSelection[] = ['First', 'Ignored', 'Third'].map((name, index) => {
  const scenario = {
    name,
    tags: index === 1 ? ['@ignore'] : [],
    steps: [{ keyword: 'Then', text: `${name} completes`, type: 'outcome' as const }],
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

test('runs selected Scenarios concurrently while preserving stable test-result order', async () => {
  let active = 0
  let maximumActive = 0
  const openSession = mock(async () => {
    active++
    maximumActive = Math.max(maximumActive, active)
    return {
      async executeStep(step: { text: string }) {
        await Bun.sleep(step.text.startsWith('First') ? 20 : 1)
        return { state: 'passed' as const, resolvedActions: [] }
      },
      async close() { active-- },
    }
  })
  const adapter: ExecutionTargetAdapter = { openSession }

  const runs = await runScenarios({
    selections,
    executionTargetProfile: { id: 'web' },
    adapter,
    concurrency: 2,
  })

  expect(runs.map(run => [run.result.scenario.name, run.result.state])).toEqual([
    ['First', 'passed'],
    ['Ignored', 'skipped'],
    ['Third', 'passed'],
  ])
  expect(maximumActive).toBe(2)
  expect(openSession).toHaveBeenCalledTimes(2)
})

test('rejects a target that lacks a Scenario capability requirement before opening a session', async () => {
  const openSession = mock(async () => {
    throw new Error('must not open')
  })
  const selection = selections[0]!

  await expect(runScenarios({
    selections: [{
      ...selection,
      scenario: { ...selection.scenario, capabilityRequirements: ['geolocation'] },
    }],
    executionTargetProfile: { id: 'web' },
    adapter: { capabilities: ['screenshots'], openSession },
  })).rejects.toThrow(
    'Execution target profile "web" lacks required capabilities for Scenario "First": geolocation',
  )
  expect(openSession).not.toHaveBeenCalled()
})
