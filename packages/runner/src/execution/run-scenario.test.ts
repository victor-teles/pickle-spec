import type { Scenario, Specification } from '@pickle-spec/spec'
import { describe, expect, test, vi } from 'vitest'
import {
  type ExecutionTargetAdapter,
  type OpenSessionInput,
  runScenario,
} from '../../index'
import { requiredValue } from '../required-value'

type TimedRunScenarioInput = Parameters<typeof runScenario>[0] & {
  now: () => Date
}

type ScenarioRunResult = Awaited<ReturnType<typeof runScenario>>['result']

function finalAttempt(result: ScenarioRunResult) {
  return requiredValue(result.attempts.at(-1))
}

const scenario: Scenario = {
  name: 'Complete a purchase',
  tags: [],
  steps: [
    { keyword: 'Given', text: 'a product is in the basket', type: 'context' },
    { keyword: 'Then', text: 'the purchase succeeds', type: 'outcome' },
  ],
}

const specification: Specification = {
  name: 'Checkout',
  source: { uri: 'features/checkout.feature', language: 'en' },
  tags: [],
  scenarios: [scenario],
}

describe('runScenario', () => {
  test('records one canonical Scenario attempt with deterministic evidence timing and durable scope', async () => {
    const timestamps = [
      '2026-08-22T12:00:00.000Z',
      '2026-08-22T12:00:01.000Z',
      '2026-08-22T12:00:02.000Z',
      '2026-08-22T12:00:03.000Z',
      '2026-08-22T12:00:04.000Z',
      '2026-08-22T12:00:05.000Z',
    ]
    let timestampIndex = 0
    const outlinedScenario: Scenario = {
      ...scenario,
      id: 'scn-checkout-payment',
      examplesId: 'examples-payment-method',
      examplesRowId: 'row-credit-card',
    }
    const input: TimedRunScenarioInput = {
      specification,
      scenario: outlinedScenario,
      executionTargetProfile: {
        id: 'chrome',
        adapter: 'web',
        capabilities: ['screenshots'],
      },
      adapter: {
        async openSession() {
          return {
            async executeStep(step) {
              return {
                state: 'passed',
                resolvedActions: [{ description: `Performed: ${step.text}` }],
              }
            },
            async close() {},
          }
        },
      },
      now: () => new Date(requiredValue(timestamps[timestampIndex++])),
    }

    const run = await runScenario(input)
    const scope = {
      scenarioId: 'scn-checkout-payment',
      examplesRowId: 'row-credit-card',
      executionTargetProfileId: 'chrome',
      attempt: 1,
    }

    expect(run.events).toMatchObject([
      {
        schemaVersion: 2,
        sequence: 1,
        type: 'scenario-started',
        occurredAt: timestamps[0],
        scope,
      },
      {
        schemaVersion: 2,
        sequence: 2,
        type: 'step-started',
        occurredAt: timestamps[1],
        scope: { ...scope, stepIndex: 0 },
      },
      {
        schemaVersion: 2,
        sequence: 3,
        type: 'step-finished',
        occurredAt: timestamps[2],
        scope: { ...scope, stepIndex: 0 },
      },
      {
        schemaVersion: 2,
        sequence: 4,
        type: 'step-started',
        occurredAt: timestamps[3],
        scope: { ...scope, stepIndex: 1 },
      },
      {
        schemaVersion: 2,
        sequence: 5,
        type: 'step-finished',
        occurredAt: timestamps[4],
        scope: { ...scope, stepIndex: 1 },
      },
      {
        schemaVersion: 2,
        sequence: 6,
        type: 'scenario-finished',
        occurredAt: timestamps[5],
        scope,
        attempt: {
          attempt: 1,
          startedAt: timestamps[0],
          finishedAt: timestamps[5],
          durationMs: 5_000,
          state: 'passed',
        },
      },
    ])
    expect(run.result).toMatchObject({
      schemaVersion: 2,
      specification: {
        name: 'Checkout',
        uri: 'features/checkout.feature',
      },
      scenario: {
        id: 'scn-checkout-payment',
        name: 'Complete a purchase',
        examplesId: 'examples-payment-method',
        examplesRowId: 'row-credit-card',
      },
      executionTargetProfile: {
        id: 'chrome',
        adapter: 'web',
        capabilities: ['screenshots'],
      },
      state: 'passed',
      startedAt: timestamps[0],
      finishedAt: timestamps[5],
      durationMs: 5_000,
      attempts: [
        {
          attempt: 1,
          startedAt: timestamps[0],
          finishedAt: timestamps[5],
          durationMs: 5_000,
          state: 'passed',
          executionMode: 'adaptive',
          steps: [
            {
              index: 0,
              startedAt: timestamps[1],
              finishedAt: timestamps[2],
              durationMs: 1_000,
              state: 'passed',
              resolvedActions: [
                { description: 'Performed: a product is in the basket' },
              ],
            },
            {
              index: 1,
              startedAt: timestamps[3],
              finishedAt: timestamps[4],
              durationMs: 1_000,
              state: 'passed',
              resolvedActions: [
                { description: 'Performed: the purchase succeeds' },
              ],
            },
          ],
        },
      ],
    })
  })

  test('emits versioned events and materializes a passed test result', async () => {
    const close = vi.fn(async () => {})
    const adapter: ExecutionTargetAdapter = {
      async openSession() {
        return {
          async executeStep(step) {
            return {
              state: 'passed',
              resolvedActions: [{ description: `Performed: ${step.text}` }],
            }
          },
          close,
        }
      },
    }

    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'deterministic' },
      adapter,
    })

    expect(
      run.events.map((event) => [
        event.schemaVersion,
        event.sequence,
        event.type,
      ]),
    ).toEqual([
      [2, 1, 'scenario-started'],
      [2, 2, 'step-started'],
      [2, 3, 'step-finished'],
      [2, 4, 'step-started'],
      [2, 5, 'step-finished'],
      [2, 6, 'scenario-finished'],
    ])
    expect(run.result).toMatchObject({
      schemaVersion: 2,
      specification: {
        name: 'Checkout',
        uri: 'features/checkout.feature',
      },
      scenario: { name: 'Complete a purchase' },
      executionTargetProfile: { id: 'deterministic' },
      state: 'passed',
      attempts: [
        {
          executionMode: 'adaptive',
          steps: [
            {
              step: {
                keyword: 'Given',
                text: 'a product is in the basket',
                type: 'context',
              },
              state: 'passed',
              resolvedActions: [
                { description: 'Performed: a product is in the basket' },
              ],
            },
            {
              step: {
                keyword: 'Then',
                text: 'the purchase succeeds',
                type: 'outcome',
              },
              state: 'passed',
              resolvedActions: [
                { description: 'Performed: the purchase succeeds' },
              ],
            },
          ],
        },
      ],
    })
    expect(typeof run.result.scenario.id).toBe('string')
    expect(run.result.durationMs).toBeGreaterThanOrEqual(0)
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('preserves adapter-reported evidence capture failures on the attempt', async () => {
    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: {
        id: 'chrome',
        adapter: 'web',
        capabilities: ['screenshots'],
      },
      adapter: {
        async openSession() {
          return {
            async executeStep() {
              return {
                state: 'passed',
                resolvedActions: [],
                evidenceAvailability: [
                  {
                    kind: 'screenshot',
                    state: 'capture-failed',
                    message: 'Screenshot capture failed',
                  },
                ],
              }
            },
            async close() {},
          }
        },
      },
    })

    expect(finalAttempt(run.result).evidenceAvailability).toContainEqual({
      kind: 'screenshot',
      state: 'capture-failed',
      message: 'Screenshot capture failed',
    })
  })

  test('copies adapter fidelityPolicy onto the test result', async () => {
    const adapter: ExecutionTargetAdapter = {
      fidelityPolicy: {
        profile: 'fast',
        tradeOffs: ['block-image', 'disable-animations'],
      },
      async openSession() {
        return {
          async executeStep(step) {
            return {
              state: 'passed',
              resolvedActions: [{ description: step.text }],
            }
          },
          close: async () => {},
        }
      },
    }

    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'web' },
      adapter,
    })

    expect(finalAttempt(run.result).fidelityPolicy).toEqual({
      profile: 'fast',
      tradeOffs: ['block-image', 'disable-animations'],
    })
  })

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

  test('attaches normalized observations to step and scenario completion events', async () => {
    const timestamps = [
      '2026-08-22T13:00:00.000Z',
      '2026-08-22T13:00:01.000Z',
      '2026-08-22T13:00:02.000Z',
      '2026-08-22T13:00:03.000Z',
    ]
    let timestampIndex = 0
    const singleStepScenario: Scenario = {
      id: 'scn-checkout-receipt',
      name: 'Capture the receipt',
      tags: [],
      steps: [
        {
          keyword: 'Then',
          text: 'the receipt appears',
          type: 'outcome',
        },
      ],
    }
    const run = await runScenario({
      specification,
      scenario: singleStepScenario,
      executionTargetProfile: {
        id: 'chrome',
        adapter: 'web',
        capabilities: ['screenshots'],
      },
      adapter: {
        async openSession() {
          return {
            async executeStep() {
              return {
                state: 'passed',
                resolvedActions: [{ description: 'Assert receipt on chrome' }],
                artifacts: [
                  {
                    kind: 'screenshot',
                    path: '/tmp/receipt.png',
                    mediaType: 'image/png',
                  },
                ],
                trace: [
                  {
                    occurredAt: '2026-08-22T13:00:01.500Z',
                    causalAt: '2026-08-22T13:00:01.250Z',
                    kind: 'browser-activity',
                    description: 'Captured receipt screenshot',
                  },
                ],
              }
            },
            async complete() {
              return { inferenceCount: 2 }
            },
            async close() {},
          }
        },
      },
      now: () => new Date(requiredValue(timestamps[timestampIndex++])),
    })

    const stepFinished = run.events.find(
      (event) => event.type === 'step-finished',
    )
    expect(stepFinished).toMatchObject({
      type: 'step-finished',
      observations: [
        {
          version: 1,
          kind: 'outcome',
          summary: 'Then the receipt appears passed',
          timing: {
            occurredAt: timestamps[2],
            precision: 'step-finish',
            startedAt: timestamps[1],
            finishedAt: timestamps[2],
            durationMs: 1_000,
          },
          outcome: { state: 'passed' },
        },
        {
          version: 1,
          kind: 'activity',
          summary: 'Captured receipt screenshot',
          timing: {
            occurredAt: '2026-08-22T13:00:01.500Z',
            precision: 'exact',
            startedAt: timestamps[1],
            finishedAt: timestamps[2],
            durationMs: 1_000,
            causalAt: '2026-08-22T13:00:01.250Z',
          },
          activity: {
            kind: 'browser-activity',
            description: 'Captured receipt screenshot',
          },
        },
        {
          version: 1,
          kind: 'artifact',
          summary: 'Captured screenshot',
          timing: {
            occurredAt: timestamps[2],
            precision: 'step-finish',
          },
          artifact: {
            kind: 'screenshot',
            path: '/tmp/receipt.png',
            mediaType: 'image/png',
          },
        },
      ],
    })

    const scenarioFinished = run.events.find(
      (event) => event.type === 'scenario-finished',
    )
    expect(scenarioFinished).toMatchObject({
      type: 'scenario-finished',
      observations: [
        {
          version: 1,
          kind: 'outcome',
          summary: 'Capture the receipt passed in adaptive mode',
          timing: {
            occurredAt: timestamps[3],
            precision: 'attempt-finish',
            startedAt: timestamps[0],
            finishedAt: timestamps[3],
            durationMs: 3_000,
          },
          versions: [
            {
              subject: 'contract',
              label: 'run-event-schema',
              value: '2',
            },
          ],
          outcome: { state: 'passed' },
          cost: { inferenceCount: 2 },
          execution: { mode: 'adaptive' },
        },
      ],
    })
  })

  test('records a runner Diagnostic entry when a logical session cannot be opened', async () => {
    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'unavailable' },
      adapter: {
        async openSession() {
          throw new Error('Execution target is unavailable')
        },
      },
    })

    expect(finalAttempt(run.result).diagnostics).toEqual([
      expect.objectContaining({
        level: 'error',
        origin: 'runner',
        message: 'Execution target is unavailable',
        scenarioName: 'Complete a purchase',
        executionTargetProfileId: 'unavailable',
      }),
    ])
    expect(run.events.map((event) => event.type)).toEqual([
      'scenario-started',
      'scenario-finished',
    ])
  })

  test('materializes cancellation without opening a logical session when already aborted', async () => {
    const openSession = vi.fn(async () => {
      throw new Error('must not open')
    })
    const controller = new AbortController()
    controller.abort()

    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'deterministic' },
      adapter: { openSession },
      signal: controller.signal,
    })

    expect(run.result).toMatchObject({
      schemaVersion: 2,
      state: 'cancelled',
      attempts: [
        {
          steps: [],
          message: 'Scenario cancelled before the logical session started',
        },
      ],
    })
    expect(run.events.map((event) => event.type)).toEqual([
      'scenario-started',
      'scenario-finished',
    ])
    expect(openSession).not.toHaveBeenCalled()
  })

  test('materializes cancellation when the signal aborts while a step resolves normally', async () => {
    const controller = new AbortController()
    const close = vi.fn(async () => {})

    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'deterministic' },
      adapter: {
        async openSession() {
          return {
            async executeStep() {
              controller.abort()
              return {
                state: 'passed',
                resolvedActions: [
                  { description: 'Completed after cancellation' },
                ],
              }
            },
            close,
          }
        },
      },
      signal: controller.signal,
    })

    expect(run.result).toMatchObject({
      state: 'cancelled',
      attempts: [
        {
          message: 'Scenario cancelled during step execution',
          steps: [{ state: 'cancelled' }],
        },
      ],
    })
    expect(run.events.map((event) => event.type)).toEqual([
      'scenario-started',
      'step-started',
      'step-finished',
      'scenario-finished',
    ])
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('materializes an infrastructure error when the adapter cannot open a logical session', async () => {
    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'unavailable-target' },
      adapter: {
        async openSession() {
          throw new Error('Execution target is unavailable')
        },
      },
    })

    expect(run.result).toMatchObject({
      schemaVersion: 2,
      executionTargetProfile: { id: 'unavailable-target' },
      state: 'infrastructure-error',
      attempts: [
        {
          steps: [],
          message: 'Execution target is unavailable',
        },
      ],
    })
    expect(run.events.map((event) => event.type)).toEqual([
      'scenario-started',
      'scenario-finished',
    ])
  })

  test('materializes isolation verification failure as an infrastructure error', async () => {
    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'web' },
      adapter: {
        async openSession() {
          throw new Error('Logical session isolation verification failed')
        },
      },
      retry: { infrastructureErrors: 0 },
    })

    expect(run.result).toMatchObject({
      state: 'infrastructure-error',
      attempts: [{ message: 'Logical session isolation verification failed' }],
    })
  })

  test('materializes an adapter exception during a step as an infrastructure error', async () => {
    const close = vi.fn(async () => {})
    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'unstable-target' },
      adapter: {
        async openSession() {
          return {
            async executeStep() {
              throw new Error('Target connection was lost')
            },
            close,
          }
        },
      },
    })

    expect(run.result).toMatchObject({
      state: 'infrastructure-error',
      attempts: [
        {
          message: 'Target connection was lost',
          steps: [
            {
              state: 'infrastructure-error',
              message: 'Target connection was lost',
            },
          ],
        },
      ],
    })
    expect(run.events.map((event) => event.type)).toEqual([
      'scenario-started',
      'step-started',
      'step-finished',
      'scenario-finished',
    ])
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('keeps an executeScenario infrastructure error when complete cannot run', async () => {
    const complete = vi.fn(async () => {
      throw new Error('Mobile logical session did not execute')
    })
    const close = vi.fn(async () => {})
    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'android' },
      adapter: {
        async openSession() {
          return {
            async executeScenario() {
              throw new Error(
                'Agent Device Replay called a semantic inference route outside replay.run',
              )
            },
            complete,
            close,
          }
        },
      },
    })

    expect(run.result).toMatchObject({
      state: 'infrastructure-error',
      attempts: [
        {
          message:
            'Agent Device Replay called a semantic inference route outside replay.run',
        },
      ],
    })
    expect(complete).not.toHaveBeenCalled()
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('materializes a logical-session close exception as an infrastructure error', async () => {
    const run = await runScenario({
      specification,
      scenario: { ...scenario, steps: scenario.steps.slice(0, 1) },
      executionTargetProfile: { id: 'unstable-target' },
      adapter: {
        async openSession() {
          return {
            async executeStep() {
              return { state: 'passed', resolvedActions: [] }
            },
            async close() {
              throw new Error('Could not release the logical session')
            },
          }
        },
      },
    })

    expect(run.result).toMatchObject({
      state: 'infrastructure-error',
      attempts: [{ message: 'Could not release the logical session' }],
    })
    expect(run.events.at(-1)).toMatchObject({
      type: 'scenario-finished',
      attempt: { state: 'infrastructure-error' },
    })
  })

  test('retries infrastructure errors in a fresh logical session and marks later success flaky', async () => {
    let attempt = 0
    const close = vi.fn(async () => {})
    const openSession = vi.fn(async () => {
      attempt++
      return {
        async executeStep() {
          if (attempt === 1) throw new Error('Browser process exited')
          return { state: 'passed' as const, resolvedActions: [] }
        },
        close,
      }
    })

    const run = await runScenario({
      specification,
      scenario: { ...scenario, steps: scenario.steps.slice(0, 1) },
      executionTargetProfile: { id: 'web' },
      adapter: { openSession },
      retry: { infrastructureErrors: 1 },
    })

    expect(run.result).toMatchObject({
      state: 'passed',
      attempts: [
        { attempt: 1, state: 'infrastructure-error' },
        { attempt: 2, state: 'passed' },
      ],
      flaky: true,
    })
    expect(openSession).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(2)
  })

  test('retries functional failures only when explicit policy allows it', async () => {
    let attempt = 0
    const close = vi.fn(async () => {})
    const openSession = vi.fn(async () => {
      attempt++
      return {
        async executeStep() {
          if (attempt === 1) {
            return {
              state: 'failed' as const,
              resolvedActions: [],
              message: 'Product behavior failed',
            }
          }
          return { state: 'passed' as const, resolvedActions: [] }
        },
        close,
      }
    })

    const withoutPolicy = await runScenario({
      specification,
      scenario: { ...scenario, steps: scenario.steps.slice(0, 1) },
      executionTargetProfile: { id: 'web' },
      adapter: { openSession },
      retry: { infrastructureErrors: 0, functionalFailures: 0 },
    })
    expect(withoutPolicy.result.state).toBe('failed')
    expect(openSession).toHaveBeenCalledTimes(1)

    attempt = 0
    openSession.mockClear()
    close.mockClear()

    const withPolicy = await runScenario({
      specification,
      scenario: { ...scenario, steps: scenario.steps.slice(0, 1) },
      executionTargetProfile: { id: 'web' },
      adapter: { openSession },
      retry: { infrastructureErrors: 0, functionalFailures: 1 },
    })
    expect(withPolicy.result).toMatchObject({
      state: 'passed',
      attempts: [
        { attempt: 1, state: 'failed' },
        { attempt: 2, state: 'passed' },
      ],
      flaky: true,
    })
    expect(openSession).toHaveBeenCalledTimes(2)
    expect(close).toHaveBeenCalledTimes(2)
  })

  test('aborts a timed-out step and closes its logical session', async () => {
    const close = vi.fn(async () => {})
    const run = await runScenario({
      specification,
      scenario: { ...scenario, steps: scenario.steps.slice(0, 1) },
      executionTargetProfile: { id: 'web' },
      adapter: {
        async openSession() {
          return {
            async executeStep(_step, signal) {
              await new Promise((_resolve, reject) => {
                signal?.addEventListener(
                  'abort',
                  () => reject(new DOMException('Aborted', 'AbortError')),
                  {
                    once: true,
                  },
                )
              })
              return { state: 'passed', resolvedActions: [] }
            },
            close,
          }
        },
      },
      timeout: { stepMs: 5 },
    })

    expect(run.result).toMatchObject({
      state: 'infrastructure-error',
      attempts: [{ message: 'Step exceeded its 5ms deadline' }],
    })
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('runs a custom adapter only in Adaptive and rejects cache-only before opening', async () => {
    const openSession = vi.fn(async (sessionInput: OpenSessionInput) => ({
      async executeStep() {
        return { state: 'passed' as const, resolvedActions: [] }
      },
      async close() {},
      mode: sessionInput.mode,
    }))
    const adapter: ExecutionTargetAdapter = { openSession }
    const runInput = {
      specification,
      scenario,
      executionTargetProfile: { id: 'custom' },
      adapter,
    }

    const adaptive = await runScenario(runInput)
    const cacheOnly = await runScenario({
      ...runInput,
      cachePolicy: 'cache-only',
    })

    expect(adaptive.result).toMatchObject({
      state: 'passed',
      attempts: [{ executionMode: 'adaptive' }],
    })
    expect(cacheOnly.result).toMatchObject({
      state: 'failed',
      attempts: [
        {
          executionMode: 'replay',
          failureKind: 'cache-miss',
          inferenceCount: 0,
        },
      ],
    })
    expect(openSession).toHaveBeenCalledTimes(1)
    expect(openSession).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'adaptive' }),
    )
  })
})
