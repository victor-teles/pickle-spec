import type { Scenario } from '@pickle-spec/spec'
import { describe, expect, test, vi } from 'vitest'
import type { ExecutionTargetAdapter, TargetSession } from '../../../../index'
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
  test('executes and projects a session-wide deterministic Scenario without a step seam', async () => {
    const executeScenario = vi.fn(async () => ({
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

    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession() {
        return {
          executeScenario,
          async complete() {
            return {
              inferenceCount: 1,
              replayRepresentation: {
                cacheable: true as const,
                adapterPayload: { operations: ['scenario-wide'] },
                requiredVariables: [],
              },
            }
          },
          async close() {},
        }
      },
    }
    const run = await runScenario(cacheRunInput({ adapter, store }))

    expect(executeScenario).toHaveBeenCalledTimes(1)
    expect(
      finalScenarioAttempt(run.result).steps.map((step) => step.step.text),
    ).toEqual(['the order is confirmed', 'the receipt is shown'])
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
                    replayRepresentation: {
                      cacheable: true as const,
                      adapterPayload: { operations: completeOperations },
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
    const runInput = cacheRunInput({ adapter, store })

    await runScenario(runInput)
    const fallback = await runScenario({
      ...runInput,
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })
    const cacheOnly = await runScenario({
      ...runInput,
      cachePolicy: 'cache-only',
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-3' },
    })

    expect(modes).toEqual(['adaptive', 'replay', 'replay'])
    expect(finalScenarioAttempt(fallback.result)).toMatchObject({
      state: 'failed',
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 1,
      failureKind: 'cache-miss',
    })
    expect(fallback.events.map((event) => event.type)).not.toContain(
      'adaptive-fallback-started',
    )
    expect(finalScenarioAttempt(cacheOnly.result)).toMatchObject({
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
              replayRepresentation:
                adaptiveAttempt === 2
                  ? {
                      cacheable: false as const,
                      reason: 'non-deterministic-action' as const,
                    }
                  : {
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
    const refresh = await runScenario({
      ...runInput,
      cachePolicy: 'refresh',
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })
    await runScenario({
      ...runInput,
      cachePolicy: 'cache-only',
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-3' },
    })

    expect(finalScenarioAttempt(refresh.result).cacheOutcome).toBe(
      'uncacheable',
    )
    expect(writes).toHaveLength(1)
    expect(replayedPayloads).toEqual([{ operations: completeOperations }])
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
                requiredVariables: ['kind', 'kind'],
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
        selectedScenario: parameterizedScenario,
      }),
    )

    expect(finalScenarioAttempt(run.result)).toMatchObject({
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

    const adapter: ExecutionTargetAdapter = {
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
              replayRepresentation: {
                cacheable: true as const,
                adapterPayload: { operations: ['fill:<email>'] },
                requiredVariables: ['email'],
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
        selectedScenario: boundScenario,
        retry: { infrastructureErrors: 1 },
      }),
    )

    expect(finalScenarioAttempt(run.result)).toMatchObject({
      state: 'passed',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'bound-parameter-value',
    })
    expect(run.result.attempts).toHaveLength(2)
    expect(JSON.stringify(run)).not.toContain(secret)
    expect(JSON.stringify(run)).toContain('<email>')
    expect(writes).toEqual([])
  })

  test('rejects a cache-capable session without any execution seam', async () => {
    const { store, writes } = memoryStore()
    const invalidSession = {
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
})
