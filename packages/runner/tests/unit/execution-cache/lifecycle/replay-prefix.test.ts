import { describe, expect, test } from 'vitest'
import type { ExecutionTargetAdapter, TargetSession } from '../../../../index'
import { runScenario } from '../../../../index'
import { finalScenarioAttempt } from '../../../../src/execution/run-scenario'
import { requiredValue } from '../../../../src/required-value'
import {
  cacheRunInput,
  completeOperations,
  denseCompiledHead,
  executionCache,
  localStore,
  memoryStore,
  prefixRepresentation,
} from './fixtures'

describe('Execution cache lifecycle', () => {
  test('preserves a divergent entry until Adaptive fallback can replace it', async () => {
    const { store, writes } = memoryStore()
    const modes: string[] = []
    let adaptiveAttempt = 0
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession(input) {
        modes.push(input.mode ?? 'adaptive')
        if (input.mode === 'adaptive') adaptiveAttempt++
        return {
          async executeStep() {
            if (input.mode === 'replay') {
              return {
                state: 'failed' as const,
                replayDiverged: true,
                resolvedActions: [],
              }
            }
            return {
              state:
                adaptiveAttempt === 1
                  ? ('passed' as const)
                  : ('failed' as const),
              resolvedActions: [],
            }
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
    const runInput = cacheRunInput({ adapter, store })

    await runScenario(runInput)
    const failedFallback = await runScenario({
      ...runInput,
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })
    const cacheOnly = await runScenario({
      ...runInput,
      cachePolicy: 'cache-only',
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-3' },
    })

    expect(failedFallback.result.state).toBe('failed')
    expect(finalScenarioAttempt(cacheOnly.result)).toMatchObject({
      state: 'failed',
      cacheOutcome: 'hit',
      failureKind: 'cache-miss',
    })
    expect(modes).toEqual(['adaptive', 'replay', 'replay'])
    expect(writes).toHaveLength(1)
  })

  test('rejects a runtime session that exposes both execution seams', async () => {
    const { store, writes } = memoryStore()
    const invalidSession = {
      async executeStep() {
        return { state: 'passed' as const, resolvedActions: [] }
      },
      async executeScenario() {
        return { stepExecutions: [] }
      },
      async close() {},
    } as unknown as TargetSession

    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession() {
        return invalidSession
      },
    }
    const run = await runScenario(cacheRunInput({ adapter, store }))

    expect(finalScenarioAttempt(run.result)).toMatchObject({
      state: 'infrastructure-error',
      message:
        'Target session must provide exactly one of executeStep or executeScenario',
    })
    expect(writes).toEqual([])
  })

  test('failed Adaptive still publishes the compiled head for mixed Replay', async () => {
    const { store, writes } = memoryStore()
    let failAt = 1
    const evaluations: Array<string | undefined> = []
    const compiled: Array<string | undefined> = []
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession(input) {
        return {
          async executeStep(_step, _signal, context) {
            evaluations.push(context?.evaluation ?? input.mode)
            const stepIndex = context?.stepIndex ?? 0
            if (stepIndex === failAt) {
              return {
                state: 'failed' as const,
                resolvedActions: [],
                message: 'assertion failed',
              }
            }
            compiled[stepIndex] = stepIndex === 0 ? 'confirm' : 'assert-receipt'
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            const adaptiveCount = evaluations.filter(
              (evaluation) => evaluation === 'adaptive',
            ).length
            return {
              inferenceCount: adaptiveCount,
              replayRepresentation: prefixRepresentation(
                denseCompiledHead(compiled),
              ),
            }
          },
          async close() {},
        }
      },
    }
    const runInput = cacheRunInput({ adapter, store })
    const failed = await runScenario(runInput)
    expect(finalScenarioAttempt(failed.result)).toMatchObject({
      state: 'failed',
      executionMode: 'adaptive',
      cacheOutcome: 'miss',
    })
    expect(writes).toHaveLength(1)
    expect(JSON.parse(requiredValue(writes[0]))).toMatchObject({
      adapterPayload: { operations: ['confirm'] },
    })

    failAt = -1
    compiled.length = 0
    const mixed = await runScenario({
      ...runInput,
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })
    expect(evaluations.slice(-2)).toEqual(['replay', 'adaptive'])
    expect(finalScenarioAttempt(mixed.result)).toMatchObject({
      state: 'passed',
      executionMode: 'adaptive',
      cacheOutcome: 'partial-hit',
      prefixStepCount: 1,
    })
    expect(finalScenarioAttempt(mixed.result).inferenceCount).toBeGreaterThan(0)
  })

  test('keeps a failed Adaptive result after a leased prefix publish', async () => {
    const cache = await localStore()
    const failAt = 1
    const compiled: Array<string | undefined> = []
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession() {
        return {
          async executeStep(_step, _signal, context) {
            const stepIndex = context?.stepIndex ?? 0
            if (stepIndex === failAt) {
              return {
                state: 'failed' as const,
                resolvedActions: [],
                message: 'assertion failed',
              }
            }
            compiled[stepIndex] = stepIndex === 0 ? 'confirm' : 'assert-receipt'
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            return {
              inferenceCount: 1,
              replayRepresentation: prefixRepresentation(
                denseCompiledHead(compiled),
              ),
            }
          },
          async close() {},
        }
      },
    }

    const failed = await runScenario(
      cacheRunInput({
        adapter,
        store: cache,
        projectKey: cache.projectKey,
      }),
    )
    expect(failed.result.state).toBe('failed')
    expect(finalScenarioAttempt(failed.result)).toMatchObject({
      state: 'failed',
      message: 'assertion failed',
      executionMode: 'adaptive',
      cacheOutcome: 'miss',
    })
    expect(await cache.inspect()).toHaveLength(1)
  })

  test('full Replay of a complete prefix remains a hit with zero inference', async () => {
    const { store } = memoryStore()
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession(input) {
        return {
          async executeStep() {
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            return {
              inferenceCount: input.mode === 'adaptive' ? 2 : 0,
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
    const replay = await runScenario({
      ...runInput,
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })
    expect(finalScenarioAttempt(replay.result)).toMatchObject({
      state: 'passed',
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 0,
    })
  })
})
