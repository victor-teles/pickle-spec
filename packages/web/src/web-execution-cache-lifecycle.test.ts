import { describe, expect, mock, test } from 'bun:test'
import {
  type ExecutionCacheStore,
  runScenario,
  type SerializedExecutionCacheEnvelope,
} from '@pickle-spec/runner'
import { parseSpecification } from '@pickle-spec/spec'
import {
  createWebAdapter,
  type WebAutomation,
  type WebAutomationFactory,
  type WebExecutionCachePayload,
  type WebInstruction,
} from '../index'

function memoryStore() {
  const entries = new Map<string, string>()
  const writes: string[] = []
  const store: ExecutionCacheStore = {
    async read(key) {
      return entries.get(JSON.stringify(key))
    },
    async write(serialized: SerializedExecutionCacheEnvelope) {
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
  return { store, writes }
}

function factoryFor(automation: WebAutomation): WebAutomationFactory {
  return {
    async launch() {
      return {
        async openContext() {
          return automation
        },
        async close() {},
      }
    },
  }
}

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
    const scenario = specification.scenarios[0]!
    const executeInstruction = mock(async (_instruction: WebInstruction) => ({
      success: true,
    }))
    const automation: WebAutomation = {
      async navigate() {},
      async observe() {
        throw new Error('outcome-only Scenario must not observe actions')
      },
      async act() {
        throw new Error('outcome-only Scenario must not act')
      },
      async verify() {
        throw new Error('cacheable assertion must not use legacy verification')
      },
      async compileAssertion() {
        return { kind: 'visible', selector: '#ready' }
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

    const step = scenario.steps[0]!
    const execution = await session.executeStep(step, undefined, {
      stepIndex: 0,
      templateStep: step,
      runtimeBindings: [],
    })
    const completion = await session.complete?.()
    await session.close()
    await adapter.dispose?.()

    expect(execution.state).toBe('passed')
    expect(completion?.cacheCandidate?.cacheable).toBe(true)
    const payload = (
      completion?.cacheCandidate?.cacheable
        ? completion.cacheCandidate.adapterPayload
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

  test('executes the compiled representation and replays placeholders without AI calls', async () => {
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
    const scenario = specification.scenarios[0]!
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
        throw new Error('legacy act must not execute for a cacheable Scenario')
      },
      async verify() {
        throw new Error(
          'legacy verify must not execute for a cacheable Scenario',
        )
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
    const replay = await runScenario({ ...input, cachePolicy: 'cache-only' })

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
    expect(observe).toHaveBeenCalledTimes(1)
    expect(compileAssertion).toHaveBeenCalledTimes(1)
    expect(executeInstruction).toHaveBeenCalledTimes(6)
    expect(cache.writes).toHaveLength(1)
    expect(cache.writes[0]).not.toContain('alice@example.com')
    expect(cache.writes[0]).toContain('email')
    expect(JSON.stringify(adaptive.events)).not.toContain('alice@example.com')
  })

  test('passes but remains uncacheable when an operation is not deterministic', async () => {
    const specification = parseSpecification({
      uri: 'features/unsafe.feature',
      source: `
Feature: Unsafe operation
  Scenario: Run unsupported browser code
    When I run a custom browser callback
`,
    })
    const scenario = specification.scenarios[0]!
    const observe = mock(async () => [
      {
        description: 'Run custom code',
        handle: {
          selector: 'body',
          method: 'evaluate',
          arguments: ['document.body.remove()'],
        },
      },
    ])
    const act = mock(async () => ({ success: true }))
    const automation: WebAutomation = {
      async navigate() {},
      observe,
      act,
      async verify() {
        return { meetsExpectation: true, actualState: 'ready' }
      },
      async executeInstruction() {
        return { success: true }
      },
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

    const run = await runScenario({
      specification,
      scenario,
      executionTargetProfile: { id: 'web' },
      adapter,
      executionCache: {
        store: cache.store,
        projectKey: 'project-1',
        sourceRunId: 'run-unsafe',
      },
      applicationRevision: 'app-1',
    })

    expect(run.result).toMatchObject({
      state: 'passed',
      cacheOutcome: 'uncacheable',
      cacheUncacheableReason: 'non-deterministic-action',
    })
    expect(observe).toHaveBeenCalledTimes(1)
    expect(act).toHaveBeenCalledTimes(1)
    expect(cache.writes).toHaveLength(0)
  })

  test('flags Replay divergence so the runner controls fallback and cache-only', async () => {
    const specification = parseSpecification({
      uri: 'features/submit.feature',
      source: `
Feature: Submit
  Scenario: Submit the form
    When I click the submit button
`,
    })
    const scenario = specification.scenarios[0]!
    const observe = mock(async () => [
      {
        description: 'Click submit',
        handle: { selector: '#submit', method: 'click' },
      },
    ])
    let divergeNext = false
    const automation: WebAutomation = {
      async navigate() {},
      observe,
      async act() {
        return { success: true }
      },
      async verify() {
        return { meetsExpectation: true, actualState: 'ready' }
      },
      async executeInstruction() {
        if (divergeNext) {
          divergeNext = false
          return { success: false, message: 'Stored locator is stale' }
        }
        return { success: true }
      },
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
        sourceRunId: 'run-divergence',
      },
      applicationRevision: 'app-1',
    }

    await runScenario(input)
    divergeNext = true
    const fallback = await runScenario(input)
    divergeNext = true
    const strict = await runScenario({ ...input, cachePolicy: 'cache-only' })

    expect(fallback.result).toMatchObject({
      state: 'passed',
      cacheOutcome: 'fallback',
      executionMode: 'adaptive',
    })
    expect(fallback.events.map((event) => event.type)).toContain(
      'adaptive-fallback-started',
    )
    expect(strict.result).toMatchObject({
      state: 'failed',
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 0,
    })
    expect(observe).toHaveBeenCalledTimes(2)
  })
})
