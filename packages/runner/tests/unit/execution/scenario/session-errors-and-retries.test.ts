import { describe, expect, test, vi } from 'vitest'
import { runScenario } from '../../../../index'
import { scenario, specification } from './fixtures'

describe('runScenario', () => {
  test('materializes cancellation without opening a logical session when already aborted', async () => {
    const openSession = vi.fn(async () => {
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
      schemaVersion: 2,
      state: 'cancelled',
      attempts: [
        {
          steps: [],
          message: 'Scenario cancelled before the logical session started',
        },
      ],
    })
    expect(run.events.map((event) => event.type)).toEqual([
      'scenario-started',
      'scenario-finished',
    ])
    expect(openSession).not.toHaveBeenCalled()
  })

  test('materializes cancellation when the signal aborts while a step resolves normally', async () => {
    const controller = new AbortController()
    const close = vi.fn(async () => {})

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
      attempts: [
        {
          message: 'Scenario cancelled during step execution',
          steps: [{ state: 'cancelled' }],
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
      schemaVersion: 2,
      executionTargetProfile: { id: 'unavailable-target' },
      state: 'infrastructure-error',
      attempts: [
        {
          steps: [],
          message: 'Execution target is unavailable',
        },
      ],
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
      attempts: [{ message: 'Logical session isolation verification failed' }],
    })
  })

  test('materializes an adapter exception during a step as an infrastructure error', async () => {
    const close = vi.fn(async () => {})
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
      attempts: [
        {
          message: 'Target connection was lost',
          steps: [
            {
              state: 'infrastructure-error',
              message: 'Target connection was lost',
            },
          ],
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
})
