import type { ScenarioSelection } from '@pickle-spec/spec'
import { expect, test } from 'vitest'
import {
  type ExecutionTargetAdapter,
  runScenarios,
  type TestResult,
} from '../../../../index'
import { requiredValue } from '../../../../src/required-value'
import { selections, type TimedRunScenariosInput } from './fixtures'

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
    targets: [{ executionTargetProfile: { id: 'web' }, adapter }],
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
    targets: [
      {
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
      },
    ],
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
