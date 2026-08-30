import type { Scenario } from '@pickle-spec/spec'
import { describe, expect, test, vi } from 'vitest'
import { type ExecutionTargetAdapter, runScenario } from '../../../../index'
import { requiredValue } from '../../../../src/required-value'
import { finalAttempt, scenario, specification } from './fixtures'

describe('runScenario', () => {
  test('materializes a functional failure and stops the remaining steps', async () => {
    const executeStep = vi.fn(async () => ({
      state: 'failed' as const,
      resolvedActions: [{ description: 'Checked basket contents' }],
      message: 'The basket was empty',
    }))
    const adapter: ExecutionTargetAdapter = {
      async openSession() {
        return { executeStep, close: async () => {} }
      },
    }

    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'deterministic' },
      adapter,
    })

    expect(run.result.state).toBe('failed')
    expect(finalAttempt(run.result).message).toBe('The basket was empty')
    expect(finalAttempt(run.result).steps).toHaveLength(1)
    expect(run.events.at(-1)).toMatchObject({
      schemaVersion: 2,
      type: 'scenario-finished',
      attempt: { state: 'failed' },
    })
    expect(executeStep).toHaveBeenCalledTimes(1)
  })

  test('copies Pickle-native trace and Diagnostic entries onto the step result and stamps Scenario identity', async () => {
    const occurredAt = '2026-08-23T12:00:00.004Z'
    const paymentScenario: Scenario = {
      ...scenario,
      steps: [requiredValue(scenario.steps[1])],
    }
    const executeStep = vi.fn(async () => ({
      state: 'failed' as const,
      resolvedActions: [{ description: 'Click pay on chrome' }],
      message: 'Payment was declined',
      diagnostics: [
        {
          occurredAt,
          level: 'error' as const,
          origin: 'console' as const,
          message: 'Payment was declined',
        },
      ],
      trace: [
        {
          occurredAt,
          kind: 'resolved-action' as const,
          description: 'Click pay on chrome',
        },
        {
          occurredAt,
          kind: 'browser-activity' as const,
          description: 'Navigate https://example.test/checkout',
        },
      ],
    }))
    const adapter: ExecutionTargetAdapter = {
      async openSession() {
        return { executeStep, close: async () => {} }
      },
    }

    const run = await runScenario({
      specification,
      scenario: paymentScenario,
      executionTargetProfile: { id: 'chrome' },
      adapter,
    })

    const step = requiredValue(finalAttempt(run.result).steps[0])
    expect(step.diagnostics).toEqual([
      {
        occurredAt,
        level: 'error',
        origin: 'console',
        message: 'Payment was declined',
        scenarioId: expect.any(String),
        scenarioName: 'Complete a purchase',
        stepIndex: 0,
        stepText: 'Then the purchase succeeds',
        executionTargetProfileId: 'chrome',
      },
    ])
    expect(step.trace).toEqual([
      {
        occurredAt,
        kind: 'resolved-action',
        description: 'Click pay on chrome',
      },
      {
        occurredAt,
        kind: 'browser-activity',
        description: 'Navigate https://example.test/checkout',
      },
    ])
    expect(run.events.map((event) => event.type)).toEqual([
      'scenario-started',
      'step-started',
      'step-finished',
      'scenario-finished',
    ])
    expect(
      run.events.some((event) =>
        Object.values(event).includes('Diagnostic entry'),
      ),
    ).toBe(false)
  })
})
