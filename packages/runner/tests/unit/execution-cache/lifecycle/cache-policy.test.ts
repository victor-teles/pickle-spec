import { scenarioRevision } from '@pickle-spec/spec'
import { describe, expect, test, vi } from 'vitest'
import type { ExecutionTargetAdapter } from '../../../../index'
import { runScenario } from '../../../../index'
import { finalScenarioAttempt } from '../../../../src/execution/run-scenario'
import { requiredValue } from '../../../../src/required-value'
import {
  cacheRunInput,
  executionCache,
  memoryStore,
  scenario,
  specification,
} from './fixtures'

describe('Execution cache lifecycle', () => {
  test('stores one successful Adaptive execution and replays it on the next run', async () => {
    const modes: string[] = []
    const openSession = vi.fn(async (input) => {
      modes.push(input.mode ?? 'adaptive')
      return {
        async executeStep() {
          return { state: 'passed' as const, resolvedActions: [] }
        },
        async complete() {
          return {
            inferenceCount: input.mode === 'replay' ? 0 : 2,
            evaluationModel: 'test-model',
            replayRepresentation: {
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
    const runInput = cacheRunInput({ adapter, store })

    const adaptive = await runScenario(runInput)
    const replay = await runScenario({
      ...runInput,
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })

    expect(modes).toEqual(['adaptive', 'replay'])
    expect(finalScenarioAttempt(adaptive.result)).toMatchObject({
      state: 'passed',
      executionMode: 'adaptive',
      cacheOutcome: 'miss',
      inferenceCount: 2,
    })
    expect(finalScenarioAttempt(replay.result)).toMatchObject({
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
              replayRepresentation: {
                cacheable: true as const,
                adapterPayload: {
                  operations: [`revision-${adaptiveAttempt}`, 'assert-receipt'],
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
    const refresh = await runScenario({
      ...runInput,
      cachePolicy: 'refresh',
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-2' },
    })
    const replay = await runScenario({
      ...runInput,
      cachePolicy: 'cache-only',
      executionCache: { ...runInput.executionCache, sourceRunId: 'run-3' },
    })

    expect(refresh.result.state).toBe('failed')
    expect(writes).toHaveLength(1)
    expect(replay.result.state).toBe('passed')
    expect(replayedPayloads).toEqual([
      { operations: ['revision-1', 'assert-receipt'] },
    ])
  })

  test('cache-only fails on a miss without opening an adapter session', async () => {
    const openSession = vi.fn(async () => {
      throw new Error('must not open')
    })
    const { store } = memoryStore()
    const timestamps = ['2026-08-22T16:00:00.000Z', '2026-08-22T16:00:01.000Z']
    let timestampIndex = 0

    const adapter: ExecutionTargetAdapter = { executionCache, openSession }
    const run = await runScenario({
      ...cacheRunInput({ adapter, store, cachePolicy: 'cache-only' }),
      now: () => new Date(requiredValue(timestamps[timestampIndex++])),
    })

    expect(openSession).not.toHaveBeenCalled()
    expect(finalScenarioAttempt(run.result)).toMatchObject({
      state: 'failed',
      failureKind: 'cache-miss',
      cacheOutcome: 'miss',
      inferenceCount: 0,
    })
    const attempt = finalScenarioAttempt(run.result)
    const scenarioEvents = run.events.filter(
      (event) =>
        event.type === 'scenario-started' || event.type === 'scenario-finished',
    )
    expect(attempt).toMatchObject({
      startedAt: timestamps[0],
      finishedAt: timestamps[0],
      durationMs: 0,
    })
    expect(scenarioEvents.map((event) => event.occurredAt)).toEqual([
      attempt.startedAt,
      attempt.finishedAt,
    ])
    const cacheMiss = run.events.find((event) => event.type === 'cache-miss')
    expect(cacheMiss).toMatchObject({
      type: 'cache-miss',
      occurredAt: timestamps[1],
      observations: [
        {
          version: 1,
          kind: 'cache',
          summary: 'Cache Miss',
          timing: {
            occurredAt: timestamps[1],
            precision: 'exact',
          },
          versions: [
            {
              subject: 'contract',
              label: 'run-event-schema',
              value: '2',
            },
            {
              subject: 'scenario',
              label: 'revision',
              value: scenarioRevision(scenario),
            },
            {
              subject: 'application',
              label: 'revision',
              value: 'app-1',
            },
            {
              subject: 'adapter',
              label: 'cache-schema',
              value: '1',
            },
          ],
          execution: {
            cacheDecision: {
              type: 'cache-miss',
            },
          },
        },
      ],
    })
  })

  test('explicit cache policies fail without a runtime cache store', async () => {
    const openSession = vi.fn(async () => {
      throw new Error('must not open')
    })
    const adapter: ExecutionTargetAdapter = { executionCache, openSession }

    for (const cachePolicy of ['cache-only', 'refresh'] as const) {
      const run = await runScenario({
        specification,
        scenario,
        executionTargetProfile: { id: 'test' },
        adapter,
        applicationRevision: 'app-1',
        cachePolicy,
      })

      expect(finalScenarioAttempt(run.result)).toMatchObject({
        state: 'failed',
        failureKind: 'cache-miss',
        cacheOutcome: 'miss',
        inferenceCount: 0,
      })
    }
    expect(openSession).not.toHaveBeenCalled()
  })
})
