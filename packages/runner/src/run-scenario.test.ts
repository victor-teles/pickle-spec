import { describe, expect, mock, test } from 'bun:test'
import type { Scenario, Specification } from '@pickle-spec/spec'
import {
  type ExecutionTargetAdapter,
  type OpenSessionInput,
  runScenario,
} from '../index'

const scenario: Scenario = {
  name: 'Complete a purchase',
  tags: [],
  steps: [
    { keyword: 'Given', text: 'a product is in the basket', type: 'context' },
    { keyword: 'Then', text: 'the purchase succeeds', type: 'outcome' },
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

    expect(
      run.events.map((event) => [
        event.schemaVersion,
        event.sequence,
        event.type,
      ]),
    ).toEqual([
      [1, 1, 'scenario-started'],
      [1, 2, 'step-started'],
      [1, 3, 'step-finished'],
      [1, 4, 'step-started'],
      [1, 5, 'step-finished'],
      [1, 6, 'scenario-finished'],
    ])
    expect(run.result).toMatchObject({
      schemaVersion: 1,
      specification: {
        name: 'Checkout',
        uri: 'features/checkout.feature',
      },
      scenario: { name: 'Complete a purchase' },
      executionTargetProfile: { id: 'deterministic' },
      state: 'passed',
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
    })
    expect(run.result.scenario.id).toBeString()
    expect(run.result.durationMs).toBeGreaterThanOrEqual(0)
    expect(close).toHaveBeenCalledTimes(1)
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

    expect(run.result.fidelityPolicy).toEqual({
      profile: 'fast',
      tradeOffs: ['block-image', 'disable-animations'],
    })
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
    expect(run.events.map((event) => event.type)).toEqual([
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
                resolvedActions: [
                  { description: 'Completed after cancellation' },
                ],
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
    expect(run.events.map((event) => event.type)).toEqual([
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
    expect(run.events.map((event) => event.type)).toEqual([
      'scenario-started',
      'scenario-finished',
    ])
  })

  test('materializes isolation verification failure as an infrastructure error', async () => {
    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'web' },
      adapter: {
        async openSession() {
          throw new Error('Logical session isolation verification failed')
        },
      },
      retry: { infrastructureErrors: 0 },
    })

    expect(run.result).toMatchObject({
      state: 'infrastructure-error',
      message: 'Logical session isolation verification failed',
    })
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
      steps: [
        {
          state: 'infrastructure-error',
          message: 'Target connection was lost',
        },
      ],
    })
    expect(run.events.map((event) => event.type)).toEqual([
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

  test('retries infrastructure errors in a fresh logical session and marks later success flaky', async () => {
    let attempt = 0
    const close = mock(async () => {})
    const openSession = mock(async () => {
      attempt++
      return {
        async executeStep() {
          if (attempt === 1) throw new Error('Browser process exited')
          return { state: 'passed' as const, resolvedActions: [] }
        },
        close,
      }
    })

    const run = await runScenario({
      specification,
      scenario: { ...scenario, steps: scenario.steps.slice(0, 1) },
      executionTargetProfile: { id: 'web' },
      adapter: { openSession },
      retry: { infrastructureErrors: 1 },
    })

    expect(run.result).toMatchObject({
      state: 'passed',
      attempts: 2,
      flaky: true,
    })
    expect(openSession).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(2)
  })

  test('retries functional failures only when explicit policy allows it', async () => {
    let attempt = 0
    const close = mock(async () => {})
    const openSession = mock(async () => {
      attempt++
      return {
        async executeStep() {
          if (attempt === 1) {
            return {
              state: 'failed' as const,
              resolvedActions: [],
              message: 'Product behavior failed',
            }
          }
          return { state: 'passed' as const, resolvedActions: [] }
        },
        close,
      }
    })

    const withoutPolicy = await runScenario({
      specification,
      scenario: { ...scenario, steps: scenario.steps.slice(0, 1) },
      executionTargetProfile: { id: 'web' },
      adapter: { openSession },
      retry: { infrastructureErrors: 0, functionalFailures: 0 },
    })
    expect(withoutPolicy.result.state).toBe('failed')
    expect(openSession).toHaveBeenCalledTimes(1)

    attempt = 0
    openSession.mockClear()
    close.mockClear()

    const withPolicy = await runScenario({
      specification,
      scenario: { ...scenario, steps: scenario.steps.slice(0, 1) },
      executionTargetProfile: { id: 'web' },
      adapter: { openSession },
      retry: { infrastructureErrors: 0, functionalFailures: 1 },
    })
    expect(withPolicy.result).toMatchObject({
      state: 'passed',
      attempts: 2,
      flaky: true,
    })
    expect(openSession).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(2)
  })

  test('aborts a timed-out step and closes its logical session', async () => {
    const close = mock(async () => {})
    const run = await runScenario({
      specification,
      scenario: { ...scenario, steps: scenario.steps.slice(0, 1) },
      executionTargetProfile: { id: 'web' },
      adapter: {
        async openSession() {
          return {
            async executeStep(_step, signal) {
              await new Promise((_resolve, reject) => {
                signal?.addEventListener(
                  'abort',
                  () => reject(new DOMException('Aborted', 'AbortError')),
                  {
                    once: true,
                  },
                )
              })
              return { state: 'passed', resolvedActions: [] }
            },
            close,
          }
        },
      },
      timeout: { stepMs: 5 },
    })

    expect(run.result).toMatchObject({
      state: 'infrastructure-error',
      message: 'Step exceeded its 5ms deadline',
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('runs a custom adapter only in Adaptive and rejects cache-only before opening', async () => {
    const openSession = mock(async (input: OpenSessionInput) => ({
      async executeStep() {
        return { state: 'passed' as const, resolvedActions: [] }
      },
      async close() {},
      mode: input.mode,
    }))
    const adapter: ExecutionTargetAdapter = { openSession }
    const input = {
      specification,
      scenario,
      executionTargetProfile: { id: 'custom' },
      adapter,
    }

    const adaptive = await runScenario(input)
    const cacheOnly = await runScenario({ ...input, cachePolicy: 'cache-only' })

    expect(adaptive.result).toMatchObject({
      state: 'passed',
      executionMode: 'adaptive',
    })
    expect(cacheOnly.result).toMatchObject({
      state: 'failed',
      executionMode: 'replay',
      failureKind: 'cache-miss',
      inferenceCount: 0,
    })
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(openSession).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'adaptive' }),
    )
  })
})
