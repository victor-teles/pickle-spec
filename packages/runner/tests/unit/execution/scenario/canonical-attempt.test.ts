import type { Scenario } from '@pickle-spec/spec'
import { describe, expect, test } from 'vitest'
import { runScenario } from '../../../../index'
import { requiredValue } from '../../../../src/required-value'
import { scenario, specification, type TimedRunScenarioInput } from './fixtures'

describe('runScenario', () => {
  test('records one canonical Scenario attempt with deterministic evidence timing and durable scope', async () => {
    const timestamps = [
      '2026-08-22T12:00:00.000Z',
      '2026-08-22T12:00:01.000Z',
      '2026-08-22T12:00:02.000Z',
      '2026-08-22T12:00:03.000Z',
      '2026-08-22T12:00:04.000Z',
      '2026-08-22T12:00:05.000Z',
    ]
    let timestampIndex = 0
    const outlinedScenario: Scenario = {
      ...scenario,
      id: 'scn-checkout-payment',
      examplesId: 'examples-payment-method',
      examplesRowId: 'row-credit-card',
    }
    const input: TimedRunScenarioInput = {
      specification,
      scenario: outlinedScenario,
      executionTargetProfile: {
        id: 'chrome',
        adapter: 'web',
        capabilities: ['screenshots'],
      },
      adapter: {
        async openSession() {
          return {
            async executeStep(step) {
              return {
                state: 'passed',
                resolvedActions: [{ description: `Performed: ${step.text}` }],
              }
            },
            async close() {},
          }
        },
      },
      now: () => new Date(requiredValue(timestamps[timestampIndex++])),
    }

    const run = await runScenario(input)
    const scope = {
      scenarioId: 'scn-checkout-payment',
      examplesRowId: 'row-credit-card',
      executionTargetProfileId: 'chrome',
      attempt: 1,
    }

    expect(run.events).toMatchObject([
      {
        schemaVersion: 2,
        sequence: 1,
        type: 'scenario-started',
        occurredAt: timestamps[0],
        scope,
      },
      {
        schemaVersion: 2,
        sequence: 2,
        type: 'step-started',
        occurredAt: timestamps[1],
        scope: { ...scope, stepIndex: 0 },
      },
      {
        schemaVersion: 2,
        sequence: 3,
        type: 'step-finished',
        occurredAt: timestamps[2],
        scope: { ...scope, stepIndex: 0 },
      },
      {
        schemaVersion: 2,
        sequence: 4,
        type: 'step-started',
        occurredAt: timestamps[3],
        scope: { ...scope, stepIndex: 1 },
      },
      {
        schemaVersion: 2,
        sequence: 5,
        type: 'step-finished',
        occurredAt: timestamps[4],
        scope: { ...scope, stepIndex: 1 },
      },
      {
        schemaVersion: 2,
        sequence: 6,
        type: 'scenario-finished',
        occurredAt: timestamps[5],
        scope,
        attempt: {
          attempt: 1,
          startedAt: timestamps[0],
          finishedAt: timestamps[5],
          durationMs: 5_000,
          state: 'passed',
        },
      },
    ])
    expect(run.result).toMatchObject({
      schemaVersion: 2,
      specification: {
        name: 'Checkout',
        uri: 'features/checkout.feature',
      },
      scenario: {
        id: 'scn-checkout-payment',
        name: 'Complete a purchase',
        examplesId: 'examples-payment-method',
        examplesRowId: 'row-credit-card',
      },
      executionTargetProfile: {
        id: 'chrome',
        adapter: 'web',
        capabilities: ['screenshots'],
      },
      state: 'passed',
      startedAt: timestamps[0],
      finishedAt: timestamps[5],
      durationMs: 5_000,
      attempts: [
        {
          attempt: 1,
          startedAt: timestamps[0],
          finishedAt: timestamps[5],
          durationMs: 5_000,
          state: 'passed',
          executionMode: 'adaptive',
          steps: [
            {
              index: 0,
              startedAt: timestamps[1],
              finishedAt: timestamps[2],
              durationMs: 1_000,
              state: 'passed',
              resolvedActions: [
                { description: 'Performed: a product is in the basket' },
              ],
            },
            {
              index: 1,
              startedAt: timestamps[3],
              finishedAt: timestamps[4],
              durationMs: 1_000,
              state: 'passed',
              resolvedActions: [
                { description: 'Performed: the purchase succeeds' },
              ],
            },
          ],
        },
      ],
    })
  })
})
