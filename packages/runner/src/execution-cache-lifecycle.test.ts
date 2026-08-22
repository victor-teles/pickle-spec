import { describe, expect, mock, test } from 'bun:test'
import {
  parseSpecification,
  type Scenario,
  type Specification,
} from '@pickle-spec/spec'
import { z } from 'zod'
import type {
  ExecutionCacheAdapter,
  ExecutionCacheStore,
  ExecutionTargetAdapter,
  TargetSession,
} from '../index'
import { runScenario } from '../index'

const specification: Specification = {
  name: 'Checkout',
  source: { uri: 'features/checkout.feature', language: 'en' },
  tags: [],
  scenarios: [],
}

const scenario: Scenario = {
  id: 'scncheckout000000',
  name: 'Complete checkout',
  tags: [],
  steps: [
    { keyword: 'When', text: 'the order is confirmed', type: 'action' },
    { keyword: 'Then', text: 'the receipt is shown', type: 'outcome' },
  ],
}

const payloadSchema = z.strictObject({
  operations: z.array(z.string()),
})

type Payload = z.infer<typeof payloadSchema>

const executionCache: ExecutionCacheAdapter<Payload> = {
  adapterKind: 'deterministic-test',
  adapterCacheSchemaVersion: '1',
  targetConfigurationFingerprint: 'target-config-1',
  parse(payload) {
    return payloadSchema.safeParse(payload).data
  },
}

function memoryStore() {
  const entries = new Map<string, string>()
  const writes: string[] = []
  const store: ExecutionCacheStore = {
    async read(key) {
      return entries.get(JSON.stringify(key))
    },
    async write(serialized) {
      entries.set(JSON.stringify(serialized.key), serialized.source)
      writes.push(serialized.source)
      return { stored: true, evictedEntries: 0 }
    },
    async delete(key) {
      entries.delete(JSON.stringify(key))
    },
    async inspect() {
      return []
    },
    async clear() {
      entries.clear()
    },
  }
  return { entries, store, writes }
}

