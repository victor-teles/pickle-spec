import { describe, expect, mock, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  type ExecutionCacheStore,
  finalScenarioAttempt,
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
} from '../../index'

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

  test('uses value-free screenshot paths across parameterized Adaptive and Replay runs', async () => {
    const artifactDirectory = await mkdtemp(
      join(tmpdir(), 'pickle-web-cache-screenshots-'),
    )
    try {
      const specification = parseSpecification({
        uri: 'features/account.feature',
        source: `
Feature: Account
  Scenario Outline: Open an account
    When I visit /accounts/<account>

    Examples:
      | account            |
      | private-account-42 |
`,
      })
      const scenario = specification.scenarios[0]!
      const executeInstruction = mock(async () => ({ success: true }))
      const automation: WebAutomation = {
        async navigate() {},
        async observe() {
          throw new Error('deterministic navigation must not call AI')
        },
        async act() {
          throw new Error('deterministic navigation must not call AI')
        },
        async verify() {
          throw new Error('deterministic navigation must not call AI')
        },
        executeInstruction,
        async screenshot() {
          return new TextEncoder().encode('image')
        },
        async readIsolationState() {
          return { cookieCount: 0, storageKeyCount: 0 }
        },
        async close() {},
      }
      const adapter = createWebAdapter(
        {
          baseUrl: 'https://example.test',
          screenshots: { mode: 'on-step', outputDir: artifactDirectory },
        },
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
          sourceRunId: 'run-screenshot',
        },
        applicationRevision: 'app-1',
      }

      const adaptive = await runScenario(input)
      const replay = await runScenario({ ...input, cachePolicy: 'cache-only' })
      await adapter.dispose?.()

      const adaptiveAttempt = finalScenarioAttempt(adaptive.result)
      const replayAttempt = finalScenarioAttempt(replay.result)
      expect(adaptiveAttempt).toMatchObject({
        state: 'passed',
        executionMode: 'adaptive',
        cacheOutcome: 'miss',
      })
      expect(replayAttempt).toMatchObject({
        state: 'passed',
        executionMode: 'replay',
        cacheOutcome: 'hit',
      })
      const adaptivePath = adaptiveAttempt.steps[0]?.artifacts?.[0]?.path
      const replayPath = replayAttempt.steps[0]?.artifacts?.[0]?.path
      expect(adaptivePath).toMatch(
        /specification-[a-f0-9]{16}\/scenario-[a-f0-9]{16}\/examples-row-[a-f0-9]{16}\/step-01-passed\.png$/,
      )
      expect(replayPath).toBe(adaptivePath)
      expect(cache.writes).toHaveLength(1)
      const persistedAndReported = JSON.stringify({
        writes: cache.writes,
        adaptive,
        replay,
      })
      expect(persistedAndReported).not.toContain('private-account-42')
      expect(executeInstruction).toHaveBeenCalledTimes(2)
    } finally {
      await rm(artifactDirectory, { recursive: true, force: true })
    }
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

    expect(finalScenarioAttempt(run.result)).toMatchObject({
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

    expect(finalScenarioAttempt(fallback.result)).toMatchObject({
      state: 'failed',
      executionMode: 'replay',
    })
    expect(fallback.events.map((event) => event.type)).not.toContain(
      'adaptive-fallback-started',
    )
    expect(finalScenarioAttempt(strict.result)).toMatchObject({
      state: 'failed',
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 0,
    })
    expect(observe).toHaveBeenCalledTimes(1)
  })
})
