import {
  browserbase,
  localBrowser,
  Stagehand,
  type BrowserContext,
  type Page,
} from '@browserbasehq/stagehand'
import type { Scenario, Specification } from '@pickle-spec/spec'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { mock } from 'vitest-mock-extended'
import { z } from 'zod'
import { createWebAdapter } from '../../../../index'
import { stagehandFactory } from '../../../../src/adapter/automation/stagehand-factory'
import { requiredValue } from '../../../../src/required-value'

type LaunchedBrowser = Awaited<ReturnType<typeof localBrowser.launch>>

describe('stagehandFactory', () => {
  afterEach(() => vi.restoreAllMocks())

  test('attaches Stagehand before opening an Adaptive browser context', async () => {
    let attached = false
    const context = mock<BrowserContext>({
      activePage: vi.fn(async (): Promise<Page | undefined> => undefined),
      cookies: vi.fn(async () => []),
      pages: vi.fn(async () => []),
      addInitScript: vi.fn(async () => {}),
    })
    const browser = mock<LaunchedBrowser>({ close: vi.fn(async () => {}) })
    Object.defineProperty(browser, 'context', {
      get() {
        if (!attached) {
          throw new Error(
            'Browser context is unavailable. Attach the browser with await Stagehand.create({ browser }).',
          )
        }
        return context
      },
    })
    const stagehand = mock<Stagehand>({
      browser: mock<LaunchedBrowser>({ context }),
      close: vi.fn(async () => {}),
    })
    stagehand.observe.mockResolvedValue(
      mock<Awaited<ReturnType<Stagehand['observe']>>>({ data: [] }),
    )
    vi.spyOn(localBrowser, 'launch').mockResolvedValue(browser)
    vi.spyOn(Stagehand, 'create').mockImplementation(async (input) => {
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

  test('closes the browser when Stagehand shutdown depends on it', async () => {
    const browserClosed = Promise.withResolvers<void>()
    const context = mock<BrowserContext>({
      activePage: vi.fn(async (): Promise<Page | undefined> => undefined),
      cookies: vi.fn(async () => []),
      pages: vi.fn(async () => []),
      addInitScript: vi.fn(async () => {}),
    })
    const browser = mock<LaunchedBrowser>({
      context,
      close: vi.fn(async () => browserClosed.resolve()),
    })
    const stagehand = mock<Stagehand>({
      browser: mock<LaunchedBrowser>({ context }),
      close: vi.fn(async () => browserClosed.promise),
    })
    vi.spyOn(localBrowser, 'launch').mockResolvedValue(browser)
    vi.spyOn(Stagehand, 'create').mockResolvedValue(stagehand)
    const browserOptions = {
      modelName: 'google/gemini-3.6-flash',
      modelApiKey: 'test-google-key',
    }
    const browserProcess = await stagehandFactory.launch({
      browser: browserOptions,
    })
    await browserProcess.openContext({ browser: browserOptions })

    const closing = browserProcess.close()
    const outcome = await Promise.race([
      closing.then(() => 'closed'),
      Bun.sleep(250).then(() => 'still-pending'),
    ])
    browserClosed.resolve()
    await closing

    expect(outcome).toBe('closed')
    expect(stagehand.close.mock.calls).toHaveLength(1)
    expect(browser.close.mock.calls).toHaveLength(1)
  })

  test('attaches Stagehand for public cache Replay without a model', async () => {
    const goto = vi.fn(async () => null)
    const page = mock<Page>({ goto })
    page.evaluate.mockResolvedValue(0)
    let attached = false
    const context = mock<BrowserContext>({
      activePage: vi.fn(async () => page),
      cookies: vi.fn(async () => []),
      pages: vi.fn(async () => [page]),
      addInitScript: vi.fn(async () => {}),
    })
    const browser = mock<LaunchedBrowser>({ close: vi.fn(async () => {}) })
    Object.defineProperty(browser, 'context', {
      get() {
        if (!attached) {
          throw new Error(
            'Browser context is unavailable. Attach the browser with await Stagehand.create({ browser }).',
          )
        }
        return context
      },
    })
    const stagehand = mock<Stagehand>({
      browser,
      close: vi.fn(async () => {}),
    })
    vi.spyOn(localBrowser, 'launch').mockResolvedValue(browser)
    const create = vi
      .spyOn(Stagehand, 'create')
      .mockImplementation(async () => {
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
    const page = mock<Page>({ goto: vi.fn(async () => null) })
    page.evaluate.mockResolvedValue(0)
    const context = mock<BrowserContext>({
      activePage: vi.fn(async () => page),
      cookies: vi.fn(async () => []),
      pages: vi.fn(async () => [page]),
      addInitScript: vi.fn(async () => {}),
    })
    const browser = mock<LaunchedBrowser>({
      context,
      close: vi.fn(async () => {}),
    })
    const stagehand = mock<Stagehand>({
      browser,
      close: vi.fn(async () => {}),
    })
    const connect = vi.spyOn(localBrowser, 'connect').mockResolvedValue(browser)
    const create = vi.spyOn(Stagehand, 'create').mockResolvedValue(stagehand)
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
    vi.spyOn(localBrowser, 'connect').mockRejectedValue(
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
    const browser = mock<LaunchedBrowser>({
      close: vi.fn(async () => {}),
    })
    const launch = vi.spyOn(browserbase, 'launch').mockResolvedValue(browser)
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
    const browser = mock<LaunchedBrowser>({
      close: vi.fn(async () => {}),
    })
    const stagehand = mock<Stagehand>({
      close: vi.fn(async () => {}),
    })
    const creation = Promise.withResolvers<Stagehand>()
    vi.spyOn(localBrowser, 'launch').mockResolvedValue(browser)
    vi.spyOn(Stagehand, 'create').mockImplementation(() => creation.promise)
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
    expect(stagehand.close.mock.calls).toHaveLength(1)
    expect(browser.close.mock.calls).toHaveLength(1)
  })
})
