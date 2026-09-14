import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Scenario } from '@pickle-spec/spec'
import { describe, expect, test } from 'vitest'
import type { ExecutionTargetAdapter } from '../../../../index'
import { openTestRunStore, runScenario } from '../../../../index'
import { finalScenarioAttempt } from '../../../../src/execution/run-scenario'
import { requiredValue } from '../../../../src/required-value'
import {
  cacheRoots,
  cacheRunInput,
  completeOperations,
  executionCache,
  memoryStore,
  scenario,
} from './fixtures'

describe('Execution cache lifecycle', () => {
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
              inferenceCount: input.mode === 'adaptive' ? 1 : 0,
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
    expect(seed).toBe(false)

    const replay = await runScenario({
      ...runInput,
      cachePolicy: 'cache-only',
      retry: { infrastructureErrors: 0, functionalFailures: 3 },
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })

    expect(modes).toEqual(['adaptive', 'replay'])
    expect(finalScenarioAttempt(replay.result)).toMatchObject({
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
          async executeStep(step, _signal, context) {
            const evaluation = context?.evaluation ?? input.mode
            executions.push(`${evaluation}:${step.text}`)
            if (evaluation === 'replay' && replayShouldDiverge) {
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
              inferenceCount: 2,
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
    replayShouldDiverge = true

    const fallback = await runScenario({
      ...runInput,
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })

    expect(executions.slice(2)).toEqual([
      'replay:the order is confirmed',
      'adaptive:the order is confirmed',
      'adaptive:the receipt is shown',
    ])
    expect(finalScenarioAttempt(fallback.result)).toMatchObject({
      state: 'passed',
      executionMode: 'adaptive',
      cacheOutcome: 'miss',
    })
    expect(fallback.result.attempts).toHaveLength(1)
  })

  test('retries a Replay infrastructure error in a fresh Replay session', async () => {
    const { store } = memoryStore()
    const modes: string[] = []
    let replayShouldFail = false
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession(input) {
        modes.push(input.mode ?? 'adaptive')
        return {
          async executeStep() {
            if (input.mode === 'replay' && replayShouldFail) {
              replayShouldFail = false
              throw new Error('Browser process exited during Replay')
            }
            return { state: 'passed' as const, resolvedActions: [] }
          },
          async complete() {
            return {
              inferenceCount: input.mode === 'adaptive' ? 2 : 0,
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
    const runInput = cacheRunInput({
      adapter,
      store,
      retry: { infrastructureErrors: 1 },
    })
    await runScenario(runInput)
    replayShouldFail = true

    const recovered = await runScenario({
      ...runInput,
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })

    expect(recovered.result).toMatchObject({
      state: 'passed',
      flaky: true,
      attempts: [
        { attempt: 1, state: 'infrastructure-error', executionMode: 'replay' },
        {
          attempt: 2,
          state: 'passed',
          executionMode: 'replay',
          cacheOutcome: 'hit',
          inferenceCount: 0,
        },
      ],
    })
    expect(modes).toEqual(['adaptive', 'replay', 'replay'])
    expect(
      recovered.events
        .filter((event) => event.type === 'scenario-finished')
        .map((event) => event.scope.attempt),
    ).toEqual([1, 2])
  })

  test('preserves globally ordered Replay and Adaptive steps through mixed-session materialization', async () => {
    const { store } = memoryStore()
    let replayShouldDiverge = false
    const outlineScenario: Scenario = {
      ...scenario,
      examplesId: 'examples-checkout',
      examplesRowId: 'row-checkout-1',
      template: {
        name: scenario.name,
        steps: scenario.steps,
        variableNames: [],
      },
      runtimeBindings: [],
    }
    const adapter: ExecutionTargetAdapter = {
      executionCache,
      async openSession(input) {
        return {
          async executeStep(_step, _signal, context) {
            const evaluation = context?.evaluation ?? input.mode
            if (evaluation === 'replay' && replayShouldDiverge) {
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
              inferenceCount: 2,
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
    const runInput = cacheRunInput({
      adapter,
      store,
      selectedScenario: outlineScenario,
    })
    await runScenario(runInput)
    replayShouldDiverge = true

    const mixed = await runScenario({
      ...runInput,
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })

    expect(mixed.result).toMatchObject({
      state: 'passed',
      attempts: [
        {
          attempt: 1,
          executionMode: 'adaptive',
          state: 'passed',
          cacheOutcome: 'miss',
        },
      ],
    })
    const started = mixed.events.filter(
      (event) => event.type === 'scenario-started',
    )
    const finished = mixed.events.filter(
      (event) => event.type === 'scenario-finished',
    )
    expect(started).toHaveLength(1)
    expect(finished).toHaveLength(1)
    expect(started[0]?.scope).toEqual({
      scenarioId: requiredValue(scenario.id),
      examplesRowId: 'row-checkout-1',
      executionTargetProfileId: 'test',
      attempt: 1,
    })
    expect(
      mixed.events.flatMap((event) => {
        switch (event.type) {
          case 'cache-hit':
          case 'replay-diverged':
          case 'adaptive-fallback-started':
          case 'inference-count-updated':
          case 'cache-written':
            return [{ type: event.type, scopeAttempt: event.scope.attempt }]
          default:
            return []
        }
      }),
    ).toEqual([
      { type: 'cache-hit', scopeAttempt: 1 },
      { type: 'replay-diverged', scopeAttempt: 1 },
      { type: 'adaptive-fallback-started', scopeAttempt: 1 },
      { type: 'inference-count-updated', scopeAttempt: 1 },
      { type: 'cache-written', scopeAttempt: 1 },
    ])

    const root = await mkdtemp(join(tmpdir(), 'pickle-fallback-attempts-'))
    cacheRoots.push(root)
    const testRuns = openTestRunStore({
      root,
      pickleHome: join(root, '.pickle-home'),
    })
    const persisted = await testRuns.create()
    for (const event of finished) await persisted.append(event)
    const materialized = await persisted.materialize()
    expect(materialized.results).toHaveLength(1)
    expect(
      materialized.results[0]?.attempts.map((item) => item.attempt),
    ).toEqual([1])
    expect(
      materialized.results[0]?.attempts.map((item) => item.executionMode),
    ).toEqual(['adaptive'])
  })
})
