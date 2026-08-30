import { describe, expect, test } from 'vitest'
import type {
  ExecutionCacheAdapter,
  ExecutionTargetAdapter,
} from '../../../../index'
import { runScenario } from '../../../../index'
import { finalScenarioAttempt } from '../../../../src/execution/run-scenario'
import { requiredValue } from '../../../../src/required-value'
import { cacheRunInput, executionCache, memoryStore } from './fixtures'

describe('Execution cache lifecycle', () => {
  test('cache-only with a short prefix fails cache-miss without Adaptive', async () => {
    const { store } = memoryStore()
    let opened = 0
    const compiled: Array<string | undefined> = []
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession() {
        opened++
        return {
          async executeStep(_step, _signal, context) {
            const stepIndex = context?.stepIndex ?? 0
            if (stepIndex === 1) {
              return {
                state: 'failed' as const,
                resolvedActions: [],
              }
            }
            compiled[stepIndex] = 'confirm'
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            const operations = compiled.filter(
              (operation): operation is string => operation !== undefined,
            )
            return {
              inferenceCount: 1,
              replayRepresentation: {
                cacheable: true as const,
                adapterPayload: { operations },
                requiredVariables: [],
              },
            }
          },
          async close() {},
        }
      },
    }
    const runInput = cacheRunInput({ adapter, store })
    await runScenario(runInput)
    expect(opened).toBe(1)
    const cacheOnly = await runScenario({
      ...runInput,
      cachePolicy: 'cache-only',
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })
    expect(opened).toBe(1)
    expect(finalScenarioAttempt(cacheOnly.result)).toMatchObject({
      state: 'failed',
      cacheOutcome: 'miss',
      failureKind: 'cache-miss',
      inferenceCount: 0,
    })
  })

  test('uncacheable later step still publishes the compiled head', async () => {
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
              inferenceCount: 2,
              replayRepresentation: {
                cacheable: true as const,
                adapterPayload: { operations: ['confirm'] },
                requiredVariables: [],
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
      cacheOutcome: 'miss',
    })
    expect(JSON.parse(requiredValue(writes[0]))).toMatchObject({
      adapterPayload: { operations: ['confirm'] },
    })
  })

  test('sticky uncacheable does not wipe the compiled head', async () => {
    const { store, writes } = memoryStore()
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession(input) {
        return {
          async executeStep() {
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            const operations =
              input.mode === 'replay' || contextHasPrefix(input)
                ? ['confirm']
                : ['confirm']
            return {
              inferenceCount: input.mode === 'adaptive' ? 2 : 0,
              replayRepresentation: {
                cacheable: true as const,
                adapterPayload: { operations },
                requiredVariables: [],
              },
            }
          },
          async close() {},
        }
      },
    }
    function contextHasPrefix(input: { executionCache?: unknown }) {
      return input.executionCache !== undefined
    }
    const runInput = cacheRunInput({ adapter, store })
    await runScenario(runInput)
    const again = await runScenario({
      ...runInput,
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })
    expect(writes).toHaveLength(2)
    expect(JSON.parse(requiredValue(writes[0]))).toMatchObject({
      adapterPayload: { operations: ['confirm'] },
    })
    expect(JSON.parse(requiredValue(writes[1]))).toMatchObject({
      adapterPayload: { operations: ['confirm'] },
    })
    expect(finalScenarioAttempt(again.result).cacheOutcome).not.toBe(
      'uncacheable',
    )
  })

  test('Replay inapplicable step reseats Adaptive under prefer-cache', async () => {
    const { store } = memoryStore()
    const evaluations: Array<string | undefined> = []
    let divergeReplay = false
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession(input) {
        return {
          async executeStep(_step, _signal, context) {
            const evaluation = context?.evaluation ?? input.mode
            evaluations.push(evaluation)
            if (evaluation === 'replay' && divergeReplay) {
              return {
                state: 'failed' as const,
                replayDiverged: true,
                resolvedActions: [],
                message: 'cached step is not applicable',
              }
            }
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            return {
              inferenceCount: evaluations.includes('adaptive') ? 2 : 0,
              replayRepresentation: {
                cacheable: true as const,
                adapterPayload: {
                  operations: ['confirm', 'assert-receipt'],
                },
                requiredVariables: [],
              },
            }
          },
          async close() {},
        }
      },
    }
    const runInput = cacheRunInput({ adapter, store })
    await runScenario(runInput)
    divergeReplay = true
    evaluations.length = 0
    const reseated = await runScenario({
      ...runInput,
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })
    expect(evaluations).toEqual(['replay', 'adaptive', 'adaptive'])
    expect(finalScenarioAttempt(reseated.result)).toMatchObject({
      state: 'passed',
      executionMode: 'adaptive',
    })
    expect(reseated.events.map((event) => event.type)).toContain(
      'adaptive-fallback-started',
    )
  })

  test('scenario-session adapters write only on complete Scenario success', async () => {
    const { store, writes } = memoryStore()
    let failSecond = true
    const scenarioCache: ExecutionCacheAdapter<{ operations: string[] }> = {
      ...executionCache,
      prefixPolicy: { mixedReplay: false, write: 'complete-scenario-only' },
    }
    const adapter: ExecutionTargetAdapter = {
      executionCache: scenarioCache,
      async openSession() {
        return {
          async executeScenario() {
            if (failSecond) {
              return {
                stepExecutions: [
                  { state: 'passed' as const, resolvedActions: [] },
                  {
                    state: 'failed' as const,
                    resolvedActions: [],
                    message: 'failed',
                  },
                ],
              }
            }
            return {
              stepExecutions: [
                { state: 'passed' as const, resolvedActions: [] },
                { state: 'passed' as const, resolvedActions: [] },
              ],
            }
          },
          async complete() {
            if (failSecond) {
              return {
                inferenceCount: 1,
                replayRepresentation: {
                  cacheable: true as const,
                  adapterPayload: { operations: ['confirm'] },
                  requiredVariables: [],
                },
              }
            }
            return {
              inferenceCount: 2,
              replayRepresentation: {
                cacheable: true as const,
                adapterPayload: {
                  operations: ['confirm', 'assert-receipt'],
                },
                requiredVariables: [],
              },
            }
          },
          async close() {},
        }
      },
    }
    const runInput = cacheRunInput({ adapter, store })
    const failed = await runScenario(runInput)
    expect(failed.result.state).toBe('failed')
    expect(writes).toEqual([])
    failSecond = false
    const passed = await runScenario({
      ...runInput,
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })
    expect(passed.result.state).toBe('passed')
    expect(writes).toHaveLength(1)
    expect(JSON.parse(requiredValue(writes[0]))).toMatchObject({
      adapterPayload: { operations: ['confirm', 'assert-receipt'] },
    })
  })
})
