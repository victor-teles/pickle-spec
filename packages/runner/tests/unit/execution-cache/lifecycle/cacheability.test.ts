import type { Scenario } from '@pickle-spec/spec'
import { describe, expect, test, vi } from 'vitest'
import type { ExecutionTargetAdapter } from '../../../../index'
import { runScenario } from '../../../../index'
import { finalScenarioAttempt } from '../../../../src/execution/run-scenario'
import {
  cacheRunInput,
  completeOperations,
  executionCache,
  memoryStore,
  scenario,
} from './fixtures'

describe('Execution cache lifecycle', () => {
  test('keeps a passed but non-deterministic Scenario uncacheable', async () => {
    const { store, writes } = memoryStore()
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession() {
        return {
          async executeStep() {
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            return {
              inferenceCount: 3,
              replayRepresentation: {
                cacheable: false as const,
                reason: 'non-deterministic-assertion' as const,
              },
            }
          },
          async close() {},
        }
      },
    }
    const run = await runScenario(cacheRunInput({ adapter, store }))

    expect(finalScenarioAttempt(run.result)).toMatchObject({
      state: 'passed',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'non-deterministic-assertion',
      inferenceCount: 3,
    })
    expect(writes).toEqual([])
  })

  test('does not read or write cache without an application revision', async () => {
    const { store, writes } = memoryStore()
    const read = vi.fn(store.read.bind(store))
    store.read = read
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession() {
        return {
          async executeStep() {
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            return {
              inferenceCount: 1,
              replayRepresentation: {
                cacheable: true as const,
                adapterPayload: { operations: completeOperations },
                requiredVariables: [],
              },
            }
          },
          async close() {},
        }
      },
    }
    const run = await runScenario(
      cacheRunInput({ adapter, store, applicationRevision: null }),
    )

    expect(finalScenarioAttempt(run.result)).toMatchObject({
      state: 'passed',
      executionMode: 'adaptive',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'application-revision-missing',
    })
    expect(read).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  test('never writes a completed representation when session close fails', async () => {
    const { store, writes } = memoryStore()
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession() {
        return {
          async executeStep() {
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            return {
              inferenceCount: 1,
              replayRepresentation: {
                cacheable: true as const,
                adapterPayload: { operations: completeOperations },
                requiredVariables: [],
              },
            }
          },
          async close() {
            throw new Error('close failed')
          },
        }
      },
    }
    const run = await runScenario(cacheRunInput({ adapter, store }))

    expect(run.result.state).toBe('infrastructure-error')
    expect(writes).toEqual([])
  })

  test('writes only after the persisted representation completes and the session closes', async () => {
    const order: string[] = []
    const executedOperations: string[] = []
    const { store } = memoryStore()
    const originalWrite = store.write.bind(store)
    store.write = async (...args) => {
      order.push('write')
      expect(JSON.parse(args[0].source)).toMatchObject({
        adapterPayload: { operations: executedOperations },
      })
      return originalWrite(...args)
    }

    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession() {
        return {
          async executeStep(_step, _signal, context) {
            order.push('execute')
            executedOperations.push(
              context?.stepIndex === 0 ? 'confirm' : 'assert-receipt',
            )
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            order.push('complete')
            return {
              inferenceCount: 1,
              replayRepresentation: {
                cacheable: true as const,
                adapterPayload: { operations: [...executedOperations] },
                requiredVariables: [],
              },
            }
          },
          async close() {
            order.push('close')
          },
        }
      },
    }
    await runScenario(cacheRunInput({ adapter, store }))

    expect(order).toEqual(['execute', 'execute', 'complete', 'close', 'write'])
  })

  test('treats an Outline without separated bindings as uncacheable', async () => {
    const { store, writes } = memoryStore()
    const unsafeScenario: Scenario = {
      ...scenario,
      examplesRowId: 'rowunsafe000000',
    }
    const openSession = vi.fn(async () => ({
      async executeStep() {
        return { state: 'passed' as const, resolvedActions: [] }
      },
      async complete() {
        return {
          inferenceCount: 1,
          replayRepresentation: {
            cacheable: true as const,
            adapterPayload: { operations: ['bound-value'] },
            requiredVariables: [],
          },
        }
      },
      async close() {},
    }))

    const adapter: ExecutionTargetAdapter = { executionCache, openSession }
    const run = await runScenario(
      cacheRunInput({ adapter, store, selectedScenario: unsafeScenario }),
    )

    expect(openSession).toHaveBeenCalledTimes(1)
    expect(finalScenarioAttempt(run.result)).toMatchObject({
      state: 'passed',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'bound-parameter-value',
    })
    expect(writes).toEqual([])
  })
})
