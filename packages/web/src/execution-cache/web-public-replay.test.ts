import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  finalScenarioAttempt,
  openLocalExecutionCache,
  runScenario,
} from '@pickle-spec/runner'
import { parseSpecification } from '@pickle-spec/spec'
import {
  createWebAdapter,
  type WebAutomation,
  type WebAutomationFactory,
} from '../../index'

type ModelMethod = 'act' | 'compileAssertion' | 'observe' | 'verify'
type ExecutionMode = 'adaptive' | 'replay'
type ModelCalls = Record<ExecutionMode, Record<ModelMethod, number>>

interface GuardedFactoryOptions {
  adaptiveDelayMs?: number
}

interface GuardedFactoryEvidence {
  factory: WebAutomationFactory
  modelCalls: ModelCalls
  replayApiKeys: Array<string | undefined>
}

function emptyModelCalls(): ModelCalls {
  return {
    adaptive: { act: 0, compileAssertion: 0, observe: 0, verify: 0 },
    replay: { act: 0, compileAssertion: 0, observe: 0, verify: 0 },
  }
}

function guardedFactory(
  options: GuardedFactoryOptions = {},
): GuardedFactoryEvidence {
  const modelCalls = emptyModelCalls()
  const replayApiKeys: Array<string | undefined> = []

  function recordModelCall(method: ModelMethod, mode: ExecutionMode): void {
    modelCalls[mode][method]++
    if (mode === 'replay') {
      throw new Error(`${method} must not be called during Replay`)
    }
  }

  return {
    modelCalls,
    replayApiKeys,
    factory: {
      async launch() {
        return {
          async openContext(context) {
            const mode = context.mode ?? 'adaptive'
            if (mode === 'replay') {
              replayApiKeys.push(context.browser.modelApiKey)
            }
            const automation: WebAutomation = {
              async navigate() {},
              async observe() {
                recordModelCall('observe', mode)
                if (options.adaptiveDelayMs) {
                  await Bun.sleep(options.adaptiveDelayMs)
                }
                return [
                  {
                    description: 'Select settings',
                    handle: { selector: '#settings', method: 'click' },
                  },
                ]
              },
              async act() {
                recordModelCall('act', mode)
                return { success: true }
              },
              async verify() {
                recordModelCall('verify', mode)
                return { meetsExpectation: true, actualState: 'Ready' }
              },
              async compileAssertion() {
                recordModelCall('compileAssertion', mode)
                return { kind: 'visible', selector: '#ready' }
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
            return automation
          },
          async close() {},
        }
      },
    },
  }
}

function executionFixture() {
  const specification = parseSpecification({
    uri: 'features/account.feature',
    source: `
Feature: Account
  Scenario: Open account settings
    When I select account settings
    Then the account page is ready
`,
  })
  return { specification, scenario: specification.scenarios[0]! }
}

function parameterizedNavigationFixture() {
  const specification = parseSpecification({
    uri: 'features/private-account.feature',
    source: `
Feature: Private account
  Scenario Outline: Visit an account
    When I visit /accounts/<account>

    Examples:
      | account            |
      | private-account-42 |
`,
  })
  return { specification, scenario: specification.scenarios[0]! }
}

async function temporaryCacheWorkspace(prefix: string) {
  const workspace = await mkdtemp(join(tmpdir(), prefix))
  const projectRoot = join(workspace, 'project')
  await mkdir(projectRoot)
  return {
    workspace,
    projectRoot,
    cacheRoot: join(workspace, 'cache'),
  }
}

describe('public web Replay proof', () => {
  test('warms real SQLite adaptively and replays cache-only without model credentials or calls', async () => {
    const temporary = await temporaryCacheWorkspace('pickle-web-public-')
    const evidence = guardedFactory()
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      evidence.factory,
    )
    try {
      const cache = await openLocalExecutionCache({
        projectRoot: temporary.projectRoot,
        cacheRoot: temporary.cacheRoot,
      })
      const { specification, scenario } = executionFixture()
      const input = {
        specification,
        scenario,
        executionTargetProfile: { id: 'web' },
        adapter,
        executionCache: {
          store: cache,
          projectKey: cache.projectKey,
          sourceRunId: 'adaptive-run',
        },
        applicationRevision: 'app-1',
      }

      const adaptive = await runScenario(input)
      const replay = await runScenario({
        ...input,
        cachePolicy: 'cache-only',
        executionCache: {
          ...input.executionCache!,
          sourceRunId: 'replay-run',
        },
      })

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
        inferenceCount: 0,
      })
      expect(
        adaptiveAttempt.steps[0]?.resolvedActions.map(
          ({ description }) => description,
        ),
      ).toEqual(['Navigate to the resolved URL', 'Click the resolved locator'])
      expect(
        replayAttempt.steps[0]?.resolvedActions.map(
          ({ description }) => description,
        ),
      ).toEqual(['Navigate to the cached URL', 'Click the cached locator'])
      expect(evidence.modelCalls.adaptive).toEqual({
        act: 0,
        compileAssertion: 1,
        observe: 1,
        verify: 0,
      })
      expect(evidence.modelCalls.replay).toEqual({
        act: 0,
        compileAssertion: 0,
        observe: 0,
        verify: 0,
      })
      expect(evidence.replayApiKeys).toEqual([undefined])

      const entries = await cache.inspect()
      expect(entries).toHaveLength(1)
    } finally {
      await adapter.dispose?.()
      await rm(temporary.workspace, { recursive: true, force: true })
    }
  })

  test('persists only placeholders for a parameterized deterministic navigation', async () => {
    const temporary = await temporaryCacheWorkspace('pickle-web-values-')
    const privateValue = 'private-account-42'
    const evidence = guardedFactory()
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      evidence.factory,
    )
    try {
      const cache = await openLocalExecutionCache({
        projectRoot: temporary.projectRoot,
        cacheRoot: temporary.cacheRoot,
      })
      const { specification, scenario } = parameterizedNavigationFixture()
      const input = {
        specification,
        scenario,
        executionTargetProfile: { id: 'web' },
        adapter,
        executionCache: {
          store: cache,
          projectKey: cache.projectKey,
          sourceRunId: 'parameterized-adaptive',
        },
        applicationRevision: 'app-1',
      }

      const adaptive = await runScenario(input)
      const replay = await runScenario({ ...input, cachePolicy: 'cache-only' })
      const entries = await cache.inspect()
      const serialized = await cache.read(entries[0]!.key)

      expect(finalScenarioAttempt(adaptive.result)).toMatchObject({
        state: 'passed',
        executionMode: 'adaptive',
        cacheOutcome: 'miss',
      })
      expect(finalScenarioAttempt(replay.result)).toMatchObject({
        state: 'passed',
        executionMode: 'replay',
        cacheOutcome: 'hit',
        inferenceCount: 0,
      })
      expect(entries).toHaveLength(1)
      expect(serialized).toContain('account')
      expect(JSON.stringify(entries)).not.toContain(privateValue)
      expect(serialized).not.toContain(privateValue)
      expect(
        JSON.stringify([...adaptive.events, ...replay.events]),
      ).not.toContain(privateValue)
      expect(evidence.modelCalls.replay).toEqual({
        act: 0,
        compileAssertion: 0,
        observe: 0,
        verify: 0,
      })
    } finally {
      await adapter.dispose?.()
      await rm(temporary.workspace, { recursive: true, force: true })
    }
  })

  test('coordinates concurrent SQLite misses into one Adaptive evaluation per key', async () => {
    const temporary = await temporaryCacheWorkspace('pickle-web-lease-')
    const firstEvidence = guardedFactory({ adaptiveDelayMs: 75 })
    const secondEvidence = guardedFactory({ adaptiveDelayMs: 75 })
    const firstAdapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      firstEvidence.factory,
    )
    const secondAdapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      secondEvidence.factory,
    )
    try {
      const leaseTiming = {
        ttlMs: 2_000,
        heartbeatMs: 500,
        waitTimeoutMs: 2_000,
        minPollMs: 5,
        maxPollMs: 10,
      }
      const [firstCache, secondCache] = await Promise.all([
        openLocalExecutionCache({
          projectRoot: temporary.projectRoot,
          cacheRoot: temporary.cacheRoot,
          leaseTiming,
        }),
        openLocalExecutionCache({
          projectRoot: temporary.projectRoot,
          cacheRoot: temporary.cacheRoot,
          leaseTiming,
        }),
      ])
      const { specification, scenario } = executionFixture()
      const common = {
        specification,
        scenario,
        executionTargetProfile: { id: 'web' },
        applicationRevision: 'app-1',
      }

      const [first, second] = await Promise.all([
        runScenario({
          ...common,
          adapter: firstAdapter,
          executionCache: {
            store: firstCache,
            projectKey: firstCache.projectKey,
            sourceRunId: 'concurrent-first',
          },
        }),
        runScenario({
          ...common,
          adapter: secondAdapter,
          executionCache: {
            store: secondCache,
            projectKey: secondCache.projectKey,
            sourceRunId: 'concurrent-second',
          },
        }),
      ])

      const results = [first.result, second.result]
      expect(results.map((result) => result.state)).toEqual([
        'passed',
        'passed',
      ])
      expect(
        results.filter(
          (result) => finalScenarioAttempt(result).executionMode === 'adaptive',
        ),
      ).toHaveLength(1)
      expect(
        results.filter(
          (result) => finalScenarioAttempt(result).executionMode === 'replay',
        ),
      ).toHaveLength(1)
      expect(
        firstEvidence.modelCalls.adaptive.observe +
          secondEvidence.modelCalls.adaptive.observe,
      ).toBe(1)
      expect(await firstCache.inspect()).toHaveLength(1)
    } finally {
      await Promise.all([firstAdapter.dispose?.(), secondAdapter.dispose?.()])
      await rm(temporary.workspace, { recursive: true, force: true })
    }
  })
})
