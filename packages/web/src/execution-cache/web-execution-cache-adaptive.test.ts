import { describe, expect, mock, test } from 'bun:test'
import { finalScenarioAttempt, runScenario } from '@pickle-spec/runner'
import { parseSpecification } from '@pickle-spec/spec'
import {
  createWebAdapter,
  type WebAutomation,
  type WebExecutionCachePayload,
  type WebInstruction,
} from '../../index'
import { requiredValue } from '../required-value'
import { factoryFor, memoryStore } from './web-execution-cache.fixtures.test'

describe('web Execution cache lifecycle', () => {
  test('persists exactly the deterministic setup and assertion executed by Adaptive', async () => {
    const specification = parseSpecification({
      uri: 'features/status.feature',
      source: `
Feature: Status
  Scenario: Ready
    Then the ready indicator is visible
`,
    })
    const scenario = requiredValue(specification.scenarios[0])
    const observe = mock(async () => [
      {
        description: 'Ready indicator',
        handle: { selector: '#ready', method: 'click' },
      },
    ])
    const executeInstruction = mock(async (_instruction: WebInstruction) => ({
      success: true,
    }))
    const automation: WebAutomation = {
      async navigate() {},
      observe,
      async act() {
        throw new Error('cacheable assertion must not act')
      },
      async verify() {
        throw new Error('cacheable assertion must not use legacy verification')
      },
      async compileAssertion() {
        throw new Error(
          'cacheable assertion must not extract when observe found the element',
        )
      },
      executeInstruction,
      async screenshot() {
        return new Uint8Array()
      },
      async readIsolationState() {
        return { cookieCount: 0, storageKeyCount: 0 }
      },
      async close() {},
    }
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(automation),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
      mode: 'adaptive',
      scenarioTemplate: scenario.template,
      runtimeBindings: scenario.runtimeBindings,
    })

    const step = requiredValue(scenario.steps[0])
    const execution = await session.executeStep(step, undefined, {
      stepIndex: 0,
      templateStep: step,
      runtimeBindings: [],
    })
    const completion = await session.complete?.()
    await session.close()
    await adapter.dispose?.()

    expect(execution.state).toBe('passed')
    expect(observe).toHaveBeenCalledTimes(1)
    expect(completion?.replayRepresentation?.cacheable).toBe(true)
    const payload = (
      completion?.replayRepresentation?.cacheable
        ? completion.replayRepresentation.adapterPayload
        : undefined
    ) as WebExecutionCachePayload
    expect(payload.steps[0]?.instructions).toEqual(
      executeInstruction.mock.calls.map((call) => call[0]),
    )
    expect(payload.steps[0]?.instructions.map(({ kind }) => kind)).toEqual([
      'navigate',
      'visible',
    ])
  })

  test('compiles a compound cart Then from observe without extract', async () => {
    const specification = parseSpecification({
      uri: 'features/cart.feature',
      source: `
Feature: Shopping cart
  Scenario: Cart contains items
    Then the cart should contain "Sauce Labs Backpack" and "Sauce Labs Bike Light"
`,
    })
    const scenario = requiredValue(specification.scenarios[0])
    const compileAssertion = mock(async () => {
      throw new Error('compound Then must not extract')
    })
    const verify = mock(async () => {
      throw new Error('compound Then must not verify')
    })
    const executeInstruction = mock(async () => ({ success: true }))
    const automation: WebAutomation = {
      async navigate() {},
      async observe() {
        return [
          {
            description: 'Sauce Labs Backpack cart item',
            handle: { selector: '.inventory_item_name' },
          },
          {
            description: 'Sauce Labs Bike Light cart item',
            handle: { selector: '.inventory_item_name' },
          },
        ]
      },
      async act() {
        throw new Error('compound Then must not act')
      },
      verify,
      compileAssertion,
      executeInstruction,
      async screenshot() {
        return new Uint8Array()
      },
      async readIsolationState() {
        return { cookieCount: 0, storageKeyCount: 0 }
      },
      async close() {},
    }
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(automation),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
      mode: 'adaptive',
      scenarioTemplate: scenario.template,
      runtimeBindings: scenario.runtimeBindings,
    })

    const step = requiredValue(scenario.steps[0])
    const execution = await session.executeStep(step, undefined, {
      stepIndex: 0,
      templateStep: step,
      runtimeBindings: [],
    })
    const completion = await session.complete?.()
    await session.close()
    await adapter.dispose?.()

    expect(execution.state).toBe('passed')
    expect(compileAssertion).not.toHaveBeenCalled()
    expect(verify).not.toHaveBeenCalled()
    expect(completion?.replayRepresentation?.cacheable).toBe(true)
    const payload = (
      completion?.replayRepresentation?.cacheable
        ? completion.replayRepresentation.adapterPayload
        : undefined
    ) as WebExecutionCachePayload
    expect(payload.steps[0]?.instructions.map(({ kind }) => kind)).toEqual([
      'navigate',
      'text-contains',
      'text-contains',
    ])
  })

  test('does not publish parameterized AI output without value-free provenance', async () => {
    const specification = parseSpecification({
      uri: 'features/sign-in.feature',
      source: `
Feature: Sign in
  Scenario Outline: Sign in with an account
    When I fill the email field with <email>
    Then the email field value equals <email>

    Examples:
      | email             |
      | alice@example.com |
`,
    })
    const scenario = requiredValue(specification.scenarios[0])
    const observe = mock(async () => [
      {
        description: 'Fill the email field',
        handle: {
          selector: '#email',
          method: 'fill',
          arguments: ['alice@example.com'],
        },
      },
    ])
    const compileAssertion = mock(async () => ({
      kind: 'value-equals' as const,
      selector: '#email',
      expected: 'alice@example.com',
    }))
    const executeInstruction = mock(async () => ({ success: true }))
    const automation: WebAutomation = {
      async navigate() {},
      observe,
      async act() {
        return { success: true }
      },
      async verify() {
        return { meetsExpectation: true, actualState: 'value is present' }
      },
      compileAssertion,
      executeInstruction,
      async screenshot() {
        return new Uint8Array()
      },
      async readIsolationState() {
        return { cookieCount: 0, storageKeyCount: 0 }
      },
      async close() {},
    }
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(automation),
    )
    const cache = memoryStore()
    const input = {
      specification,
      scenario,
      executionTargetProfile: { id: 'web' },
      adapter,
      executionCache: {
        store: cache.store,
        projectKey: 'project-1',
        sourceRunId: 'run-1',
      },
      applicationRevision: 'app-1',
    }

    const adaptive = await runScenario(input)

    expect(finalScenarioAttempt(adaptive.result)).toMatchObject({
      state: 'passed',
      executionMode: 'adaptive',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'bound-parameter-value',
      inferenceCount: 4,
    })
    expect(observe).toHaveBeenCalledTimes(1)
    expect(compileAssertion).toHaveBeenCalledTimes(1)
    expect(executeInstruction).toHaveBeenCalledTimes(1)
    expect(cache.writes).toHaveLength(0)
    expect(JSON.stringify(adaptive.events)).not.toContain('alice@example.com')
  })
})
