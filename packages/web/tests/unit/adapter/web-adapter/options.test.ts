import type { Scenario, Specification } from '@pickle-spec/spec'
import { describe, expect, test, vi } from 'vitest'
import { createWebAdapter, validateWebAdapterOptions } from '../../../../index'
import { requiredValue } from '../../../../src/required-value'
import {
  clearedGoogleApiKeys,
  factoryFor,
  scenario,
  specification,
  stubAutomation,
  withEnv,
} from './fixtures'

describe('createWebAdapter options', () => {
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
    const openContext = vi.fn(async () => stubAutomation())
    const launch = vi.fn(async () => ({
      openContext,
      close: vi.fn(async () => {}),
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
    const launch = vi.fn(async () => ({
      openContext: vi.fn(async () => automation),
      close: vi.fn(async () => {}),
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
})
