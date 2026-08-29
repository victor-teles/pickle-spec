import { expect, test, vi } from 'vitest'
import {
  diagnoseWebEnvironment,
  type WebEnvironmentRuntime,
  webEnvironmentProbeKey,
} from '../../index'

function runtime(
  launchLocalBrowser: WebEnvironmentRuntime['launchLocalBrowser'],
): WebEnvironmentRuntime {
  return { launchLocalBrowser }
}

test('launches and closes the configured local browser', async () => {
  const close = vi.fn(async () => {})
  const launch = vi.fn(async () => ({ close }))

  await expect(
    diagnoseWebEnvironment(
      { baseUrl: 'https://example.test', browser: { headless: false } },
      runtime(launch),
    ),
  ).resolves.toEqual({
    id: 'web.local-browser',
    kind: 'ready',
    message: 'Local Chrome or Chromium launched and closed successfully',
  })
  expect(launch).toHaveBeenCalledWith({ headless: false })
  expect(close).toHaveBeenCalledTimes(1)
})

test('returns actionable remediation when the local browser cannot launch', async () => {
  const diagnostic = await diagnoseWebEnvironment(
    { baseUrl: 'https://example.test' },
    runtime(async () => {
      throw new Error('browser executable is missing')
    }),
  )

  expect(diagnostic).toMatchObject({
    id: 'web.local-browser',
    kind: 'blocked',
    message:
      'Local Chrome or Chromium could not launch: browser executable is missing',
  })
  expect(
    diagnostic.kind === 'blocked' && diagnostic.remediation[0].summary,
  ).toContain('Install a Stagehand-compatible Chrome or Chromium browser')
})

test('does not contact Browserbase or CDP endpoints', async () => {
  const launch = vi.fn(async () => ({ close: async () => {} }))
  const controlledRuntime = runtime(launch)
  const browserbase = await diagnoseWebEnvironment(
    {
      baseUrl: 'https://example.test',
      browser: {
        environment: 'browserbase',
        browserbaseApiKey: 'secret-browserbase-key',
      },
    },
    controlledRuntime,
  )
  const cdp = await diagnoseWebEnvironment(
    {
      baseUrl: 'https://example.test',
      browser: { cdpUrl: 'wss://secret.example/session?token=secret' },
    },
    controlledRuntime,
  )

  expect(launch).not.toHaveBeenCalled()
  expect(browserbase).toMatchObject({ id: 'web.browserbase', kind: 'ready' })
  expect(cdp).toMatchObject({ id: 'web.cdp', kind: 'ready' })
  expect(JSON.stringify([browserbase, cdp])).not.toContain('secret')
  expect(
    webEnvironmentProbeKey({
      baseUrl: 'https://example.test',
      browser: {
        environment: 'browserbase',
        browserbaseApiKey: 'secret-browserbase-key',
      },
    }),
  ).toBe('browserbase')
  expect(
    webEnvironmentProbeKey({
      baseUrl: 'https://example.test',
      browser: { cdpUrl: 'wss://secret.example/session?token=secret' },
    }),
  ).toBe('cdp')
})
