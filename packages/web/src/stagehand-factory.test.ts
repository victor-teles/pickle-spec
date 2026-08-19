import { afterEach, describe, expect, mock, spyOn, test } from 'bun:test'
import { localBrowser, Stagehand } from '@browserbasehq/stagehand'
import { z } from 'zod'
import { stagehandFactory } from './stagehand-factory'

type LaunchedBrowser = Awaited<ReturnType<typeof localBrowser.launch>>

describe('stagehandFactory', () => {
  afterEach(() => mock.restore())

  test('omits unset Stagehand options from the JSON-RPC initialization payload', async () => {
    const browser = {
      close: mock(async () => {}),
    } as unknown as LaunchedBrowser
    const stagehand = {
      browser: {
        context: {
          activePage: mock(async () => null),
        },
      },
      close: mock(async () => {}),
    } as unknown as Stagehand
    spyOn(localBrowser, 'launch').mockResolvedValue(browser)
    spyOn(Stagehand, 'create').mockImplementation(async (input) => {
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
      await expect(
        browserProcess.openContext({ browser: browserOptions }),
      ).resolves.toBeDefined()
    } finally {
      await browserProcess.close()
    }
  })
})
