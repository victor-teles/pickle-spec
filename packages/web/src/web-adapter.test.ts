import { afterAll, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Scenario, Specification } from '@pickle-spec/spec'
import {
  createWebAdapter,
  validateWebAdapterOptions,
  type WebAutomation,
  type WebAutomationFactory,
} from '../index'

function stubAutomation(overrides: Partial<WebAutomation> = {}): WebAutomation {
  return {
    async navigate() {},
    async observe() {
      return []
    },
    async act() {
      return { success: true }
    },
    async verify() {
      return { meetsExpectation: true, actualState: 'Ready' }
    },
    async screenshot() {
      return new Uint8Array()
    },
    async readIsolationState() {
      return { cookieCount: 0, storageKeyCount: 0 }
    },
    async close() {},
    ...overrides,
  }
}

function factoryFor(automation: WebAutomation): WebAutomationFactory {
  return {
    launch: mock(async () => ({
      openContext: mock(async () => automation),
      close: mock(async () => {}),
    })),
  }
}

const scenario: Scenario = {
  name: 'Search for pickles',
  tags: ['@web'],
  steps: [
    { keyword: 'Given', text: 'I navigate to /search', type: 'context' },
    { keyword: 'When', text: 'I search for pickles', type: 'action' },
    { keyword: 'Then', text: 'pickle results are visible', type: 'outcome' },
  ],
}

const specification: Specification = {
  name: 'Search',
  source: { uri: 'features/search.feature', language: 'en' },
  tags: ['@web'],
  scenarios: [scenario],
}

const clearedGoogleApiKeys = {
  GOOGLE_API_KEY: undefined,
  GOOGLE_GENERATIVE_AI_API_KEY: undefined,
  GEMINI_API_KEY: undefined,
}

async function withEnv(
  values: Record<string, string | undefined>,
  run: () => Promise<void>,
): Promise<void> {
  const previous = Object.fromEntries(
    Object.keys(values).map((name) => [name, process.env[name]]),
  )
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  try {
    await run()
  } finally {
    for (const name of Object.keys(values)) {
      if (previous[name] === undefined) delete process.env[name]
      else process.env[name] = previous[name]
    }
  }
}

