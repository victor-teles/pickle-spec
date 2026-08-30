import { parseSpecification, type Scenario } from '@pickle-spec/spec'
import { describe, expect, test, vi } from 'vitest'
import type { ExecutionTargetAdapter } from '../../../../index'
import { runScenario } from '../../../../index'
import { finalScenarioAttempt } from '../../../../src/execution/run-scenario'
import { requiredValue } from '../../../../src/required-value'
import { cacheRunInput, executionCache, memoryStore } from './fixtures'

describe('Execution cache lifecycle', () => {
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
              replayRepresentation: {
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
    const baseInput = cacheRunInput({
      adapter,
      store,
      selectedScenario: requiredValue(outlineSpecification.scenarios[0]),
      selectedSpecification: outlineSpecification,
    })

    const first = await runScenario(baseInput)
    const second = await runScenario({
      ...baseInput,
      scenario: requiredValue(outlineSpecification.scenarios[1]),
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
    expect(finalScenarioAttempt(second.result).cacheOutcome).toBe('hit')
    expect(writes).toHaveLength(1)
    const publicSources = JSON.stringify([first, second, writes])
    expect(publicSources).not.toContain('first-secret@example.com')
    expect(publicSources).not.toContain('second-secret@example.com')
    expect(JSON.parse(requiredValue(writes[0]))).toMatchObject({
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

    const adapter: ExecutionTargetAdapter = {
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
              diagnostics: [
                {
                  occurredAt: '2026-08-23T12:00:00.001Z',
                  level: 'error' as const,
                  origin: 'console' as const,
                  message: 'Console exposed secret@example.com',
                  scenarioName: 'Use secret@example.com',
                  stepText: 'When the customer enters secret@example.com',
                },
              ],
              trace: [
                {
                  occurredAt: '2026-08-23T12:00:00.001Z',
                  kind: 'resolved-action' as const,
                  description: 'Fill secret@example.com',
                },
              ],
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
      cacheRunInput({ adapter, store, selectedScenario: boundScenario }),
    )

    expect(finalScenarioAttempt(run.result)).toMatchObject({
      state: 'passed',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'bound-parameter-value',
    })
    expect(JSON.stringify(run)).not.toContain('secret@example.com')
    expect(JSON.stringify(run)).toContain('<email>')
    expect(finalScenarioAttempt(run.result).steps[0]?.artifacts).toEqual([
      {
        kind: 'trace',
        path: '/tmp/<email>.trace',
        mediaType: '<email>/type',
      },
    ])
    expect(finalScenarioAttempt(run.result).steps[0]?.diagnostics).toEqual([
      expect.objectContaining({
        message: 'Console exposed <email>',
        scenarioName: 'Use <email>',
        stepText: 'When the customer enters <email>',
      }),
    ])
    expect(finalScenarioAttempt(run.result).steps[0]?.trace).toEqual([
      expect.objectContaining({ description: 'Fill <email>' }),
    ])
    expect(writes).toEqual([])
  })

  test('completes a failed Adaptive session without writing an empty or over-long prefix', async () => {
    const complete = vi.fn(async () => ({
      inferenceCount: 1,
      replayRepresentation: {
        cacheable: true as const,
        adapterPayload: { operations: ['should-not-exist'] },
        requiredVariables: [],
      },
    }))
    const { store, writes } = memoryStore()

    const adapter: ExecutionTargetAdapter = {
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
    }
    const run = await runScenario(cacheRunInput({ adapter, store }))

    expect(run.result.state).toBe('failed')
    expect(complete).toHaveBeenCalled()
    expect(writes).toEqual([])
  })
})
