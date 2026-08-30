import { describe, expect, test } from 'vitest'
import type { ExecutionTargetAdapter } from '../../../../index'
import { runScenario } from '../../../../index'
import { finalScenarioAttempt } from '../../../../src/execution/run-scenario'
import {
  cacheRunInput,
  executionCache,
  localStore,
  observeLeaseWait,
} from './fixtures'

describe('Execution cache lifecycle', () => {
  test('serializes concurrent misses and lets the waiter replay the published entry', async () => {
    const cache = await localStore()
    let adaptiveExecutions = 0
    let releaseEvaluation: (() => void) | undefined
    let evaluationStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      evaluationStarted = resolve
    })
    const evaluationGate = new Promise<void>((resolve) => {
      releaseEvaluation = resolve
    })
    const { store, waiting } = observeLeaseWait(cache)
    const modes: string[] = []
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession(input) {
        modes.push(input.mode ?? 'adaptive')
        if (input.mode === 'adaptive') adaptiveExecutions++
        return {
          async executeStep() {
            if (input.mode === 'adaptive') {
              evaluationStarted?.()
              await evaluationGate
            }
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            return {
              inferenceCount: input.mode === 'adaptive' ? 1 : 0,
              replayRepresentation: {
                cacheable: true as const,
                adapterPayload: { operations: ['confirm', 'assert-receipt'] },
                requiredVariables: [],
              },
            }
          },
          async close() {},
        }
      },
    }
    const runInput = cacheRunInput({
      adapter,
      store,
      projectKey: cache.projectKey,
    })

    const ownerRun = runScenario(runInput)
    await started
    const waiterRun = runScenario({
      ...runInput,
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })
    await waiting
    releaseEvaluation?.()
    const [owner, waiter] = await Promise.all([ownerRun, waiterRun])

    expect(adaptiveExecutions).toBe(1)
    expect(modes).toEqual(['adaptive', 'replay'])
    expect(finalScenarioAttempt(owner.result)).toMatchObject({
      state: 'passed',
      executionMode: 'adaptive',
      cacheOutcome: 'miss',
    })
    expect(finalScenarioAttempt(waiter.result)).toMatchObject({
      state: 'passed',
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 0,
    })
  })

  test('shares a concurrent uncacheable outcome without duplicate Adaptive inference', async () => {
    const cache = await localStore()
    let adaptiveExecutions = 0
    let releaseEvaluation: (() => void) | undefined
    let evaluationStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      evaluationStarted = resolve
    })
    const evaluationGate = new Promise<void>((resolve) => {
      releaseEvaluation = resolve
    })
    const { store, waiting } = observeLeaseWait(cache)
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession() {
        adaptiveExecutions++
        return {
          async executeStep() {
            evaluationStarted?.()
            await evaluationGate
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            return {
              inferenceCount: 1,
              replayRepresentation: {
                cacheable: false as const,
                reason: 'non-deterministic-action' as const,
              },
            }
          },
          async close() {},
        }
      },
    }
    const runInput = cacheRunInput({
      adapter,
      store,
      projectKey: cache.projectKey,
    })

    const ownerRun = runScenario(runInput)
    await started
    const waiterRun = runScenario({
      ...runInput,
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })
    await waiting
    releaseEvaluation?.()
    const [owner, waiter] = await Promise.all([ownerRun, waiterRun])

    expect(finalScenarioAttempt(owner.result)).toMatchObject({
      state: 'passed',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'non-deterministic-action',
    })
    expect(adaptiveExecutions).toBe(1)
    expect(finalScenarioAttempt(waiter.result)).toMatchObject({
      state: 'passed',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'non-deterministic-action',
      inferenceCount: 0,
    })
  })

  test('shares a concurrent failed outcome without duplicate Adaptive inference', async () => {
    const cache = await localStore()
    const { store, waiting } = observeLeaseWait(cache)
    let adaptiveExecutions = 0
    let releaseEvaluation: (() => void) | undefined
    let evaluationStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      evaluationStarted = resolve
    })
    const evaluationGate = new Promise<void>((resolve) => {
      releaseEvaluation = resolve
    })
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession() {
        adaptiveExecutions++
        return {
          async executeStep() {
            evaluationStarted?.()
            await evaluationGate
            return {
              state: 'failed' as const,
              resolvedActions: [],
              message: 'Receipt was not shown',
            }
          },
          async complete() {
            return { inferenceCount: 1 }
          },
          async close() {},
        }
      },
    }
    const runInput = cacheRunInput({
      adapter,
      store,
      projectKey: cache.projectKey,
    })

    const ownerRun = runScenario(runInput)
    await started
    const waiterRun = runScenario({
      ...runInput,
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })
    await waiting
    releaseEvaluation?.()
    const [owner, waiter] = await Promise.all([ownerRun, waiterRun])

    expect(adaptiveExecutions).toBe(1)
    expect(finalScenarioAttempt(owner.result)).toMatchObject({
      state: 'failed',
      cacheOutcome: 'miss',
      message: 'Receipt was not shown',
    })
    expect(finalScenarioAttempt(waiter.result)).toMatchObject({
      state: 'failed',
      cacheOutcome: 'miss',
      inferenceCount: 0,
    })
    expect(finalScenarioAttempt(waiter.result).message).not.toContain(
      'Receipt was not shown',
    )
  })
})
