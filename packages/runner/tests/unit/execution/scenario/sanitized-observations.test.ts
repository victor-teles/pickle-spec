import type { Scenario } from '@pickle-spec/spec'
import { describe, expect, test } from 'vitest'
import { type ExecutionTargetAdapter, runScenario } from '../../../../index'
import { requiredValue } from '../../../../src/required-value'
import { scenario, specification } from './fixtures'

describe('runScenario', () => {
  test('emits normalized observations from sanitized step and attempt evidence', async () => {
    const secret = 'secret@example.test'
    const observedScenario: Scenario = {
      ...scenario,
      steps: [
        {
          keyword: 'When',
          text: 'the customer submits <email>',
          type: 'action',
        },
      ],
      runtimeBindings: [{ name: 'email', value: secret }],
    }
    const adapter: ExecutionTargetAdapter = {
      async openSession() {
        return {
          async executeStep() {
            return {
              state: 'failed' as const,
              resolvedActions: [{ description: `Submit ${secret}` }],
              message: `Payment failed for ${secret}`,
              diagnostics: [
                {
                  occurredAt: '2026-08-29T12:00:00.000Z',
                  level: 'error' as const,
                  origin: 'adapter' as const,
                  message: `Observed ${secret}`,
                },
              ],
              artifacts: [
                {
                  kind: 'trace' as const,
                  path: `/tmp/${secret}.trace`,
                },
              ],
            }
          },
          async close() {},
        }
      },
    }

    const run = await runScenario({
      specification,
      scenario: observedScenario,
      executionTargetProfile: { id: 'web' },
      adapter,
    })

    const stepEvent = run.events.find((event) => event.type === 'step-finished')
    expect(stepEvent).toMatchObject({
      type: 'step-finished',
      observations: [
        {
          kind: 'outcome',
          outcome: {
            state: 'failed',
            message: 'Payment failed for <email>',
          },
        },
        {
          kind: 'activity',
          activity: {
            kind: 'resolved-action',
            description: 'Submit <email>',
          },
        },
        {
          kind: 'diagnostic',
          outcome: {
            level: 'error',
            message: 'Observed <email>',
          },
        },
        {
          kind: 'artifact',
          artifact: {
            kind: 'trace',
            path: '/tmp/<email>.trace',
          },
        },
      ],
    })
    expect(JSON.stringify(run.events)).not.toContain(secret)
    const finished = requiredValue(run.events.at(-1))
    expect(finished).toMatchObject({
      type: 'scenario-finished',
      observations: [
        {
          kind: 'outcome',
          execution: {
            mode: 'adaptive',
          },
          cost: { inferenceCount: 0 },
        },
      ],
    })
  })

  test('publishes redacted action evidence before the step and keeps its logical id across retries', async () => {
    const secret = 'customer-secret'
    let attempt = 0
    const actionScenario: Scenario = {
      ...scenario,
      steps: [
        {
          keyword: 'When',
          text: 'the customer submits <secret>',
          type: 'action',
          source: {
            line: 8,
            column: 5,
            excerpt: '    When the customer submits <secret>',
          },
        },
      ],
      runtimeBindings: [{ name: 'secret', value: secret }],
    }
    const run = await runScenario({
      specification,
      scenario: actionScenario,
      executionTargetProfile: { id: 'chrome' },
      retry: { infrastructureErrors: 0, functionalFailures: 1 },
      adapter: {
        async openSession() {
          attempt++
          return {
            async executeStep(_step, _signal, context) {
              const state = attempt === 1 ? 'failed' : 'passed'
              const evidence = await context?.recordAction?.({
                description: `Submit ${secret}`,
                startedAt: '2026-08-30T12:00:00.000Z',
                finishedAt: '2026-08-30T12:00:00.125Z',
                state,
                target: {
                  before: {
                    format: 'summary',
                    summary: `Form contains ${secret}`,
                    location: `https://${secret}:password@example.test/?token=${secret}`,
                  },
                  after: {
                    format: 'summary',
                    summary: `Result for ${secret}`,
                  },
                },
                screenshots: {
                  before: { state: 'not-requested' },
                  after: { state: 'not-requested' },
                },
                diagnostics: [
                  {
                    occurredAt: '2026-08-30T12:00:00.100Z',
                    level: 'info',
                    origin: 'adapter',
                    message: `Handled ${secret}`,
                  },
                ],
              })
              return {
                state,
                resolvedActions: evidence
                  ? [{ description: evidence.description, evidence }]
                  : [],
              }
            },
            async close() {},
          }
        },
      },
    })

    expect(run.events.map((event) => event.type)).toEqual([
      'scenario-started',
      'step-started',
      'action-finished',
      'step-finished',
      'scenario-finished',
      'scenario-started',
      'step-started',
      'action-finished',
      'step-finished',
      'scenario-finished',
    ])
    const actions = run.events.filter(
      (event) => event.type === 'action-finished',
    )
    expect(actions.map((event) => event.action.id)).toEqual([
      'step-1-action-1',
      'step-1-action-1',
    ])
    expect(actions.map((event) => event.scope.attempt)).toEqual([1, 2])
    expect(actions[0]).toMatchObject({
      action: {
        durationMs: 125,
        description: 'Submit <secret>',
        source: {
          uri: 'features/checkout.feature',
          line: 8,
          excerpt: '    When the customer submits <secret>',
        },
        target: {
          before: {
            summary: 'Form contains <secret>',
            location: 'https://example.test/?token=%3Credacted%3E',
          },
        },
        diagnostics: [{ message: 'Handled <secret>' }],
      },
    })
    expect(JSON.stringify(actions)).not.toContain(secret)
    expect(JSON.stringify(actions)).not.toContain('password')
  })
})
