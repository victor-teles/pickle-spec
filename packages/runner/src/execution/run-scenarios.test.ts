import type { ScenarioSelection } from '@pickle-spec/spec'
import { expect, test, vi } from 'vitest'
import {
  type ExecutionTargetAdapter,
  runScenarios,
  scheduleScenarios,
  type TestResult,
} from '../../index'
import { requiredValue } from '../required-value'

type TimedRunScenariosInput = Parameters<typeof runScenarios>[0] & {
  now: () => Date
}

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
  const openSession = vi.fn(async () => {
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
    selections: [requiredValue(selections[0]), requiredValue(selections[2])],
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
    specification: requiredValue(selections[0]).specification,
    scenario: {
      ...requiredValue(selections[0]).scenario,
      id: 'shared-scenario',
      name: `Bound ${examplesRowId}`,
      examplesId: 'examples-a',
      examplesRowId,
      template: {
        name: 'Bound <value>',
        steps: requiredValue(selections[0]).scenario.steps,
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
  const completedResults: Array<{ state: string; attempts: number }> = []
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
    selections: [requiredValue(selections[0])],
    executionTargetProfile: { id: 'web' },
    adapter,
    retry: { infrastructureErrors: 1 },
    onEvent(event) {
      if (event.type === 'scenario-finished') {
        attemptStates.push(event.attempt.state)
      }
    },
    onResult({ result }) {
      completedResults.push({
        state: result.state,
        attempts: result.attempts.length,
      })
    },
  })

  expect(attemptStates).toEqual(['infrastructure-error', 'passed'])
  expect(completedResults).toEqual([{ state: 'passed', attempts: 2 }])
})

test('aggregates separate Scenario attempts into one final flaky Test result', async () => {
  const timestamps = [
    '2026-08-22T13:00:00.000Z',
    '2026-08-22T13:00:01.000Z',
    '2026-08-22T13:00:02.000Z',
    '2026-08-22T13:00:03.000Z',
    '2026-08-22T13:00:04.000Z',
    '2026-08-22T13:00:05.000Z',
    '2026-08-22T13:00:06.000Z',
    '2026-08-22T13:00:07.000Z',
  ]
  let timestampIndex = 0
  let openedSessionCount = 0
  const finishedAttemptEvents: unknown[] = []
  const completedResults: TestResult[] = []
  const selection: ScenarioSelection = {
    specification: requiredValue(selections[0]).specification,
    scenario: {
      ...requiredValue(selections[0]).scenario,
      id: 'scn-scheduled-first',
      examplesId: 'examples-scheduled',
      examplesRowId: 'row-scheduled-first',
    },
  }
  const input: TimedRunScenariosInput = {
    selections: [selection],
    executionTargetProfile: {
      id: 'chrome',
      adapter: 'web',
      capabilities: ['screenshots'],
    },
    adapter: {
      async openSession() {
        openedSessionCount++
        return {
          async executeStep() {
            if (openedSessionCount === 1) {
              throw new Error('Execution target stopped')
            }
            return { state: 'passed', resolvedActions: [] }
          },
          async close() {},
        }
      },
    },
    retry: { infrastructureErrors: 1 },
    now: () => new Date(requiredValue(timestamps[timestampIndex++])),
    onEvent(event) {
      if (event.type === 'scenario-finished') {
        finishedAttemptEvents.push(event)
      }
    },
    onResult({ result }) {
      completedResults.push(result)
    },
  }

  const runs = await runScenarios(input)
  const scope = {
    scenarioId: 'scn-scheduled-first',
    examplesRowId: 'row-scheduled-first',
    executionTargetProfileId: 'chrome',
  }

  expect(finishedAttemptEvents).toMatchObject([
    {
      schemaVersion: 2,
      occurredAt: timestamps[3],
      scope: { ...scope, attempt: 1 },
      attempt: {
        attempt: 1,
        startedAt: timestamps[0],
        finishedAt: timestamps[3],
        durationMs: 3_000,
        state: 'infrastructure-error',
        steps: [
          {
            index: 0,
            startedAt: timestamps[1],
            finishedAt: timestamps[2],
            durationMs: 1_000,
            state: 'infrastructure-error',
          },
        ],
      },
    },
    {
      schemaVersion: 2,
      occurredAt: timestamps[7],
      scope: { ...scope, attempt: 2 },
      attempt: {
        attempt: 2,
        startedAt: timestamps[4],
        finishedAt: timestamps[7],
        durationMs: 3_000,
        state: 'passed',
        steps: [
          {
            index: 0,
            startedAt: timestamps[5],
            finishedAt: timestamps[6],
            durationMs: 1_000,
            state: 'passed',
          },
        ],
      },
    },
  ])
  expect(completedResults).toHaveLength(1)
  expect(completedResults[0]).toMatchObject({
    schemaVersion: 2,
    scenario: {
      id: 'scn-scheduled-first',
      examplesId: 'examples-scheduled',
      examplesRowId: 'row-scheduled-first',
    },
    executionTargetProfile: {
      id: 'chrome',
      adapter: 'web',
      capabilities: ['screenshots'],
    },
    state: 'passed',
    flaky: true,
    startedAt: timestamps[0],
    finishedAt: timestamps[7],
    durationMs: 7_000,
    attempts: [
      {
        attempt: 1,
        state: 'infrastructure-error',
        startedAt: timestamps[0],
        finishedAt: timestamps[3],
      },
      {
        attempt: 2,
        state: 'passed',
        startedAt: timestamps[4],
        finishedAt: timestamps[7],
      },
    ],
  })
  expect(runs).toHaveLength(1)
  expect(runs[0]?.result).toEqual(completedResults[0])
})

test('rejects a target that lacks a Scenario capability requirement before opening a session', async () => {
  const openSession = vi.fn(async () => {
    throw new Error('must not open')
  })
  const selection = requiredValue(selections[0])

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
  const openSession = vi.fn(async () => {
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
  const webOpen = vi.fn(async () => ({
    async executeStep() {
      return { state: 'passed' as const, resolvedActions: [] }
    },
    async close() {},
  }))
  const mobileOpen = vi.fn(async () => ({
    async executeStep() {
      return { state: 'passed' as const, resolvedActions: [] }
    },
    async close() {},
  }))

  const runs = await runScenarios({
    selections: [requiredValue(selections[0]), requiredValue(selections[2])],
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
  const openSession = vi.fn(async () => {
    throw new Error('must not open')
  })

  await expect(
    runScenarios({
      selections: [
        {
          ...requiredValue(selections[0]),
          scenario: {
            ...requiredValue(selections[0]).scenario,
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