describe('createWebAdapter', () => {
  const artifactDirectories: string[] = []

  afterAll(async () => {
    await Promise.all(
      artifactDirectories.map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
    )
  })

  test('translates web automation into resolved actions, runner states, and screenshot artifacts', async () => {
    const artifactDirectory = await mkdtemp(
      join(tmpdir(), 'pickle-web-artifacts-'),
    )
    artifactDirectories.push(artifactDirectory)
    const navigate = mock(async () => {})
    const observe = mock(async () => [
      { description: 'Fill the search field', handle: { selector: '#search' } },
    ])
    const act = mock(async () => ({ success: true }))
    const verify = mock(async () => ({
      meetsExpectation: false,
      actualState: 'No results were shown',
    }))
    const close = mock(async () => {})
    const adapter = createWebAdapter(
      {
        baseUrl: 'https://example.test',
        screenshots: { mode: 'on-step', outputDir: artifactDirectory },
      },
      factoryFor(
        stubAutomation({
          navigate,
          observe,
          act,
          verify,
          async screenshot() {
            return new Uint8Array([137, 80, 78, 71])
          },
          close,
        }),
      ),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })

    const navigation = await session.executeStep(scenario.steps[0]!)
    const action = await session.executeStep(scenario.steps[1]!)
    const outcome = await session.executeStep(scenario.steps[2]!)
    await session.close()

    expect(navigate).toHaveBeenCalledWith(
      'https://example.test/search',
      undefined,
    )
    expect(action).toMatchObject({
      state: 'passed',
      resolvedActions: [{ description: 'Fill the search field' }],
      artifacts: [{ kind: 'screenshot', mediaType: 'image/png' }],
    })
    expect(outcome).toMatchObject({
      state: 'failed',
      message:
        'Expected: "pickle results are visible" | Actual: No results were shown',
      artifacts: [{ kind: 'screenshot', mediaType: 'image/png' }],
    })
    expect(navigation.artifacts?.[0]?.path).toContain(artifactDirectory)
    expect(await Bun.file(navigation.artifacts![0]!.path).exists()).toBe(true)
    expect(observe).toHaveBeenCalledTimes(1)
    expect(act).toHaveBeenCalledTimes(1)
    expect(verify).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('gives explicit navigation precedence for an action step', async () => {
    const navigate = mock(async () => {})
    const observe = mock(async () => [])
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(stubAutomation({ navigate, observe })),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })

    const result = await session.executeStep({
      keyword: 'When',
      text: 'I navigate to /checkout',
      type: 'action',
    })
    await session.close()

    expect(result).toMatchObject({
      state: 'passed',
      resolvedActions: [
        { description: 'Navigate to https://example.test/checkout' },
      ],
    })
    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith(
      'https://example.test/checkout',
      undefined,
    )
    expect(observe).not.toHaveBeenCalled()
  })

  test('rejects an unsupported Stagehand model', () => {
    expect(() =>
      validateWebAdapterOptions({
        baseUrl: 'https://example.test',
        browser: { modelName: 'google/gemini-3.7-flash' },
      }),
    ).toThrow(
      'web.browser.modelName "google/gemini-3.7-flash" is not a Stagehand-supported model',
    )
  })

  test('accepts a Stagehand-supported model name', () => {
    expect(() =>
      validateWebAdapterOptions({
        baseUrl: 'https://example.test',
        browser: { modelName: 'google/gemini-3.6-flash' },
      }),
    ).not.toThrow()
  })

  test('forwards GOOGLE_API_KEY to the automation factory for a Google model', async () => {
    const openContext = mock(async () => stubAutomation())
    const launch = mock(async () => ({
      openContext,
      close: mock(async () => {}),
    }))
    await withEnv(
      { ...clearedGoogleApiKeys, GOOGLE_API_KEY: 'test-google-key' },
      async () => {
        const adapter = createWebAdapter(
          {
            baseUrl: 'https://example.test',
            browser: { modelName: 'google/gemini-3.6-flash' },
          },
          { launch },
        )
        const session = await adapter.openSession({
          executionTargetProfile: { id: 'web' },
          specification,
          scenario,
        })
        await session.close()
      },
    )

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        browser: expect.objectContaining({ modelApiKey: 'test-google-key' }),
      }),
    )
  })

  test('rejects a local Stagehand session without a provider API key before launching a browser', async () => {
    const adapter = createWebAdapter({
      baseUrl: 'https://example.test',
      browser: { modelName: 'google/gemini-3.6-flash' },
    })
    await withEnv(clearedGoogleApiKeys, async () => {
      await expect(
        adapter.openSession({
          executionTargetProfile: { id: 'web' },
          specification,
          scenario,
        }),
      ).rejects.toThrow(
        'Model inference requires a provider API key or a Browserbase session',
      )
    })
  })

  test('replays multiple planned actions without model action resolution', async () => {
    const observe = mock(async () => [
      { description: 'Must not resolve', handle: { selector: '#new' } },
    ])
    const act = mock(async () => ({ success: true }))
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(stubAutomation({ observe, act })),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
      mode: 'replay',
      plan: {
        schemaVersion: 1,
        scenarioId: 'search',
        scenarioRevision: 'rev',
        executionTargetProfileId: 'web',
        planFormatVersion: 'web.1',
        steps: [
          {
            resolvedActions: [
              { description: 'Navigate to https://example.test/search' },
            ],
          },
          {
            resolvedActions: [
              {
                description: 'Fill the search field',
                replay: { selector: '#search' },
              },
              {
                description: 'Submit the search',
                replay: { selector: '#go' },
              },
            ],
          },
          {
            resolvedActions: [
              { description: 'Verify: pickle results are visible' },
            ],
          },
        ],
      },
    })

    await session.executeStep(scenario.steps[0]!)
    const action = await session.executeStep(scenario.steps[1]!)
    await session.close()

    expect(action).toMatchObject({
      state: 'passed',
      resolvedActions: [
        {
          description: 'Fill the search field',
          replay: { selector: '#search' },
        },
        { description: 'Submit the search', replay: { selector: '#go' } },
      ],
    })
    expect(observe).not.toHaveBeenCalled()
    expect(act).toHaveBeenCalledTimes(2)
    expect(act).toHaveBeenNthCalledWith(
      1,
      { description: 'Fill the search field', handle: { selector: '#search' } },
      undefined,
    )
    expect(act).toHaveBeenNthCalledWith(
      2,
      { description: 'Submit the search', handle: { selector: '#go' } },
      undefined,
    )
  })

  test('adapts a failed Replay step without changing the approved plan payload', async () => {
    const observe = mock(async () => [
      { description: 'Use the new search field', handle: { selector: '#q' } },
    ])
    const act = mock(async (action: { description: string }) => ({
      success: action.description !== 'Fill the search field',
      message:
        action.description === 'Fill the search field'
          ? 'Selector is stale'
          : undefined,
    }))
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(stubAutomation({ observe, act })),
    )
    const plan = {
      schemaVersion: 1 as const,
      scenarioId: 'search',
      scenarioRevision: 'rev',
      executionTargetProfileId: 'web',
      planFormatVersion: 'web.1',
      steps: [
        {
          resolvedActions: [
            { description: 'Navigate to https://example.test/search' },
          ],
        },
        {
          resolvedActions: [
            {
              description: 'Fill the search field',
              replay: { selector: '#search' },
            },
          ],
        },
      ],
    }
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
      mode: 'replay',
      plan,
    })

    await session.executeStep(scenario.steps[0]!)
    const action = await session.executeStep(scenario.steps[1]!)
    await session.close()

    expect(action).toMatchObject({
      state: 'passed-with-adaptation',
      resolvedActions: [
        {
          description: 'Use the new search field',
          replay: { selector: '#q' },
        },
      ],
    })
    expect(observe).toHaveBeenCalledTimes(1)
    expect(plan.steps[1]?.resolvedActions).toEqual([
      { description: 'Fill the search field', replay: { selector: '#search' } },
    ])
  })

  test('records an adaptation when Replay has no planned actions for a step', async () => {
    const observe = mock(async () => [
      { description: 'Fill the search field', handle: { selector: '#search' } },
    ])
    const act = mock(async () => ({ success: true }))
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(stubAutomation({ observe, act })),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
      mode: 'replay',
      plan: {
        schemaVersion: 1,
        scenarioId: 'search',
        scenarioRevision: 'rev',
        executionTargetProfileId: 'web',
        planFormatVersion: 'web.1',
        steps: [
          {
            resolvedActions: [
              { description: 'Navigate to https://example.test/search' },
            ],
          },
          { resolvedActions: [] },
        ],
      },
    })

    await session.executeStep(scenario.steps[0]!)
    const action = await session.executeStep(scenario.steps[1]!)
    await session.close()

    expect(action.state).toBe('passed-with-adaptation')
    expect(observe).toHaveBeenCalledTimes(1)
    expect(act).toHaveBeenCalledTimes(1)
  })

  test('pools browser processes across consecutive logical sessions', async () => {
    const launch = mock(async () => ({
      openContext: mock(async () => stubAutomation()),
      close: mock(async () => {}),
    }))
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      { launch },
    )

    const first = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })
    await first.close()
    const second = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario: { ...scenario, name: 'Second search' },
    })
    await second.close()
    await adapter.dispose?.()

    expect(launch).toHaveBeenCalledTimes(1)
  })

  test('surfaces isolation verification failure when opening a logical session', async () => {
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(
        stubAutomation({
          async readIsolationState() {
            return { cookieCount: 2, storageKeyCount: 0 }
          },
        }),
      ),
    )

    await expect(
      adapter.openSession({
        executionTargetProfile: { id: 'web' },
        specification,
        scenario,
      }),
    ).rejects.toThrow('Logical session isolation verification failed')
  })

  test('closes automation on abort before returning the browser process to the pool', async () => {
    let closeStarted = false
    let closeFinished = false
    const launch = mock(async () => ({
      openContext: mock(async () =>
        stubAutomation({
          async navigate(_url, signal) {
            await new Promise((_resolve, reject) => {
              signal?.addEventListener(
                'abort',
                () =>
                  reject(new DOMException('Scenario cancelled', 'AbortError')),
                { once: true },
              )
            })
          },
          async close() {
            closeStarted = true
            await Bun.sleep(10)
            closeFinished = true
          },
        }),
      ),
      close: mock(async () => {}),
    }))
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      { launch },
    )
    const controller = new AbortController()
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
      signal: controller.signal,
    })
    const execution = session.executeStep(scenario.steps[0]!, controller.signal)
    controller.abort()
    await expect(execution).rejects.toThrow('Scenario cancelled')
    await session.close()
    expect(closeStarted).toBe(true)
    expect(closeFinished).toBe(true)

    const reused = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario: { ...scenario, name: 'Reuse after abort' },
    })
    await reused.close()
    await adapter.dispose?.()
    expect(launch).toHaveBeenCalledTimes(1)
  })
})
