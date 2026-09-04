import { describe, expect, test, vi } from 'vitest'
import {
  type ExecutionTargetAdapter,
  type OpenSessionInput,
  runScenario,
} from '../../../../index'
import { scenario, specification } from './fixtures'

describe('runScenario', () => {
  test('keeps an executeScenario infrastructure error when complete cannot run', async () => {
    const complete = vi.fn(async () => {
      throw new Error('Mobile logical session did not execute')
    })
    const close = vi.fn(async () => {})
    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'android' },
      adapter: {
        async openSession() {
          return {
            async executeScenario() {
              throw new Error(
                'Agent Device Replay called a semantic inference route outside replay.run',
              )
            },
            complete,
            close,
          }
        },
      },
    })

    expect(run.result).toMatchObject({
      state: 'infrastructure-error',
      attempts: [
        {
          message:
            'Agent Device Replay called a semantic inference route outside replay.run',
        },
      ],
    })
    expect(complete).not.toHaveBeenCalled()
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
      attempts: [{ message: 'Could not release the logical session' }],
    })
    expect(run.events.at(-1)).toMatchObject({
      type: 'scenario-finished',
      attempt: { state: 'infrastructure-error' },
    })
  })

  test('retries infrastructure errors in a fresh logical session and marks later success flaky', async () => {
    let attempt = 0
    const close = vi.fn(async () => {})
    const openSession = vi.fn(async () => {
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
      attempts: [
        { attempt: 1, state: 'infrastructure-error' },
        { attempt: 2, state: 'passed' },
      ],
      flaky: true,
    })
    expect(openSession).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(2)
  })

  test('retries functional failures only when explicit policy allows it', async () => {
    let attempt = 0
    const close = vi.fn(async () => {})
    const openSession = vi.fn(async () => {
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

    const withPolicy = await runScenario({
      specification,
      scenario: { ...scenario, steps: scenario.steps.slice(0, 1) },
      executionTargetProfile: { id: 'web' },
      adapter: { openSession },
      retry: { infrastructureErrors: 0, functionalFailures: 1 },
    })
    expect(withPolicy.result).toMatchObject({
      state: 'passed',
      attempts: [
        { attempt: 1, state: 'failed' },
        { attempt: 2, state: 'passed' },
      ],
      flaky: true,
    })
    expect(openSession).toHaveBeenCalledTimes(3)
    expect(close).toHaveBeenCalledTimes(3)
  })

  test('aborts a timed-out step and closes its logical session', async () => {
    const close = vi.fn(async () => {})
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
      attempts: [{ message: 'Step exceeded its 5ms deadline' }],
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('runs a custom adapter only in Adaptive and rejects cache-only before opening', async () => {
    const openSession = vi.fn(async (sessionInput: OpenSessionInput) => ({
      async executeStep() {
        return { state: 'passed' as const, resolvedActions: [] }
      },
      async close() {},
      mode: sessionInput.mode,
    }))
    const adapter: ExecutionTargetAdapter = { openSession }
    const runInput = {
      specification,
      scenario,
      executionTargetProfile: { id: 'custom' },
      adapter,
    }

    const adaptive = await runScenario(runInput)
    const cacheOnly = await runScenario({
      ...runInput,
      cachePolicy: 'cache-only',
    })

    expect(adaptive.result).toMatchObject({
      state: 'passed',
      attempts: [{ executionMode: 'adaptive' }],
    })
    expect(cacheOnly.result).toMatchObject({
      state: 'failed',
      attempts: [
        {
          executionMode: 'replay',
          failureKind: 'cache-miss',
          inferenceCount: 0,
        },
      ],
    })
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(openSession).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'adaptive' }),
    )
  })
})
