import { describe, expect, mock, test } from 'bun:test'
import type { Scenario, Specification } from '@pickle-spec/spec'
import { runScenario, type ExecutionTargetAdapter } from '../index'

const scenario: Scenario = {
  name: 'Complete a purchase',
  tags: [],
  steps: [
    { keyword: 'Given', text: 'a product is in the basket' },
    { keyword: 'Then', text: 'the purchase succeeds' },
  ],
}

const specification: Specification = {
  name: 'Checkout',
  source: { uri: 'features/checkout.feature', language: 'en' },
  tags: [],
  scenarios: [scenario],
}

describe('runScenario', () => {
  test('emits versioned events and materializes a passed test result', async () => {
    const close = mock(async () => {})
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

    expect(run.events.map(event => [event.schemaVersion, event.sequence, event.type])).toEqual([
      [1, 1, 'scenario-started'],
      [1, 2, 'step-started'],
      [1, 3, 'step-finished'],
      [1, 4, 'step-started'],
      [1, 5, 'step-finished'],
      [1, 6, 'scenario-finished'],
    ])
    expect(run.result).toEqual({
      schemaVersion: 1,
      specification: {
        name: 'Checkout',
        uri: 'features/checkout.feature',
      },
      scenario: { name: 'Complete a purchase' },
      executionTargetProfile: { id: 'deterministic' },
      state: 'passed',
      steps: [
        {
          step: { keyword: 'Given', text: 'a product is in the basket' },
          state: 'passed',
          resolvedActions: [{ description: 'Performed: a product is in the basket' }],
        },
        {
          step: { keyword: 'Then', text: 'the purchase succeeds' },
          state: 'passed',
          resolvedActions: [{ description: 'Performed: the purchase succeeds' }],
        },
      ],
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('materializes a functional failure and stops the remaining steps', async () => {
    const executeStep = mock(async () => ({
      state: 'failed' as const,
      resolvedActions: [{ description: 'Checked basket contents' }],
      message: 'The basket was empty',
    }))
    const adapter: ExecutionTargetAdapter = {
      async openSession() {
        return { executeStep, close: async () => {} }
      },
    }

    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'deterministic' },
      adapter,
    })

    expect(run.result.state).toBe('failed')
    expect(run.result.message).toBe('The basket was empty')
    expect(run.result.steps).toHaveLength(1)
    expect(run.events.at(-1)).toMatchObject({
      schemaVersion: 1,
      type: 'scenario-finished',
      result: { state: 'failed' },
    })
    expect(executeStep).toHaveBeenCalledTimes(1)
  })

  test('materializes cancellation without opening a logical session when already aborted', async () => {
    const openSession = mock(async () => {
      throw new Error('must not open')
    })
    const controller = new AbortController()
    controller.abort()

    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'deterministic' },
      adapter: { openSession },
      signal: controller.signal,
    })

    expect(run.result).toMatchObject({
      schemaVersion: 1,
      state: 'cancelled',
      steps: [],
      message: 'Scenario cancelled before the logical session started',
    })
    expect(run.events.map(event => event.type)).toEqual([
      'scenario-started',
      'scenario-finished',
    ])
    expect(openSession).not.toHaveBeenCalled()
  })

  test('materializes cancellation when the signal aborts while a step resolves normally', async () => {
    const controller = new AbortController()
    const close = mock(async () => {})

    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'deterministic' },
      adapter: {
        async openSession() {
          return {
            async executeStep() {
              controller.abort()
              return {
                state: 'passed',
                resolvedActions: [{ description: 'Completed after cancellation' }],
              }
            },
            close,
          }
        },
      },
      signal: controller.signal,
    })

    expect(run.result).toMatchObject({
      state: 'cancelled',
      message: 'Scenario cancelled during step execution',
      steps: [{ state: 'cancelled' }],
    })
    expect(run.events.map(event => event.type)).toEqual([
      'scenario-started',
      'step-started',
      'step-finished',
      'scenario-finished',
    ])
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('materializes an infrastructure error when the adapter cannot open a logical session', async () => {
    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'unavailable-target' },
      adapter: {
        async openSession() {
          throw new Error('Execution target is unavailable')
        },
      },
    })

    expect(run.result).toMatchObject({
      schemaVersion: 1,
      executionTargetProfile: { id: 'unavailable-target' },
      state: 'infrastructure-error',
      steps: [],
      message: 'Execution target is unavailable',
    })
    expect(run.events.map(event => event.type)).toEqual([
      'scenario-started',
      'scenario-finished',
    ])
  })

  test('preserves a successful adaptation as the final result state', async () => {
    let step = 0
    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'deterministic' },
      adapter: {
        async openSession() {
          return {
            async executeStep() {
              step += 1
              return {
                state: step === 1 ? 'passed-with-adaptation' as const : 'passed' as const,
                resolvedActions: [{ description: 'Completed deterministic action' }],
              }
            },
            async close() {},
          }
        },
      },
    })

    expect(run.result.state).toBe('passed-with-adaptation')
    expect(run.result.steps).toHaveLength(2)
  })

  test('materializes an adapter exception during a step as an infrastructure error', async () => {
    const close = mock(async () => {})
    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'unstable-target' },
      adapter: {
        async openSession() {
          return {
            async executeStep() {
              throw new Error('Target connection was lost')
            },
            close,
          }
        },
      },
    })

    expect(run.result).toMatchObject({
      state: 'infrastructure-error',
      message: 'Target connection was lost',
      steps: [{ state: 'infrastructure-error', message: 'Target connection was lost' }],
    })
    expect(run.events.map(event => event.type)).toEqual([
      'scenario-started',
      'step-started',
      'step-finished',
      'scenario-finished',
    ])
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('materializes a logical-session close exception as an infrastructure error', async () => {
    const run = await runScenario({
      specification,
      scenario: { ...scenario, steps: scenario.steps.slice(0, 1) },
      executionTargetProfile: { id: 'unstable-target' },
      adapter: {
        async openSession() {
          return {
            async executeStep() {
              return { state: 'passed', resolvedActions: [] }
            },
            async close() {
              throw new Error('Could not release the logical session')
            },
          }
        },
      },
    })

    expect(run.result).toMatchObject({
      state: 'infrastructure-error',
      message: 'Could not release the logical session',
    })
    expect(run.events.at(-1)).toMatchObject({
      type: 'scenario-finished',
      result: { state: 'infrastructure-error' },
    })
  })
})
