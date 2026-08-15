import { expect, mock, test } from 'bun:test'
import type { ScenarioSelection } from '@pickle-spec/spec'
import { type ExecutionTargetAdapter, runScenarios } from '../index'

const selections: ScenarioSelection[] = ['First', 'Ignored', 'Third'].map(
  (name, index) => {
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
  },
)

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
      async close() {
        active--
      },
    }
  })
  const adapter: ExecutionTargetAdapter = { openSession }

  const runs = await runScenarios({
    selections,
    executionTargetProfile: { id: 'web' },
    adapter,
    concurrency: 2,
  })

  expect(
    runs.map((run) => [run.result.scenario.name, run.result.state]),
  ).toEqual([
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

  await expect(
    runScenarios({
      selections: [
        {
          ...selection,
          scenario: {
            ...selection.scenario,
            capabilityRequirements: ['geolocation'],
          },
        },
      ],
      executionTargetProfile: { id: 'web' },
      adapter: { capabilities: ['screenshots'], openSession },
    }),
  ).rejects.toThrow(
    'Execution target profile "web" lacks required capabilities for Scenario "First": geolocation',
  )
  expect(openSession).not.toHaveBeenCalled()
})

test('produces one test result per Scenario and execution target profile', async () => {
  const webOpen = mock(async () => ({
    async executeStep() {
      return { state: 'passed' as const, resolvedActions: [] }
    },
    async close() {},
  }))
  const mobileOpen = mock(async () => ({
    async executeStep() {
      return { state: 'passed' as const, resolvedActions: [] }
    },
    async close() {},
  }))

  const runs = await runScenarios({
    selections: [selections[0]!, selections[2]!],
    targets: [
      {
        executionTargetProfile: {
          id: 'web',
          adapter: 'web',
          capabilities: ['screenshots'],
        },
        adapter: { capabilities: ['screenshots', 'web'], openSession: webOpen },
      },
      {
        executionTargetProfile: {
          id: 'android',
          adapter: 'android',
          capabilities: ['geolocation'],
        },
        adapter: {
          capabilities: ['geolocation'],
          openSession: mobileOpen,
        },
      },
    ],
  })

  expect(
    runs.map((run) => [
      run.result.scenario.name,
      run.result.executionTargetProfile.id,
      run.result.state,
    ]),
  ).toEqual([
    ['First', 'web', 'passed'],
    ['First', 'android', 'passed'],
    ['Third', 'web', 'passed'],
    ['Third', 'android', 'passed'],
  ])
  expect(webOpen).toHaveBeenCalledTimes(2)
  expect(mobileOpen).toHaveBeenCalledTimes(2)
})

test('fails validation for an incompatible target instead of skipping the Scenario', async () => {
  const openSession = mock(async () => {
    throw new Error('must not open')
  })

  await expect(
    runScenarios({
      selections: [
        {
          ...selections[0]!,
          scenario: {
            ...selections[0]!.scenario,
            capabilityRequirements: ['geolocation'],
          },
        },
      ],
      targets: [
        {
          executionTargetProfile: {
            id: 'web',
            adapter: 'web',
            capabilities: ['screenshots'],
          },
          adapter: { capabilities: ['screenshots', 'web'], openSession },
        },
        {
          executionTargetProfile: {
            id: 'android',
            adapter: 'android',
            capabilities: ['geolocation'],
          },
          adapter: { capabilities: ['geolocation'], openSession },
        },
      ],
    }),
  ).rejects.toThrow(
    'Execution target profile "web" lacks required capabilities for Scenario "First": geolocation',
  )
  expect(openSession).not.toHaveBeenCalled()
})
