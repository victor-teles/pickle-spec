import { expect, mock, test } from 'bun:test'
import type { ScenarioSelection } from '@pickle-spec/spec'
import {
  type ExecutionTargetAdapter,
  runScenarios,
  scheduleScenarios,
} from '../index'

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

test('schedules Scenario results in declaration and configured profile order', () => {
  const schedule = scheduleScenarios({
    selections: [selections[0]!, selections[2]!],
    executionTargetProfiles: [{ id: 'web' }, { id: 'android' }],
    includeTarget: (selection, executionTargetProfile) =>
      !(
        selection.scenario.name === 'Third' &&
        executionTargetProfile.id === 'android'
      ),
  })

  expect(
    schedule.map(({ scenario, executionTargetProfile }) => [
      scenario.name,
      executionTargetProfile.id,
    ]),
  ).toEqual([
    ['First', 'web'],
    ['First', 'android'],
    ['Third', 'web'],
  ])
})

test('keeps Scenario Outline rows unambiguous in the public schedule', () => {
  const outlineSelections = ['row-a', 'row-b'].map((examplesRowId) => ({
    specification: selections[0]!.specification,
    scenario: {
      ...selections[0]!.scenario,
      id: 'shared-scenario',
      name: `Bound ${examplesRowId}`,
      examplesId: 'examples-a',
      examplesRowId,
      template: {
        name: 'Bound <value>',
        steps: selections[0]!.scenario.steps,
        variableNames: ['value'],
      },
      runtimeBindings: [{ name: 'value', value: examplesRowId }],
    },
  }))

  const schedule = scheduleScenarios({
    selections: outlineSelections,
    executionTargetProfiles: [{ id: 'web' }],
  })

  expect(schedule.map((item) => item.scenario)).toEqual([
    {
      id: 'shared-scenario',
      name: 'Bound <value>',
      examplesId: 'examples-a',
      examplesRowId: 'row-a',
    },
    {
      id: 'shared-scenario',
      name: 'Bound <value>',
      examplesId: 'examples-a',
      examplesRowId: 'row-b',
    },
  ])
})

test('reports one final completion after retry attempt events', async () => {
  let attempt = 0
  const attemptStates: string[] = []
  const completedResults: Array<{ state: string; attempts?: number }> = []
  const adapter: ExecutionTargetAdapter = {
    async openSession() {
      attempt++
      return {
        async executeStep() {
          if (attempt === 1) throw new Error('Execution target stopped')
          return { state: 'passed', resolvedActions: [] }
        },
        async close() {},
      }
    },
  }

  await runScenarios({
    selections: [selections[0]!],
    executionTargetProfile: { id: 'web' },
    adapter,
    retry: { infrastructureErrors: 1 },
    onEvent(event) {
      if (event.type === 'scenario-finished') {
        attemptStates.push(event.result.state)
      }
    },
    onResult({ result }) {
      completedResults.push({ state: result.state, attempts: result.attempts })
    },
  })

  expect(attemptStates).toEqual(['infrastructure-error', 'passed'])
  expect(completedResults).toEqual([{ state: 'passed', attempts: 2 }])
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

test('applies one global concurrency limit across Scenarios from multiple feature files', async () => {
  let active = 0
  let maximumActive = 0
  const openSession = mock(async () => {
    active++
    maximumActive = Math.max(maximumActive, active)
    return {
      async executeStep(step: { text: string }) {
        await Bun.sleep(step.text.includes('slow') ? 30 : 1)
        return { state: 'passed' as const, resolvedActions: [] }
      },
      async close() {
        active--
      },
    }
  })
  const adapter: ExecutionTargetAdapter = { openSession }

  const crossFileSelections: ScenarioSelection[] = [
    {
      specification: {
        name: 'Checkout',
        source: { uri: 'features/checkout.feature', language: 'en' },
        tags: [],
        scenarios: [],
      },
      scenario: {
        name: 'slow checkout',
        tags: [],
        steps: [
          {
            keyword: 'Then',
            text: 'slow checkout completes',
            type: 'outcome' as const,
          },
        ],
      },
    },
    {
      specification: {
        name: 'Search',
        source: { uri: 'features/search.feature', language: 'en' },
        tags: [],
        scenarios: [],
      },
      scenario: {
        name: 'fast search',
        tags: [],
        steps: [
          {
            keyword: 'Then',
            text: 'fast search completes',
            type: 'outcome' as const,
          },
        ],
      },
    },
    {
      specification: {
        name: 'Account',
        source: { uri: 'features/account.feature', language: 'en' },
        tags: [],
        scenarios: [],
      },
      scenario: {
        name: 'slow account',
        tags: [],
        steps: [
          {
            keyword: 'Then',
            text: 'slow account completes',
            type: 'outcome' as const,
          },
        ],
      },
    },
  ]

  const runs = await runScenarios({
    selections: crossFileSelections,
    executionTargetProfile: { id: 'web' },
    adapter,
    concurrency: 2,
  })

  expect(
    runs.map((run) => [
      run.result.specification.uri,
      run.result.scenario.name,
      run.result.state,
    ]),
  ).toEqual([
    ['features/checkout.feature', 'slow checkout', 'passed'],
    ['features/search.feature', 'fast search', 'passed'],
    ['features/account.feature', 'slow account', 'passed'],
  ])
  expect(maximumActive).toBe(2)
  expect(openSession).toHaveBeenCalledTimes(3)
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
