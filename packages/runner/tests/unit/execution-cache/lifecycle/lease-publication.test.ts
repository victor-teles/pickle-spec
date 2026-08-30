import { scenarioRevision } from '@pickle-spec/spec'
import { describe, expect, test, vi } from 'vitest'
import type {
  ExecutionCacheStore,
  ExecutionTargetAdapter,
} from '../../../../index'
import { runScenario } from '../../../../index'
import { finalScenarioAttempt } from '../../../../src/execution/run-scenario'
import { requiredValue } from '../../../../src/required-value'
import {
  cacheRunInput,
  executionCache,
  localStore,
  observeLeaseWait,
  scenario,
} from './fixtures'

describe('Execution cache lifecycle', () => {
  test('shares a concurrent oversized outcome without duplicate Adaptive inference', async () => {
    const cache = await localStore({ maxBytes: 1 })
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
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            return {
              inferenceCount: 1,
              replayRepresentation: {
                cacheable: true as const,
                adapterPayload: { operations: ['oversized-operation'] },
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
    expect(finalScenarioAttempt(owner.result)).toMatchObject({
      state: 'passed',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'entry-too-large',
    })
    expect(finalScenarioAttempt(waiter.result)).toMatchObject({
      state: 'passed',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'entry-too-large',
      inferenceCount: 0,
    })
  })

  test('serializes concurrent refreshes and keeps the successful replacement', async () => {
    const cache = await localStore()
    const { store, waiting } = observeLeaseWait(cache)
    let adaptiveExecutions = 0
    let holdRefresh = false
    let releaseRefresh: (() => void) | undefined
    let refreshStarted: (() => void) | undefined
    const started = new Promise<void>((resolve) => {
      refreshStarted = resolve
    })
    const refreshGate = new Promise<void>((resolve) => {
      releaseRefresh = resolve
    })
    const replayedOperations: unknown[] = []
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession(input) {
        if (input.mode === 'adaptive') adaptiveExecutions++
        else replayedOperations.push(input.executionCache?.adapterPayload)
        return {
          async executeStep() {
            if (input.mode === 'adaptive' && holdRefresh) {
              refreshStarted?.()
              await refreshGate
            }
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            return {
              inferenceCount: input.mode === 'adaptive' ? 1 : 0,
              replayRepresentation: {
                cacheable: true as const,
                adapterPayload: {
                  operations: ['same-deterministic-payload', 'assert-receipt'],
                },
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
    await runScenario(runInput)
    holdRefresh = true

    const ownerRun = runScenario({
      ...runInput,
      cachePolicy: 'refresh',
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })
    await started
    const waiterRun = runScenario({
      ...runInput,
      cachePolicy: 'refresh',
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-3' },
    })
    await waiting
    releaseRefresh?.()
    const [owner, waiter] = await Promise.all([ownerRun, waiterRun])

    expect(adaptiveExecutions).toBe(2)
    expect(finalScenarioAttempt(owner.result)).toMatchObject({
      state: 'passed',
      executionMode: 'adaptive',
      cacheOutcome: 'refresh',
    })
    expect(finalScenarioAttempt(waiter.result)).toMatchObject({
      state: 'passed',
      executionMode: 'replay',
      cacheOutcome: 'hit',
    })
    expect(replayedOperations.at(-1)).toEqual({
      operations: ['same-deterministic-payload', 'assert-receipt'],
    })
  })

  test('reports lease wait timeout as infrastructure error without retrying or inferring', async () => {
    const cache = await localStore({ waitTimeoutMs: 8 })
    const cacheKey = {
      projectKey: cache.projectKey,
      scenarioId: requiredValue(scenario.id),
      scenarioRevision: scenarioRevision(scenario),
      executionTargetProfileId: 'test',
      targetConfigurationFingerprint:
        executionCache.targetConfigurationFingerprint,
      applicationRevision: 'app-1',
      adapterKind: executionCache.adapterKind,
      adapterCacheSchemaVersion: executionCache.adapterCacheSchemaVersion,
    }
    const lease = await cache.coordination.acquire(cacheKey)
    if (!lease.acquired) throw new Error('lease missing')
    const openSession = vi.fn(async () => {
      throw new Error('must not infer')
    })
    const adapter: ExecutionTargetAdapter = { executionCache, openSession }

    const run = await runScenario(
      cacheRunInput({
        adapter,
        store: cache,
        projectKey: cache.projectKey,
        retry: { infrastructureErrors: 3 },
      }),
    )

    expect(openSession).not.toHaveBeenCalled()
    expect(finalScenarioAttempt(run.result)).toMatchObject({
      state: 'infrastructure-error',
      cacheOutcome: 'miss',
      inferenceCount: 0,
      message: 'Execution cache lease wait timed out',
    })
    expect(run.result.attempts).toHaveLength(1)
    await cache.coordination.release(lease.lease)
  })

  test('discards an Adaptive evaluation after heartbeat loses ownership', async () => {
    const cache = await localStore({ ttlMs: 100, heartbeatMs: 20 })
    let adaptiveExecutions = 0
    const store: ExecutionCacheStore = {
      ...cache,
      coordination: {
        ...cache.coordination,
        async renew() {
          return false
        },
      },
    }
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession() {
        adaptiveExecutions++
        return {
          async executeStep() {
            await new Promise((resolve) => setTimeout(resolve, 25))
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            return {
              inferenceCount: 1,
              replayRepresentation: {
                cacheable: true as const,
                adapterPayload: { operations: ['must-be-discarded'] },
                requiredVariables: [],
              },
            }
          },
          async close() {},
        }
      },
    }

    const run = await runScenario(
      cacheRunInput({
        adapter,
        store,
        projectKey: cache.projectKey,
        retry: { infrastructureErrors: 3 },
      }),
    )

    expect(adaptiveExecutions).toBe(1)
    expect(finalScenarioAttempt(run.result)).toMatchObject({
      state: 'infrastructure-error',
      cacheOutcome: 'miss',
      inferenceCount: 1,
      message: 'Execution cache lease ownership was lost during evaluation',
    })
    expect(run.result.attempts).toHaveLength(1)
    expect(await cache.inspect()).toEqual([])
  })
})
