import { afterAll, describe, expect, mock, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { runScenario } from '@pickle-spec/runner'
import type { Scenario, Specification } from '@pickle-spec/spec'
import {
  createWebAdapter,
  validateWebAdapterOptions,
  type WebAutomation,
  type WebAutomationFactory,
} from '../../index'
import { requiredValue } from '../required-value'

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

    const navigation = await session.executeStep(
      requiredValue(scenario.steps[0]),
    )
    const action = await session.executeStep(requiredValue(scenario.steps[1]))
    const outcome = await session.executeStep(requiredValue(scenario.steps[2]))
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
    expect(
      await Bun.file(
        requiredValue(requiredValue(navigation.artifacts)[0]).path,
      ).exists(),
    ).toBe(true)
    expect(observe).toHaveBeenCalledTimes(1)
    expect(act).toHaveBeenCalledTimes(1)
    expect(verify).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  test('attaches screenshots to each step and the recording to the failing step', async () => {
    const artifactDirectory = await mkdtemp(
      join(tmpdir(), 'pickle-web-recording-'),
    )
    artifactDirectories.push(artifactDirectory)
    let recordingPath = ''
    const adapter = createWebAdapter(
      {
        baseUrl: 'https://example.test',
        screenshots: { mode: 'on-step', outputDir: artifactDirectory },
      },
      factoryFor(
        stubAutomation({
          async observe() {
            return [
              {
                description: 'Fill the search field',
                handle: { selector: '#search' },
              },
            ]
          },
          async verify() {
            return {
              meetsExpectation: false,
              actualState: 'No results were shown',
            }
          },
          async screenshot() {
            return new Uint8Array([137, 80, 78, 71])
          },
          async startRecording(path) {
            recordingPath = path
            await Bun.write(path, 'video-bytes')
          },
          async stopRecording() {
            return {
              kind: 'recording',
              path: recordingPath,
              mediaType: 'video/mp4',
              name: 'scenario.mp4',
            }
          },
        }),
      ),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })
    const navigation = await session.executeStep(
      requiredValue(scenario.steps[0]),
    )
    const action = await session.executeStep(requiredValue(scenario.steps[1]))
    const outcome = await session.executeStep(requiredValue(scenario.steps[2]))
    await session.close()

    expect(navigation.artifacts?.map((artifact) => artifact.kind)).toEqual([
      'screenshot',
    ])
    expect(action.artifacts?.map((artifact) => artifact.kind)).toEqual([
      'screenshot',
    ])
    expect(outcome.artifacts?.map((artifact) => artifact.kind)).toEqual([
      'screenshot',
      'recording',
    ])
    expect(outcome.evidenceAvailability).toContainEqual({
      kind: 'recording',
      state: 'available',
    })
    expect(recordingPath).toContain(artifactDirectory)
    expect(await Bun.file(recordingPath).exists()).toBe(true)
  })

  test('attaches the recording to the last passed step', async () => {
    const artifactDirectory = await mkdtemp(
      join(tmpdir(), 'pickle-web-recording-pass-'),
    )
    artifactDirectories.push(artifactDirectory)
    let recordingPath = ''
    const adapter = createWebAdapter(
      {
        baseUrl: 'https://example.test',
        screenshots: { mode: 'on-step', outputDir: artifactDirectory },
      },
      factoryFor(
        stubAutomation({
          async observe() {
            return [
              {
                description: 'Fill the search field',
                handle: { selector: '#search' },
              },
            ]
          },
          async screenshot() {
            return new Uint8Array([137, 80, 78, 71])
          },
          async startRecording(path) {
            recordingPath = path
            await Bun.write(path, 'video-bytes')
          },
          async stopRecording() {
            return {
              kind: 'recording',
              path: recordingPath,
              mediaType: 'video/mp4',
              name: 'scenario.mp4',
            }
          },
        }),
      ),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })
    const navigation = await session.executeStep(
      requiredValue(scenario.steps[0]),
    )
    const action = await session.executeStep(requiredValue(scenario.steps[1]))
    const outcome = await session.executeStep(requiredValue(scenario.steps[2]))
    await session.close()

    expect(navigation.artifacts?.map((artifact) => artifact.kind)).toEqual([
      'screenshot',
    ])
    expect(action.artifacts?.map((artifact) => artifact.kind)).toEqual([
      'screenshot',
    ])
    expect(outcome.state).toBe('passed')
    expect(outcome.artifacts?.map((artifact) => artifact.kind)).toEqual([
      'screenshot',
      'recording',
    ])
  })

  test('reports a requested screenshot that could not be captured', async () => {
    const adapter = createWebAdapter(
      {
        baseUrl: 'https://example.test',
        screenshots: { mode: 'on-step' },
      },
      factoryFor(
        stubAutomation({
          async screenshot() {
            throw new Error('browser page closed')
          },
        }),
      ),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })

    const result = await session.executeStep(requiredValue(scenario.steps[0]))
    await session.close()

    expect(result.artifacts).toBeUndefined()
    expect(result.evidenceAvailability).toContainEqual({
      kind: 'screenshot',
      state: 'capture-failed',
      message: 'Screenshot capture failed',
    })
  })

  test('emits a Pickle-native trace and Diagnostic entries from browser activity', async () => {
    let consumeCalls = 0
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(
        stubAutomation({
          async observe() {
            return [
              {
                description: 'Click pay on chrome',
                handle: { selector: '#pay' },
              },
            ]
          },
          async act() {
            return { success: true }
          },
          async verify() {
            return {
              meetsExpectation: false,
              actualState: 'Payment was declined',
            }
          },
          consumeEvidence() {
            consumeCalls += 1
            if (consumeCalls < 3) {
              return { diagnostics: [], activity: [] }
            }
            return {
              diagnostics: [
                {
                  occurredAt: '2026-08-23T12:00:00.004Z',
                  level: 'error',
                  origin: 'console',
                  message: 'Payment was declined',
                },
                {
                  occurredAt: '2026-08-23T12:00:00.004Z',
                  level: 'error',
                  origin: 'network',
                  message: 'POST https://example.test/pay failed: 402',
                },
              ],
              activity: [
                {
                  occurredAt: '2026-08-23T12:00:00.003Z',
                  description: 'Navigate https://example.test/checkout',
                },
              ],
            }
          },
        }),
      ),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })

    await session.executeStep(requiredValue(scenario.steps[0]))
    await session.executeStep(requiredValue(scenario.steps[1]))
    const outcome = await session.executeStep(requiredValue(scenario.steps[2]))
    await session.close()

    expect(outcome.state).toBe('failed')
    expect(outcome.trace).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'resolved-action',
          description: 'Click pay on chrome',
        }),
        expect.objectContaining({
          kind: 'browser-activity',
          description: 'Navigate https://example.test/checkout',
        }),
      ]),
    )
    expect(outcome.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          origin: 'console',
          message: 'Payment was declined',
        }),
        expect.objectContaining({
          origin: 'network',
          message: 'POST https://example.test/pay failed: 402',
        }),
        expect.objectContaining({
          origin: 'adapter',
          message:
            'Expected: "pickle results are visible" | Actual: Payment was declined',
        }),
      ]),
    )
    expect(outcome.evidenceAvailability).toEqual(
      expect.arrayContaining([
        { kind: 'diagnostics', state: 'available' },
        { kind: 'trace', state: 'available' },
      ]),
    )
  })

  test('isolates screenshot paths for concurrent Scenario Outline rows', async () => {
    const artifactDirectory = await mkdtemp(
      join(tmpdir(), 'pickle-web-outline-artifacts-'),
    )
    artifactDirectories.push(artifactDirectory)
    let screenshotIndex = 0
    const adapter = createWebAdapter(
      {
        baseUrl: 'https://example.test',
        screenshots: { mode: 'on-step', outputDir: artifactDirectory },
      },
      factoryFor(
        stubAutomation({
          async screenshot() {
            const currentScreenshot = ++screenshotIndex
            await Bun.sleep(5)
            return new TextEncoder().encode(`row-${currentScreenshot}`)
          },
        }),
      ),
    )
    const outlineRow = (examplesRowId: string): Scenario => ({
      ...scenario,
      id: 'shared-outline-scenario',
      examplesId: 'search-examples',
      examplesRowId,
    })
    const first = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario: outlineRow('row-one'),
    })
    const second = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario: outlineRow('row-two'),
    })

    const [firstResult, secondResult] = await Promise.all([
      first.executeStep(requiredValue(scenario.steps[0])),
      second.executeStep(requiredValue(scenario.steps[0])),
    ])
    await Promise.all([first.close(), second.close()])
    await adapter.dispose?.()

    const firstPath = firstResult.artifacts?.[0]?.path
    const secondPath = secondResult.artifacts?.[0]?.path
    expect(firstPath).toBeDefined()
    expect(secondPath).toBeDefined()
    expect(firstPath).not.toBe(secondPath)
    expect(firstPath).toMatch(/examples-row-[a-f0-9]{16}/)
    expect(secondPath).toMatch(/examples-row-[a-f0-9]{16}/)
    expect(await Bun.file(requiredValue(firstPath)).text()).not.toBe(
      await Bun.file(requiredValue(secondPath)).text(),
    )
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

  test('does not navigate when opening a logical session', async () => {
    const navigate = mock(async () => {})
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(stubAutomation({ navigate })),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })
    await session.close()

    expect(navigate).not.toHaveBeenCalled()
  })

  test('navigates to baseUrl only before the first action that requires a page', async () => {
    const navigate = mock(async () => {})
    const observe = mock(async () => [
      { description: 'Fill the search field', handle: { selector: '#search' } },
    ])
    const act = mock(async () => ({ success: true }))
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(stubAutomation({ navigate, observe, act })),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification: {
        ...specification,
        scenarios: [
          {
            name: 'Search without navigation',
            tags: [],
            steps: [
              { keyword: 'When', text: 'I search for pickles', type: 'action' },
            ],
          },
        ],
      },
      scenario: {
        name: 'Search without navigation',
        tags: [],
        steps: [
          { keyword: 'When', text: 'I search for pickles', type: 'action' },
        ],
      },
    })

    await session.executeStep({
      keyword: 'When',
      text: 'I search for pickles',
      type: 'action',
    })
    await session.close()

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('https://example.test', undefined)
  })

  test('navigates to baseUrl before the first outcome when no explicit navigation exists', async () => {
    const navigate = mock(async () => {})
    const verify = mock(async () => ({
      meetsExpectation: true,
      actualState: 'Ready',
    }))
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(stubAutomation({ navigate, verify })),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario: {
        name: 'Verify only',
        tags: [],
        steps: [
          {
            keyword: 'Then',
            text: 'pickle results are visible',
            type: 'outcome',
          },
        ],
      },
    })

    await session.executeStep({
      keyword: 'Then',
      text: 'pickle results are visible',
      type: 'outcome',
    })
    await session.close()

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith('https://example.test', undefined)
  })

  test('does not navigate to baseUrl again after explicit navigation', async () => {
    const navigate = mock(async () => {})
    const observe = mock(async () => [
      { description: 'Fill the search field', handle: { selector: '#search' } },
    ])
    const act = mock(async () => ({ success: true }))
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      factoryFor(stubAutomation({ navigate, observe, act })),
    )
    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
    })

    await session.executeStep(requiredValue(scenario.steps[0]))
    await session.executeStep(requiredValue(scenario.steps[1]))
    await session.close()

    expect(navigate).toHaveBeenCalledTimes(1)
    expect(navigate).toHaveBeenCalledWith(
      'https://example.test/search',
      undefined,
    )
  })

  test('records every enabled fast profile trade-off on the adapter', () => {
    const adapter = createWebAdapter(
      {
        baseUrl: 'https://example.test',
        profile: 'fast',
      },
      factoryFor(stubAutomation()),
    )
    expect(adapter.fidelityPolicy).toEqual({
      profile: 'fast',
      tradeOffs: [
        'block-image',
        'block-media',
        'block-font',
        'disable-animations',
      ],
    })
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

  test('accepts supported CDP URLs and preserves the extension ID', () => {
    for (const cdpUrl of [
      'http://127.0.0.1:9222',
      'https://browser.example.test/cdp',
      'ws://127.0.0.1:9222/devtools/browser/session',
      'wss://browser.example.test/devtools/browser/session',
    ]) {
      expect(
        validateWebAdapterOptions({
          baseUrl: 'https://example.test',
          browser: { cdpUrl, cdpExtensionId: 'stagehand-extension' },
        }).browser,
      ).toMatchObject({ cdpUrl, cdpExtensionId: 'stagehand-extension' })
    }
  })

  test('rejects unsupported CDP URL schemes without exposing the value', () => {
    for (const cdpUrl of [
      'file:///secret/browser-profile',
      '/relative/devtools/browser/session',
    ]) {
      expect(() =>
        validateWebAdapterOptions({
          baseUrl: 'https://example.test',
          browser: { cdpUrl },
        }),
      ).toThrow('web.browser.cdpUrl must be an absolute HTTP(S) or WS(S) URL')

      try {
        validateWebAdapterOptions({
          baseUrl: 'https://example.test',
          browser: { cdpUrl },
        })
      } catch (error) {
        expect(String(error)).not.toContain(cdpUrl)
      }

      const createInvalidAdapter = () =>
        createWebAdapter({
          baseUrl: 'https://example.test',
          browser: { cdpUrl },
        })

      expect(createInvalidAdapter).toThrow(
        'web.browser.cdpUrl must be an absolute HTTP(S) or WS(S) URL',
      )
      try {
        createInvalidAdapter()
      } catch (error) {
        expect(String(error)).toContain('web.browser.cdpUrl')
        expect(String(error)).not.toContain(cdpUrl)
      }
    }
  })

  test('rejects Browserbase with CDP and an extension ID without CDP', () => {
    expect(() =>
      validateWebAdapterOptions({
        baseUrl: 'https://example.test',
        browser: {
          environment: 'browserbase',
          cdpUrl: 'wss://browser.example.test/session',
        },
      }),
    ).toThrow('web.browser.cdpUrl cannot be used with browserbase')

    expect(() =>
      validateWebAdapterOptions({
        baseUrl: 'https://example.test',
        browser: { cdpExtensionId: 'stagehand-extension' },
      }),
    ).toThrow('web.browser.cdpExtensionId requires web.browser.cdpUrl')

    expect(() =>
      validateWebAdapterOptions({
        baseUrl: 'https://example.test',
        browser: {
          cdpUrl: 'wss://browser.example.test/session',
          cdpExtensionId: '   ',
        },
      }),
    ).toThrow('web.browser.cdpExtensionId must not be empty')
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

  test('does not grant Browserbase model credentials to a direct CDP caller', async () => {
    const adapter = createWebAdapter({
      baseUrl: 'https://example.test',
      browser: {
        environment: 'browserbase',
        cdpUrl: 'wss://browser.example.test/session',
        modelName: 'google/gemini-3.6-flash',
      },
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

  test('does not pass model credentials into a cache Replay session', async () => {
    const automation = stubAutomation({
      async executeInstruction() {
        return { success: true }
      },
    })
    const launch = mock(async () => ({
      openContext: mock(async () => automation),
      close: mock(async () => {}),
    }))
    const replayScenario: Scenario = {
      name: 'Open account',
      tags: ['@web'],
      steps: [
        { keyword: 'Given', text: 'I navigate to /account', type: 'context' },
      ],
    }
    const replaySpecification: Specification = {
      name: 'Account',
      source: { uri: 'features/account.feature', language: 'en' },
      tags: ['@web'],
      scenarios: [replayScenario],
    }
    const adapter = createWebAdapter(
      {
        baseUrl: 'https://example.test',
        browser: { modelApiKey: 'must-not-cross-replay-boundary' },
      },
      { launch },
    )

    const session = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification: replaySpecification,
      scenario: replayScenario,
      mode: 'replay',
      executionCache: {
        requiredVariables: [],
        adapterPayload: {
          schemaVersion: 1,
          steps: [
            {
              instructions: [
                {
                  kind: 'navigate',
                  url: {
                    segments: [{ literal: 'https://example.test/account' }],
                  },
                },
              ],
            },
          ],
        },
      },
    })
    await session.executeStep(
      requiredValue(replayScenario.steps[0]),
      undefined,
      {
        stepIndex: 0,
        templateStep: requiredValue(replayScenario.steps[0]),
        runtimeBindings: [],
      },
    )
    await session.close()
    await adapter.dispose?.()

    expect(launch).toHaveBeenCalledWith(
      expect.objectContaining({
        browser: expect.objectContaining({ modelApiKey: undefined }),
      }),
    )
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

  test('closes automation and retires the browser process on abort', async () => {
    let closeStarted = false
    let closeFinished = false
    const browserClosed = Promise.withResolvers<void>()
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
            await browserClosed.promise
            closeFinished = true
          },
        }),
      ),
      close: mock(async () => browserClosed.resolve()),
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
    const execution = session.executeStep(
      requiredValue(scenario.steps[0]),
      controller.signal,
    )
    controller.abort()
    await expect(execution).rejects.toThrow('Scenario cancelled')
    const closeOutcome = await Promise.race([
      session.close().then(() => 'closed'),
      Bun.sleep(250).then(() => 'still-pending'),
    ])
    browserClosed.resolve()
    await session.close()
    expect(closeStarted).toBe(true)
    expect(closeFinished).toBe(true)
    expect(closeOutcome).toBe('closed')

    const reused = await adapter.openSession({
      executionTargetProfile: { id: 'web' },
      specification,
      scenario: { ...scenario, name: 'Reuse after abort' },
    })
    await reused.close()
    await adapter.dispose?.()
    expect(launch).toHaveBeenCalledTimes(2)
  })

  test('finishes a cancelled runner scenario when browser shutdown unblocks automation cleanup', async () => {
    const stepStarted = Promise.withResolvers<void>()
    const browserClosed = Promise.withResolvers<void>()
    const closeBrowser = mock(async () => browserClosed.resolve())
    const adapter = createWebAdapter(
      { baseUrl: 'https://example.test' },
      {
        launch: mock(async () => ({
          openContext: mock(async () =>
            stubAutomation({
              async navigate(_url, signal) {
                stepStarted.resolve()
                await new Promise((_resolve, reject) => {
                  signal?.addEventListener(
                    'abort',
                    () =>
                      reject(
                        new DOMException('Scenario cancelled', 'AbortError'),
                      ),
                    { once: true },
                  )
                })
              },
              async close() {
                await browserClosed.promise
              },
            }),
          ),
          close: closeBrowser,
        })),
      },
    )
    const controller = new AbortController()
    const running = runScenario({
      adapter,
      executionTargetProfile: { id: 'web' },
      specification,
      scenario,
      signal: controller.signal,
    })

    await stepStarted.promise
    controller.abort()
    const outcome = await Promise.race([
      running.then((run) => ({ status: 'finished' as const, run })),
      Bun.sleep(250).then(() => ({ status: 'still-pending' as const })),
    ])
    if (outcome.status === 'still-pending') {
      browserClosed.resolve()
      await running
      await adapter.dispose?.()
      throw new Error('Cancelled runner scenario did not finish promptly')
    }

    await adapter.dispose?.()
    expect(outcome.run.result.state).toBe('cancelled')
    expect(outcome.run.events.at(-1)?.type).toBe('scenario-finished')
    expect(closeBrowser).toHaveBeenCalledTimes(1)
  })
})
