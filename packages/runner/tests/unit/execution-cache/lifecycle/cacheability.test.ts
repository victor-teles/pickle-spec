import type { Scenario } from '@pickle-spec/spec'
import { scenarioRevision } from '@pickle-spec/spec'
import { describe, expect, test, vi } from 'vitest'
import type { ExecutionTargetAdapter, PlanUse } from '../../../../index'
import {
  publicRunEvent,
  planDigest,
  runScenario,
  testResultSchema,
} from '../../../../index'
import { finalScenarioAttempt } from '../../../../src/execution/run-scenario'
import {
  cacheRunInput,
  completeOperations,
  executionCache,
  memoryStore,
  scenario,
} from './fixtures'

describe('Execution cache lifecycle', () => {
  test('runs authored validation as v3 Replay without cache access or cache outcome', async () => {
    const { store } = memoryStore()
    store.read = vi.fn(store.read.bind(store))
    store.write = vi.fn(store.write.bind(store))
    store.delete = vi.fn(store.delete.bind(store))
    const digest = 'a'.repeat(64)
    const planUse: PlanUse = {
      purpose: 'validation',
      validationId: null,
      revisionId: digest,
      selectionDigest: null,
      key: {
        projectKey: 'project-1',
        scenarioId: 'scncheckout000000',
        scenarioRevision: scenarioRevision(scenario),
        executionTargetProfileId: 'test',
        targetConfigurationFingerprint: 'target-config-1',
        applicationRevision: 'app-1',
        adapterKind: 'deterministic-test',
        adapterCacheSchemaVersion: '1',
      },
      payloadDigest: planDigest({ operations: completeOperations }),
      author: { kind: 'human', id: 'operator-1' },
      origin: { kind: 'cache-capture', payloadDigest: digest },
    }
    const openSession: ExecutionTargetAdapter['openSession'] = vi.fn(
      async () => ({
        async executeStep() {
          return { state: 'passed' as const, resolvedActions: [] }
        },
        async complete() {
          return { inferenceCount: 0 }
        },
        async close() {},
      }),
    )
    const adapter: ExecutionTargetAdapter = { executionCache, openSession }

    const run = await runScenario({
      ...cacheRunInput({ adapter, store }),
      projectKey: planUse.key.projectKey,
      retry: { infrastructureErrors: 3, functionalFailures: 3 },
      authoredReplay: {
        replay: {
          adapterPayload: { operations: completeOperations },
          requiredVariables: [],
        },
        planUse,
      },
    })

    expect(openSession).toHaveBeenCalledTimes(1)
    expect(openSession).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'replay',
        executionCache: expect.any(Object),
      }),
    )
    const attempt = finalScenarioAttempt(run.result)
    expect(attempt).toMatchObject({
      state: 'passed',
      executionMode: 'replay',
      inferenceCount: 0,
      planUse,
    })
    expect(attempt).not.toHaveProperty('cacheOutcome')
    expect(run.result.schemaVersion).toBe(3)
    expect(
      testResultSchema.parse(JSON.parse(JSON.stringify(run.result))),
    ).toEqual(run.result)
    const finalEvent = run.events.at(-1)
    expect(finalEvent).toBeDefined()
    if (!finalEvent) throw new Error('Expected a final run event')
    expect(publicRunEvent(finalEvent)).toMatchObject({
      schemaVersion: 3,
      attempt: { planUse },
    })
    expect(store.read).not.toHaveBeenCalled()
    expect(store.write).not.toHaveBeenCalled()
    expect(store.delete).not.toHaveBeenCalled()
  })

  test('rejects invalid authored Replay before target launch', async () => {
    const { store } = memoryStore()
    const openSession = vi.fn()
    const adapter: ExecutionTargetAdapter = { executionCache, openSession }
    const key = {
      projectKey: 'project-1',
      scenarioId: 'scncheckout000000',
      scenarioRevision: scenarioRevision(scenario),
      executionTargetProfileId: 'test',
      targetConfigurationFingerprint: 'target-config-1',
      applicationRevision: 'app-1',
      adapterKind: 'deterministic-test',
      adapterCacheSchemaVersion: '1',
    }
    const run = await runScenario({
      ...cacheRunInput({ adapter, store }),
      projectKey: key.projectKey,
      authoredReplay: {
        replay: {
          adapterPayload: { operations: ['confirm'] },
          requiredVariables: [],
        },
        planUse: {
          purpose: 'validation',
          validationId: null,
          revisionId: 'a'.repeat(64),
          selectionDigest: null,
          key,
          payloadDigest: planDigest({ operations: ['confirm'] }),
          author: { kind: 'human', id: 'operator-1' },
          origin: { kind: 'cache-capture', payloadDigest: 'b'.repeat(64) },
        },
      },
    })
    expect(openSession).not.toHaveBeenCalled()
    expect(finalScenarioAttempt(run.result)).toMatchObject({
      state: 'failed',
      executionMode: 'replay',
      planUse: { purpose: 'validation' },
    })
  })

  test('rejects authored Replay from another project without target or cache access', async () => {
    const { store } = memoryStore()
    store.read = vi.fn(store.read.bind(store))
    store.write = vi.fn(store.write.bind(store))
    store.delete = vi.fn(store.delete.bind(store))
    const openSession = vi.fn()
    const adapter: ExecutionTargetAdapter = { executionCache, openSession }
    const payload = { operations: completeOperations }
    const run = await runScenario({
      ...cacheRunInput({ adapter, store }),
      projectKey: 'resolved-project',
      authoredReplay: {
        replay: { adapterPayload: payload, requiredVariables: [] },
        planUse: {
          purpose: 'validation',
          validationId: null,
          revisionId: 'a'.repeat(64),
          selectionDigest: null,
          key: {
            projectKey: 'foreign-project',
            scenarioId: 'scncheckout000000',
            scenarioRevision: scenarioRevision(scenario),
            executionTargetProfileId: 'test',
            targetConfigurationFingerprint: 'target-config-1',
            applicationRevision: 'app-1',
            adapterKind: 'deterministic-test',
            adapterCacheSchemaVersion: '1',
          },
          payloadDigest: planDigest(payload),
          author: { kind: 'human', id: 'operator-1' },
          origin: {
            kind: 'cache-capture',
            payloadDigest: 'b'.repeat(64),
          },
        },
      },
    })

    expect(finalScenarioAttempt(run.result)).toMatchObject({
      state: 'failed',
      message: 'Authored Replay does not apply to the resolved project',
    })
    expect(openSession).not.toHaveBeenCalled()
    expect(store.read).not.toHaveBeenCalled()
    expect(store.write).not.toHaveBeenCalled()
    expect(store.delete).not.toHaveBeenCalled()
  })

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
