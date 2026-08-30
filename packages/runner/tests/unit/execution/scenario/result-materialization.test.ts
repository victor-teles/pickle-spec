import { describe, expect, test, vi } from 'vitest'
import { type ExecutionTargetAdapter, runScenario } from '../../../../index'
import { finalAttempt, scenario, specification } from './fixtures'

describe('runScenario', () => {
  test('emits versioned events and materializes a passed test result', async () => {
    const close = vi.fn(async () => {})
    const adapter: ExecutionTargetAdapter = {
      async openSession() {
        return {
          async executeStep(step) {
            return {
              state: 'passed',
              resolvedActions: [{ description: `Performed: ${step.text}` }],
            }
          },
          close,
        }
      },
    }

    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'deterministic' },
      adapter,
    })

    expect(
      run.events.map((event) => [
        event.schemaVersion,
        event.sequence,
        event.type,
      ]),
    ).toEqual([
      [2, 1, 'scenario-started'],
      [2, 2, 'step-started'],
      [2, 3, 'step-finished'],
      [2, 4, 'step-started'],
      [2, 5, 'step-finished'],
      [2, 6, 'scenario-finished'],
    ])
    expect(run.result).toMatchObject({
      schemaVersion: 2,
      specification: {
        name: 'Checkout',
        uri: 'features/checkout.feature',
      },
      scenario: { name: 'Complete a purchase' },
      executionTargetProfile: { id: 'deterministic' },
      state: 'passed',
      attempts: [
        {
          executionMode: 'adaptive',
          steps: [
            {
              step: {
                keyword: 'Given',
                text: 'a product is in the basket',
                type: 'context',
              },
              state: 'passed',
              resolvedActions: [
                { description: 'Performed: a product is in the basket' },
              ],
            },
            {
              step: {
                keyword: 'Then',
                text: 'the purchase succeeds',
                type: 'outcome',
              },
              state: 'passed',
              resolvedActions: [
                { description: 'Performed: the purchase succeeds' },
              ],
            },
          ],
        },
      ],
    })
    expect(typeof run.result.scenario.id).toBe('string')
    expect(run.result.durationMs).toBeGreaterThanOrEqual(0)
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('preserves adapter-reported evidence capture failures on the attempt', async () => {
    const run = await runScenario({
      specification,
      scenario,
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
                resolvedActions: [],
                evidenceAvailability: [
                  {
                    kind: 'screenshot',
                    state: 'capture-failed',
                    message: 'Screenshot capture failed',
                  },
                ],
              }
            },
            async close() {},
          }
        },
      },
    })

    expect(finalAttempt(run.result).evidenceAvailability).toContainEqual({
      kind: 'screenshot',
      state: 'capture-failed',
      message: 'Screenshot capture failed',
    })
  })

  test('copies adapter fidelityPolicy onto the test result', async () => {
    const adapter: ExecutionTargetAdapter = {
      fidelityPolicy: {
        profile: 'fast',
        tradeOffs: ['block-image', 'disable-animations'],
      },
      async openSession() {
        return {
          async executeStep(step) {
            return {
              state: 'passed',
              resolvedActions: [{ description: step.text }],
            }
          },
          close: async () => {},
        }
      },
    }

    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'web' },
      adapter,
    })

    expect(finalAttempt(run.result).fidelityPolicy).toEqual({
      profile: 'fast',
      tradeOffs: ['block-image', 'disable-animations'],
    })
  })
})
