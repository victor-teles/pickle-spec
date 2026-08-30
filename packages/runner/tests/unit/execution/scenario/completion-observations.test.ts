import type { Scenario } from '@pickle-spec/spec'
import { describe, expect, test } from 'vitest'
import { runScenario } from '../../../../index'
import { requiredValue } from '../../../../src/required-value'
import { finalAttempt, scenario, specification } from './fixtures'

describe('runScenario', () => {
  test('attaches normalized observations to step and scenario completion events', async () => {
    const timestamps = [
      '2026-08-22T13:00:00.000Z',
      '2026-08-22T13:00:01.000Z',
      '2026-08-22T13:00:02.000Z',
      '2026-08-22T13:00:03.000Z',
    ]
    let timestampIndex = 0
    const singleStepScenario: Scenario = {
      id: 'scn-checkout-receipt',
      name: 'Capture the receipt',
      tags: [],
      steps: [
        {
          keyword: 'Then',
          text: 'the receipt appears',
          type: 'outcome',
        },
      ],
    }
    const run = await runScenario({
      specification,
      scenario: singleStepScenario,
      executionTargetProfile: {
        id: 'chrome',
        adapter: 'web',
        capabilities: ['screenshots'],
      },
      adapter: {
        async openSession() {
          return {
            async executeStep() {
              return {
                state: 'passed',
                resolvedActions: [{ description: 'Assert receipt on chrome' }],
                artifacts: [
                  {
                    kind: 'screenshot',
                    path: '/tmp/receipt.png',
                    mediaType: 'image/png',
                  },
                ],
                trace: [
                  {
                    occurredAt: '2026-08-22T13:00:01.500Z',
                    causalAt: '2026-08-22T13:00:01.250Z',
                    kind: 'browser-activity',
                    description: 'Captured receipt screenshot',
                  },
                ],
              }
            },
            async complete() {
              return { inferenceCount: 2 }
            },
            async close() {},
          }
        },
      },
      now: () => new Date(requiredValue(timestamps[timestampIndex++])),
    })

    const stepFinished = run.events.find(
      (event) => event.type === 'step-finished',
    )
    expect(stepFinished).toMatchObject({
      type: 'step-finished',
      observations: [
        {
          version: 1,
          kind: 'outcome',
          summary: 'Then the receipt appears passed',
          timing: {
            occurredAt: timestamps[2],
            precision: 'step-finish',
            startedAt: timestamps[1],
            finishedAt: timestamps[2],
            durationMs: 1_000,
          },
          outcome: { state: 'passed' },
        },
        {
          version: 1,
          kind: 'activity',
          summary: 'Captured receipt screenshot',
          timing: {
            occurredAt: '2026-08-22T13:00:01.500Z',
            precision: 'exact',
            startedAt: timestamps[1],
            finishedAt: timestamps[2],
            durationMs: 1_000,
            causalAt: '2026-08-22T13:00:01.250Z',
          },
          activity: {
            kind: 'browser-activity',
            description: 'Captured receipt screenshot',
          },
        },
        {
          version: 1,
          kind: 'artifact',
          summary: 'Captured screenshot',
          timing: {
            occurredAt: timestamps[2],
            precision: 'step-finish',
          },
          artifact: {
            kind: 'screenshot',
            path: '/tmp/receipt.png',
            mediaType: 'image/png',
          },
        },
      ],
    })

    const scenarioFinished = run.events.find(
      (event) => event.type === 'scenario-finished',
    )
    expect(scenarioFinished).toMatchObject({
      type: 'scenario-finished',
      observations: [
        {
          version: 1,
          kind: 'outcome',
          summary: 'Capture the receipt passed in adaptive mode',
          timing: {
            occurredAt: timestamps[3],
            precision: 'attempt-finish',
            startedAt: timestamps[0],
            finishedAt: timestamps[3],
            durationMs: 3_000,
          },
          versions: [
            {
              subject: 'contract',
              label: 'run-event-schema',
              value: '2',
            },
          ],
          outcome: { state: 'passed' },
          cost: { inferenceCount: 2 },
          execution: { mode: 'adaptive' },
        },
      ],
    })
  })

  test('records a runner Diagnostic entry when a logical session cannot be opened', async () => {
    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'unavailable' },
      adapter: {
        async openSession() {
          throw new Error('Execution target is unavailable')
        },
      },
    })

    expect(finalAttempt(run.result).diagnostics).toEqual([
      expect.objectContaining({
        level: 'error',
        origin: 'runner',
        message: 'Execution target is unavailable',
        scenarioName: 'Complete a purchase',
        executionTargetProfileId: 'unavailable',
      }),
    ])
    expect(run.events.map((event) => event.type)).toEqual([
      'scenario-started',
      'scenario-finished',
    ])
  })
})
