import { expect, mock, test } from 'bun:test'

const closeStagehand = mock(async () => {})
const closeBrowser = mock(async () => {})

await mock.module('@browserbasehq/stagehand', () => ({
  Stagehand: {
    create: mock(async () => ({
      browser: {
        context: {
          activePage: async () => {
            throw new Error('Initial page lookup failed')
          },
        },
        close: closeBrowser,
      },
      close: closeStagehand,
    })),
  },
  localBrowser: {
    launch: mock(async () => ({})),
  },
  browserbase: {
    launch: mock(async () => ({})),
  },
}))

await mock.module('./dom-optimization', () => ({
  navigateAndSimplify: mock(async () => {}),
}))

const { createStagehandAndNavigate } = await import(`./browser-lifecycle.ts?cleanup-test=${Date.now()}`)

test('closes a newly created Stagehand when initial page lookup fails', async () => {
  await expect(createStagehandAndNavigate(
    { env: 'LOCAL', modelName: 'custom-provider/model-1' },
    'http://localhost:3000',
    1000,
    false,
    {
      verbose: () => {},
      verboseLog: () => {},
    } as any,
  )).rejects.toThrow('Initial page lookup failed')

  expect(closeStagehand).toHaveBeenCalledTimes(1)
  expect(closeBrowser).toHaveBeenCalledTimes(1)
})