describe('Execution cache lifecycle', () => {
  test('stores one successful Adaptive execution and replays it on the next run', async () => {
    const modes: string[] = []
    const openSession = mock(async (input) => {
      modes.push(input.mode ?? 'adaptive')
      return {
        async executeStep() {
          return { state: 'passed' as const, resolvedActions: [] }
        },
        async complete() {
          return {
            inferenceCount: input.mode === 'replay' ? 0 : 2,
            evaluationModel: 'test-model',
            cacheCandidate: {
              cacheable: true as const,
              adapterPayload: { operations: ['confirm', 'assert-receipt'] },
              requiredVariables: [],
            },
          }
        },
        async close() {},
      }
    })
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      openSession,
    }
    const { store } = memoryStore()
    const input = {
      specification,
      scenario,
      executionTargetProfile: { id: 'test' },
      adapter,
      applicationRevision: 'app-1',
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    }

    const adaptive = await runScenario(input)
    const replay = await runScenario({
      ...input,
      executionCache: { ...input.executionCache, sourceRunId: 'run-2' },
    })

    expect(modes).toEqual(['adaptive', 'replay'])
    expect(adaptive.result).toMatchObject({
      state: 'passed',
      executionMode: 'adaptive',
      cacheOutcome: 'miss',
      inferenceCount: 2,
    })
    expect(replay.result).toMatchObject({
      state: 'passed',
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 0,
    })
    expect(adaptive.events.map((event) => event.type)).toContain(
      'cache-written',
    )
    expect(replay.events.map((event) => event.type)).toContain('cache-hit')
  })

  test('refresh bypasses Replay and preserves the previous entry when Adaptive fails', async () => {
    const { store, writes } = memoryStore()
    let adaptiveAttempt = 0
    const replayedPayloads: unknown[] = []
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession(input) {
        if (input.mode === 'replay') {
          replayedPayloads.push(input.executionCache?.adapterPayload)
        } else {
          adaptiveAttempt++
        }
        return {
          async executeStep() {
            return {
              state:
                input.mode === 'adaptive' && adaptiveAttempt === 2
                  ? ('failed' as const)
                  : ('passed' as const),
              resolvedActions: [],
            }
          },
          async complete() {
            return {
              inferenceCount: input.mode === 'adaptive' ? 1 : 0,
              cacheCandidate: {
                cacheable: true as const,
                adapterPayload: { operations: [`revision-${adaptiveAttempt}`] },
                requiredVariables: [],
              },
            }
          },
          async close() {},
        }
      },
    }
    const input = {
      specification,
      scenario,
      executionTargetProfile: { id: 'test' },
      adapter,
      applicationRevision: 'app-1',
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    }

    await runScenario(input)
    const refresh = await runScenario({
      ...input,
      cachePolicy: 'refresh',
      executionCache: { ...input.executionCache, sourceRunId: 'run-2' },
    })
    const replay = await runScenario({
      ...input,
      cachePolicy: 'cache-only',
      executionCache: { ...input.executionCache, sourceRunId: 'run-3' },
    })

    expect(refresh.result.state).toBe('failed')
    expect(writes).toHaveLength(1)
    expect(replay.result.state).toBe('passed')
    expect(replayedPayloads).toEqual([{ operations: ['revision-1'] }])
  })

  test('cache-only fails on a miss without opening an adapter session', async () => {
    const openSession = mock(async () => {
      throw new Error('must not open')
    })
    const { store } = memoryStore()

    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'test' },
      adapter: { executionCache, openSession },
      applicationRevision: 'app-1',
      cachePolicy: 'cache-only',
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    })

    expect(openSession).not.toHaveBeenCalled()
    expect(run.result).toMatchObject({
      state: 'failed',
      failureKind: 'cache-miss',
      cacheOutcome: 'miss',
      inferenceCount: 0,
    })
  })

  test('cache-only divergence fails without retries or Adaptive fallback', async () => {
    const { store } = memoryStore()
    const modes: string[] = []
    let seed = true
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession(input) {
        modes.push(input.mode ?? 'adaptive')
        return {
          async executeStep() {
            if (input.mode === 'replay') {
              return {
                state: 'failed' as const,
                replayDiverged: true,
                resolvedActions: [],
              }
            }
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            seed = false
            return {
              inferenceCount: 1,
              cacheCandidate: {
                cacheable: true as const,
                adapterPayload: { operations: ['deterministic'] },
                requiredVariables: [],
              },
            }
          },
          async close() {},
        }
      },
    }
    const input = {
      specification,
      scenario,
      executionTargetProfile: { id: 'test' },
      adapter,
      applicationRevision: 'app-1',
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    }
    await runScenario(input)
    expect(seed).toBe(false)

    const replay = await runScenario({
      ...input,
      cachePolicy: 'cache-only',
      retry: { infrastructureErrors: 0, functionalFailures: 3 },
      executionCache: { ...input.executionCache, sourceRunId: 'run-2' },
    })

    expect(modes).toEqual(['adaptive', 'replay'])
    expect(replay.result).toMatchObject({
      state: 'failed',
      executionMode: 'replay',
      inferenceCount: 0,
      failureKind: 'cache-miss',
    })
    expect(replay.events.map((event) => event.type)).not.toContain(
      'adaptive-fallback-started',
    )
  })

  test('restarts the complete Scenario in Adaptive mode after Replay diverges', async () => {
    const { store } = memoryStore()
    const executions: string[] = []
    let replayShouldDiverge = false
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession(input) {
        return {
          async executeStep(step) {
            executions.push(`${input.mode}:${step.text}`)
            if (input.mode === 'replay' && replayShouldDiverge) {
              replayShouldDiverge = false
              return {
                state: 'failed' as const,
                replayDiverged: true,
                resolvedActions: [],
              }
            }
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            return {
              inferenceCount: input.mode === 'adaptive' ? 2 : 0,
              cacheCandidate: {
                cacheable: true as const,
                adapterPayload: { operations: ['deterministic'] },
                requiredVariables: [],
              },
            }
          },
          async close() {},
        }
      },
    }
    const input = {
      specification,
      scenario,
      executionTargetProfile: { id: 'test' },
      adapter,
      applicationRevision: 'app-1',
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    }
    await runScenario(input)
    replayShouldDiverge = true

    const fallback = await runScenario({
      ...input,
      executionCache: { ...input.executionCache, sourceRunId: 'run-2' },
    })

    expect(executions.slice(2)).toEqual([
      'replay:the order is confirmed',
      'adaptive:the order is confirmed',
      'adaptive:the receipt is shown',
    ])
    expect(fallback.result).toMatchObject({
      state: 'passed',
      executionMode: 'adaptive',
      cacheOutcome: 'fallback',
      inferenceCount: 2,
    })
  })

  test('keeps a passed but non-deterministic Scenario uncacheable', async () => {
    const { store, writes } = memoryStore()
    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'test' },
      adapter: {
        executionCache,
        async openSession() {
          return {
            async executeStep() {
              return { state: 'passed' as const, resolvedActions: [] }
            },
            async complete() {
              return {
                inferenceCount: 3,
                cacheCandidate: {
                  cacheable: false as const,
                  reason: 'non-deterministic-assertion' as const,
                },
              }
            },
            async close() {},
          }
        },
      },
      applicationRevision: 'app-1',
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    })

    expect(run.result).toMatchObject({
      state: 'passed',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'non-deterministic-assertion',
      inferenceCount: 3,
    })
    expect(writes).toEqual([])
  })

  test('does not read or write cache without an application revision', async () => {
    const { store, writes } = memoryStore()
    const read = mock(store.read.bind(store))
    store.read = read
    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'test' },
      adapter: {
        executionCache,
        async openSession() {
          return {
            async executeStep() {
              return { state: 'passed' as const, resolvedActions: [] }
            },
            async complete() {
              return {
                inferenceCount: 1,
                cacheCandidate: {
                  cacheable: true as const,
                  adapterPayload: { operations: ['deterministic'] },
                  requiredVariables: [],
                },
              }
            },
            async close() {},
          }
        },
      },
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    })

    expect(run.result).toMatchObject({
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
    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'test' },
      adapter: {
        executionCache,
        async openSession() {
          return {
            async executeStep() {
              return { state: 'passed' as const, resolvedActions: [] }
            },
            async complete() {
              return {
                inferenceCount: 1,
                cacheCandidate: {
                  cacheable: true as const,
                  adapterPayload: { operations: ['deterministic'] },
                  requiredVariables: [],
                },
              }
            },
            async close() {
              throw new Error('close failed')
            },
          }
        },
      },
      applicationRevision: 'app-1',
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    })

    expect(run.result.state).toBe('infrastructure-error')
    expect(writes).toEqual([])
  })

  test('writes only after the persisted representation completes and the session closes', async () => {
    const order: string[] = []
    const { store } = memoryStore()
    const originalWrite = store.write.bind(store)
    store.write = async (...args) => {
      order.push('write')
      return originalWrite(...args)
    }

    await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'test' },
      adapter: {
        executionCache,
        async openSession() {
          return {
            async executeStep() {
              order.push('execute')
              return { state: 'passed' as const, resolvedActions: [] }
            },
            async complete() {
              order.push('complete')
              return {
                inferenceCount: 1,
                cacheCandidate: {
                  cacheable: true as const,
                  adapterPayload: { operations: ['deterministic'] },
                  requiredVariables: [],
                },
              }
            },
            async close() {
              order.push('close')
            },
          }
        },
      },
      applicationRevision: 'app-1',
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    })

    expect(order).toEqual(['execute', 'execute', 'complete', 'close', 'write'])
  })

  test('treats an Outline without separated bindings as uncacheable', async () => {
    const { store, writes } = memoryStore()
    const unsafeScenario: Scenario = {
      ...scenario,
      examplesRowId: 'rowunsafe000000',
    }
    const openSession = mock(async () => ({
      async executeStep() {
        return { state: 'passed' as const, resolvedActions: [] }
      },
      async complete() {
        return {
          inferenceCount: 1,
          cacheCandidate: {
            cacheable: true as const,
            adapterPayload: { operations: ['bound-value'] },
            requiredVariables: [],
          },
        }
      },
      async close() {},
    }))

    const run = await runScenario({
      specification,
      scenario: unsafeScenario,
      executionTargetProfile: { id: 'test' },
      adapter: { executionCache, openSession },
      applicationRevision: 'app-1',
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    })

    expect(openSession).toHaveBeenCalledTimes(1)
    expect(run.result).toMatchObject({
      state: 'passed',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'bound-parameter-value',
    })
    expect(writes).toEqual([])
  })

  test('binds Outline values only at the adapter boundary and reuses one template cache entry across rows', async () => {
    const outlineSpecification = parseSpecification({
      uri: 'features/sign-in.feature',
      source: `Feature: Sign in
  @pickle:id:scnsignin0000000
  Scenario Outline: Sign in as <role>
    When the customer enters <email>
    Then the greeting shows <role>

    Examples:
      | role  | email                       |
      | admin | first-secret@example.com    |
      | user  | second-secret@example.com   |`,
    })
    const { store, writes } = memoryStore()
    const adapterInputs: Array<{
      boundStep: string
      templateStep?: string
      bindings: string[]
      mode?: string
    }> = []
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession(input) {
        return {
          async executeStep(step, _signal, context) {
            adapterInputs.push({
              boundStep: step.text,
              templateStep: context?.templateStep.text,
              bindings: (context?.runtimeBindings ?? []).map(
                (binding) => binding.value,
              ),
              mode: input.mode,
            })
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            return {
              inferenceCount: input.mode === 'adaptive' ? 2 : 0,
              cacheCandidate: {
                cacheable: true as const,
                adapterPayload: {
                  operations: ['fill:<email>', 'assert:<role>'],
                },
                requiredVariables: ['role', 'email'],
              },
            }
          },
          async close() {},
        }
      },
    }
    const baseInput = {
      specification: outlineSpecification,
      executionTargetProfile: { id: 'test' },
      adapter,
      applicationRevision: 'app-1',
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    }

    const first = await runScenario({
      ...baseInput,
      scenario: outlineSpecification.scenarios[0]!,
    })
    const second = await runScenario({
      ...baseInput,
      scenario: outlineSpecification.scenarios[1]!,
      executionCache: { ...baseInput.executionCache, sourceRunId: 'run-2' },
    })

    expect(adapterInputs).toContainEqual({
      boundStep: 'the customer enters first-secret@example.com',
      templateStep: 'the customer enters <email>',
      bindings: ['admin', 'first-secret@example.com'],
      mode: 'adaptive',
    })
    expect(adapterInputs).toContainEqual({
      boundStep: 'the customer enters second-secret@example.com',
      templateStep: 'the customer enters <email>',
      bindings: ['user', 'second-secret@example.com'],
      mode: 'replay',
    })
    expect(first.result.scenario.examplesRowId).not.toBe(
      second.result.scenario.examplesRowId,
    )
    expect(second.result.cacheOutcome).toBe('hit')
    expect(writes).toHaveLength(1)
    const publicSources = JSON.stringify([first, second, writes])
    expect(publicSources).not.toContain('first-secret@example.com')
    expect(publicSources).not.toContain('second-secret@example.com')
    expect(JSON.parse(writes[0]!)).toMatchObject({
      key: { scenarioId: 'scnsignin0000000' },
      requiredVariables: ['role', 'email'],
    })
  })

  test('redacts adapter evidence containing a bound value and refuses to cache it', async () => {
    const boundScenario: Scenario = {
      id: 'scnsecret0000000',
      name: 'Use secret@example.com',
      tags: [],
      steps: [
        {
          keyword: 'When',
          text: 'the customer enters secret@example.com',
          type: 'action',
        },
      ],
      examplesRowId: 'rowsecret000000',
      template: {
        name: 'Use <email>',
        variableNames: ['email'],
        steps: [
          {
            keyword: 'When',
            text: 'the customer enters <email>',
            type: 'action',
          },
        ],
      },
      runtimeBindings: [{ name: 'email', value: 'secret@example.com' }],
    }
    const { store, writes } = memoryStore()

    const run = await runScenario({
      specification,
      scenario: boundScenario,
      executionTargetProfile: { id: 'test' },
      adapter: {
        executionCache,
        async openSession() {
          return {
            async executeStep() {
              return {
                state: 'passed' as const,
                resolvedActions: [
                  {
                    description: 'Fill secret@example.com',
                    replay: { value: 'secret@example.com' },
                  },
                ],
                message: 'Used secret@example.com',
                artifacts: [
                  {
                    kind: 'trace' as const,
                    path: '/tmp/secret@example.com.trace',
                    mediaType: 'secret@example.com/type',
                  },
                ],
              }
            },
            async complete() {
              return {
                inferenceCount: 1,
                cacheCandidate: {
                  cacheable: true as const,
                  adapterPayload: { operations: ['fill:<email>'] },
                  requiredVariables: ['email'],
                },
              }
            },
            async close() {},
          }
        },
      },
      applicationRevision: 'app-1',
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    })

    expect(run.result).toMatchObject({
      state: 'passed',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'bound-parameter-value',
    })
    expect(JSON.stringify(run)).not.toContain('secret@example.com')
    expect(JSON.stringify(run)).toContain('<email>')
    expect(run.result.steps[0]?.artifacts).toEqual([
      {
        kind: 'trace',
        path: '/tmp/<email>.trace',
        mediaType: '<email>/type',
      },
    ])
    expect(writes).toEqual([])
  })

  test('does not complete or cache an Adaptive Scenario after a failed step', async () => {
    const complete = mock(async () => ({
      inferenceCount: 1,
      cacheCandidate: {
        cacheable: true as const,
        adapterPayload: { operations: ['should-not-exist'] },
        requiredVariables: [],
      },
    }))
    const { store, writes } = memoryStore()

    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'test' },
      adapter: {
        executionCache,
        async openSession() {
          return {
            async executeStep() {
              return { state: 'failed' as const, resolvedActions: [] }
            },
            complete,
            async close() {},
          }
        },
      },
      applicationRevision: 'app-1',
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    })

    expect(run.result.state).toBe('failed')
    expect(complete).not.toHaveBeenCalled()
    expect(writes).toEqual([])
  })

  test('executes and projects a session-wide deterministic Scenario without a step seam', async () => {
    const executeScenario = mock(async () => ({
      stepExecutions: [
        {
          state: 'passed' as const,
          resolvedActions: [{ description: 'Confirm order' }],
        },
        {
          state: 'passed' as const,
          resolvedActions: [{ description: 'Assert receipt' }],
        },
      ],
    }))
    const { store } = memoryStore()

    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'test' },
      adapter: {
        executionCache,
        async openSession() {
          return {
            executeScenario,
            async complete() {
              return {
                inferenceCount: 1,
                cacheCandidate: {
                  cacheable: true as const,
                  adapterPayload: { operations: ['scenario-wide'] },
                  requiredVariables: [],
                },
              }
            },
            async close() {},
          }
        },
      },
      applicationRevision: 'app-1',
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    })

    expect(executeScenario).toHaveBeenCalledTimes(1)
    expect(run.result.steps.map((step) => step.step.text)).toEqual([
      'the order is confirmed',
      'the receipt is shown',
    ])
    expect(run.result.state).toBe('passed')
  })

  test('treats Replay inference as divergence and never falls back in cache-only mode', async () => {
    const { store } = memoryStore()
    const modes: string[] = []
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession(input) {
        modes.push(input.mode ?? 'adaptive')
        return {
          async executeStep() {
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            return {
              inferenceCount: input.mode === 'replay' ? 1 : 2,
              ...(input.mode === 'adaptive'
                ? {
                    cacheCandidate: {
                      cacheable: true as const,
                      adapterPayload: { operations: ['deterministic'] },
                      requiredVariables: [],
                    },
                  }
                : {}),
            }
          },
          async close() {},
        }
      },
    }
    const input = {
      specification,
      scenario,
      executionTargetProfile: { id: 'test' },
      adapter,
      applicationRevision: 'app-1',
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    }

    await runScenario(input)
    const fallback = await runScenario({
      ...input,
      executionCache: { ...input.executionCache, sourceRunId: 'run-2' },
    })
    const cacheOnly = await runScenario({
      ...input,
      cachePolicy: 'cache-only',
      executionCache: { ...input.executionCache, sourceRunId: 'run-3' },
    })

    expect(modes).toEqual(['adaptive', 'replay', 'adaptive', 'replay'])
    expect(fallback.result).toMatchObject({
      state: 'passed',
      cacheOutcome: 'fallback',
      inferenceCount: 3,
    })
    expect(cacheOnly.result).toMatchObject({
      state: 'failed',
      executionMode: 'replay',
      inferenceCount: 1,
      failureKind: 'cache-miss',
    })
    expect(cacheOnly.events.map((event) => event.type)).not.toContain(
      'adaptive-fallback-started',
    )
  })

  test('preserves the previous entry when refresh passes but is uncacheable', async () => {
    const { store, writes } = memoryStore()
    let adaptiveAttempt = 0
    const replayedPayloads: unknown[] = []
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession(input) {
        if (input.mode === 'replay') {
          replayedPayloads.push(input.executionCache?.adapterPayload)
        } else {
          adaptiveAttempt++
        }
        return {
          async executeStep() {
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            return {
              inferenceCount: input.mode === 'replay' ? 0 : 1,
              cacheCandidate:
                adaptiveAttempt === 2
                  ? {
                      cacheable: false as const,
                      reason: 'non-deterministic-action' as const,
                    }
                  : {
                      cacheable: true as const,
                      adapterPayload: { operations: ['original'] },
                      requiredVariables: [],
                    },
            }
          },
          async close() {},
        }
      },
    }
    const input = {
      specification,
      scenario,
      executionTargetProfile: { id: 'test' },
      adapter,
      applicationRevision: 'app-1',
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    }

    await runScenario(input)
    const refresh = await runScenario({
      ...input,
      cachePolicy: 'refresh',
      executionCache: { ...input.executionCache, sourceRunId: 'run-2' },
    })
    await runScenario({
      ...input,
      cachePolicy: 'cache-only',
      executionCache: { ...input.executionCache, sourceRunId: 'run-3' },
    })

    expect(refresh.result.cacheOutcome).toBe('uncacheable')
    expect(writes).toHaveLength(1)
    expect(replayedPayloads).toEqual([{ operations: ['original'] }])
  })

  test('rejects cache candidates whose required variables are not a unique template subset', async () => {
    const { store, writes } = memoryStore()
    const parameterizedScenario: Scenario = {
      ...scenario,
      template: {
        name: 'Complete <kind>',
        steps: scenario.steps,
        variableNames: ['kind'],
      },
      runtimeBindings: [{ name: 'kind', value: 'private-kind' }],
    }

    const run = await runScenario({
      specification,
      scenario: parameterizedScenario,
      executionTargetProfile: { id: 'test' },
      adapter: {
        executionCache,
        async openSession() {
          return {
            async executeStep() {
              return { state: 'passed' as const, resolvedActions: [] }
            },
            async complete() {
              return {
                inferenceCount: 1,
                cacheCandidate: {
                  cacheable: true as const,
                  adapterPayload: { operations: ['deterministic'] },
                  requiredVariables: ['kind', 'kind'],
                },
              }
            },
            async close() {},
          }
        },
      },
      applicationRevision: 'app-1',
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    })

    expect(run.result).toMatchObject({
      state: 'passed',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'payload-validation-failed',
    })
    expect(writes).toEqual([])
  })

  test('keeps a redacted adapter error uncacheable after a successful retry', async () => {
    const secret = 'retry-secret@example.com'
    const boundScenario: Scenario = {
      ...scenario,
      examplesRowId: 'rowretrysecret00',
      template: {
        name: scenario.name,
        steps: scenario.steps,
        variableNames: ['email'],
      },
      runtimeBindings: [{ name: 'email', value: secret }],
    }
    const { store, writes } = memoryStore()
    let attempts = 0

    const run = await runScenario({
      specification,
      scenario: boundScenario,
      executionTargetProfile: { id: 'test' },
      adapter: {
        executionCache,
        async openSession() {
          attempts++
          return {
            async executeStep() {
              if (attempts === 1) {
                throw new Error(`Adapter failed while using ${secret}`)
              }
              return { state: 'passed' as const, resolvedActions: [] }
            },
            async complete() {
              return {
                inferenceCount: 1,
                cacheCandidate: {
                  cacheable: true as const,
                  adapterPayload: { operations: ['fill:<email>'] },
                  requiredVariables: ['email'],
                },
              }
            },
            async close() {},
          }
        },
      },
      applicationRevision: 'app-1',
      retry: { infrastructureErrors: 1 },
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    })

    expect(run.result).toMatchObject({
      state: 'passed',
      attempts: 2,
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'bound-parameter-value',
    })
    expect(JSON.stringify(run)).not.toContain(secret)
    expect(JSON.stringify(run)).toContain('<email>')
    expect(writes).toEqual([])
  })

  test('rejects a cache-capable session without any execution seam', async () => {
    const { store, writes } = memoryStore()
    const invalidSession = {
      async close() {},
    } as unknown as TargetSession

    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'test' },
      adapter: {
        executionCache,
        async openSession() {
          return invalidSession
        },
      },
      applicationRevision: 'app-1',
      executionCache: {
        store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
    })

    expect(run.result).toMatchObject({
      state: 'infrastructure-error',
      message:
        'Target session must provide executeStep or executeScenario execution',
    })
    expect(writes).toEqual([])
  })
})
