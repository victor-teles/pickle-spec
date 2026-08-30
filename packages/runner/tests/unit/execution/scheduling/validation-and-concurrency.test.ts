import type { ScenarioSelection } from '@pickle-spec/spec'
import { expect, test, vi } from 'vitest'
import { type ExecutionTargetAdapter, runScenarios } from '../../../../index'
import { requiredValue } from '../../../../src/required-value'
import { selections } from './fixtures'

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
      targets: [
        {
          executionTargetProfile: { id: 'web' },
          adapter: { capabilities: ['screenshots'], openSession },
        },
      ],
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
    targets: [{ executionTargetProfile: { id: 'web' }, adapter }],
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
