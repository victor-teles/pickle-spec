import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { localBrowser, Stagehand } from '@browserbasehq/stagehand'
import type { Scenario, Specification } from '@pickle-spec/spec'
import { z } from 'zod'
import { createWebAdapter } from '../index'
import { stagehandFactory } from './stagehand-factory'

type LaunchedBrowser = Awaited<ReturnType<typeof localBrowser.launch>>

describe('stagehandFactory', () => {
  afterEach(() => mock.restore())

  test('attaches Stagehand before opening an Adaptive browser context', async () => {
    let attached = false
    const context = {
      activePage: mock(async () => null),
      cookies: mock(async () => []),
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
      await session.executeStep(scenario.steps[0]!, undefined, {
        stepIndex: 0,
        templateStep: scenario.steps[0]!,
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
})
