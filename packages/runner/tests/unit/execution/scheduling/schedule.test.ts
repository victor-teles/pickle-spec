import { expect, test, vi } from 'vitest'
import {
  type ExecutionTargetAdapter,
  runScenarios,
  scheduleScenarios,
} from '../../../../index'
import { requiredValue } from '../../../../src/required-value'
import { selections } from './fixtures'

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
    targets: [{ executionTargetProfile: { id: 'web' }, adapter }],
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
