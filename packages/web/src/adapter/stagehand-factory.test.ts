import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { browserbase, localBrowser, Stagehand } from '@browserbasehq/stagehand'
import type { Scenario, Specification } from '@pickle-spec/spec'
import { z } from 'zod'
import { createWebAdapter } from '../../index'
import { requiredValue } from '../required-value'
import { stagehandFactory } from './stagehand-factory'

type LaunchedBrowser = Awaited<ReturnType<typeof localBrowser.launch>>

describe('stagehandFactory', () => {
  afterEach(() => mock.restore())

  test('attaches Stagehand before opening an Adaptive browser context', async () => {
    let attached = false
    const context = {
      activePage: mock(async () => null),
      cookies: mock(async () => []),
      pages: mock(async () => []),
      addInitScript: mock(async () => {}),
    }
    const browser = {
      get context() {
        if (!attached) {
          throw new Error(
            'Browser context is unavailable. Attach the browser with await Stagehand.create({ browser }).',
          )
        }
        return context
      },
      close: mock(async () => {}),
    } as unknown as LaunchedBrowser
    const stagehand = {
      browser: {
        context: {
          activePage: mock(async () => null),
        },
      },
      close: mock(async () => {}),
      observe: mock(async () => ({ data: [] })),
    } as unknown as Stagehand
    spyOn(localBrowser, 'launch').mockResolvedValue(browser)
    spyOn(Stagehand, 'create').mockImplementation(async (input) => {
      attached = true
      const { browser: _browser, ...initialization } = input
      z.json().parse(initialization)
      return stagehand
    })
    const browserOptions = {
      environment: 'local' as const,
      modelName: 'google/gemini-3.6-flash',
      modelApiKey: 'test-google-key',
    }
    const browserProcess = await stagehandFactory.launch({
      browser: browserOptions,
    })

    try {
      const automation = await browserProcess.openContext({
        browser: browserOptions,
      })
      await automation.observe('find the submit button')
    } finally {
      await browserProcess.close()
    }
  })

  test('attaches Stagehand for public cache Replay without a model', async () => {
    const goto = mock(async () => null)
    const page = {
      goto,
      evaluate: mock(async () => 0),
    }
    let attached = false
    const context = {
      activePage: mock(async () => page),
      cookies: mock(async () => []),
      pages: mock(async () => [page]),
      addInitScript: mock(async () => {}),
    }
    const browser = {
      get context() {
        if (!attached) {
          throw new Error(
            'Browser context is unavailable. Attach the browser with await Stagehand.create({ browser }).',
          )
        }
        return context
      },
      close: mock(async () => {}),
    } as unknown as LaunchedBrowser
    const stagehand = {
      browser,
      close: mock(async () => {}),
    } as unknown as Stagehand
    spyOn(localBrowser, 'launch').mockResolvedValue(browser)
    const create = spyOn(Stagehand, 'create').mockImplementation(async () => {
      attached = true
      return stagehand
    })
    const scenario: Scenario = {
      name: 'Open account',
      tags: ['@web'],
      steps: [
        { keyword: 'Given', text: 'I navigate to /account', type: 'context' },
      ],
    }
    const specification: Specification = {
      name: 'Account',
      source: { uri: 'features/account.feature', language: 'en' },
      tags: ['@web'],
      scenarios: [scenario],
    }
    const adapter = createWebAdapter({ baseUrl: 'https://example.test' })

    try {
      const session = await adapter.openSession({
        executionTargetProfile: { id: 'web' },
        specification,
        scenario,
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
      await session.executeStep(requiredValue(scenario.steps[0]), undefined, {
        stepIndex: 0,
        templateStep: requiredValue(scenario.steps[0]),
        runtimeBindings: [],
      })
      await session.close()
    } finally {
      await adapter.dispose?.()
    }

    expect(goto).toHaveBeenCalledTimes(1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('model')
  })

  test('connects to CDP with the configured extension and keeps Replay model-free', async () => {
    const page = {
      goto: mock(async () => null),
      evaluate: mock(async () => 0),
    }
    const context = {
      activePage: mock(async () => page),
      cookies: mock(async () => []),
      pages: mock(async () => [page]),
      addInitScript: mock(async () => {}),
    }
    const browser = {
      context,
      close: mock(async () => {}),
    } as unknown as LaunchedBrowser
    const stagehand = {
      browser,
      close: mock(async () => {}),
    } as unknown as Stagehand
    const connect = spyOn(localBrowser, 'connect').mockResolvedValue(browser)
    const create = spyOn(Stagehand, 'create').mockResolvedValue(stagehand)
    const browserOptions = {
      cdpUrl: 'wss://browser.example.test/session?token=secret',
      cdpExtensionId: 'stagehand-extension',
    }
    const browserProcess = await stagehandFactory.launch({
      browser: browserOptions,
    })

    try {
      await browserProcess.openContext({
        browser: browserOptions,
        mode: 'replay',
      })
    } finally {
      await browserProcess.close()
    }

    expect(connect).toHaveBeenCalledWith({
      cdpUrl: browserOptions.cdpUrl,
      extensionId: browserOptions.cdpExtensionId,
    })
    expect(create.mock.calls[0]?.[0]).not.toHaveProperty('model')
  })

  test('redacts CDP connection failures', async () => {
    const cdpUrl = 'wss://browser.example.test/session?token=secret'
    spyOn(localBrowser, 'connect').mockRejectedValue(
      new Error(`Failed to connect to ${cdpUrl}`),
    )

    try {
      await stagehandFactory.launch({ browser: { cdpUrl } })
      throw new Error('Expected the CDP connection to fail')
    } catch (error) {
      expect(String(error)).toContain('web.browser.cdpUrl')
      expect(String(error)).not.toContain(cdpUrl)
    }
  })

  test('keeps the Browserbase launch branch unchanged', async () => {
    const browser = {
      close: mock(async () => {}),
    } as unknown as LaunchedBrowser
    const launch = spyOn(browserbase, 'launch').mockResolvedValue(browser)
    const browserProcess = await stagehandFactory.launch({
      browser: {
        environment: 'browserbase',
        browserbaseApiKey: 'browserbase-key',
        browserbaseProjectId: 'browserbase-project',
      },
    })

    await browserProcess.close()

    expect(launch).toHaveBeenCalledWith({
      apiKey: 'browserbase-key',
      projectId: 'browserbase-project',
    })
  })

  test('closes Stagehand when attachment finishes after cancellation', async () => {
    const browser = {
      close: mock(async () => {}),
    } as unknown as LaunchedBrowser
    const stagehand = {
      close: mock(async () => {}),
    } as unknown as Stagehand
    const creation = Promise.withResolvers<Stagehand>()
    spyOn(localBrowser, 'launch').mockResolvedValue(browser)
    spyOn(Stagehand, 'create').mockImplementation(() => creation.promise)
    const controller = new AbortController()
    const browserOptions = {
      modelName: 'google/gemini-3.6-flash',
      modelApiKey: 'test-google-key',
    }
    const browserProcess = await stagehandFactory.launch({
      browser: browserOptions,
      signal: controller.signal,
    })
    const opening = browserProcess.openContext({
      browser: browserOptions,
      signal: controller.signal,
    })

    await Bun.sleep(0)
    controller.abort()
    await browserProcess.close()
    creation.resolve(stagehand)

    await expect(opening).rejects.toMatchObject({ name: 'AbortError' })
    expect(stagehand.close).toHaveBeenCalledTimes(1)
    expect(browser.close).toHaveBeenCalledTimes(1)
  })
})
