import { localBrowser } from '@browserbasehq/stagehand'
import type { EnvironmentDiagnostic } from '@pickle-spec/runner'
import type { WebAdapterOptions } from './web-options'
import { resolveBrowserConnection } from './web-options'

interface LocalBrowserProcess {
  close(): Promise<void>
}

export interface WebEnvironmentRuntime {
  launchLocalBrowser(options: {
    headless: boolean
  }): Promise<LocalBrowserProcess>
}

const defaultRuntime: WebEnvironmentRuntime = {
  launchLocalBrowser: (options) => localBrowser.launch(options),
}

export function webEnvironmentProbeKey(options: WebAdapterOptions): string {
  const connection = resolveBrowserConnection(options.browser)
  if (connection.kind === 'local') {
    return `local:${options.browser?.headless ?? true}`
  }
  return connection.kind
}

function blockedLocalBrowser(reason: unknown): EnvironmentDiagnostic {
  const detail = reason instanceof Error ? reason.message : String(reason)
  return {
    id: 'web.local-browser',
    kind: 'blocked',
    message: `Local Chrome or Chromium could not launch: ${detail}`,
    remediation: [
      {
        summary:
          'Install a Stagehand-compatible Chrome or Chromium browser, or configure Browserbase or CDP, then run pickle doctor again.',
      },
    ],
  }
}

async function diagnoseLocalBrowser(
  options: WebAdapterOptions,
  runtime: WebEnvironmentRuntime,
): Promise<EnvironmentDiagnostic> {
  let browser: LocalBrowserProcess | undefined
  try {
    browser = await runtime.launchLocalBrowser({
      headless: options.browser?.headless ?? true,
    })
    await browser.close()
    return {
      id: 'web.local-browser',
      kind: 'ready',
      message: 'Local Chrome or Chromium launched and closed successfully',
    }
  } catch (reason) {
    if (browser) await browser.close().catch(() => {})
    return blockedLocalBrowser(reason)
  }
}

export async function diagnoseWebEnvironment(
  options: WebAdapterOptions,
  runtime: WebEnvironmentRuntime = defaultRuntime,
): Promise<EnvironmentDiagnostic> {
  const connection = resolveBrowserConnection(options.browser)
  if (connection.kind === 'local') {
    return diagnoseLocalBrowser(options, runtime)
  }
  if (connection.kind === 'browserbase') {
    return {
      id: 'web.browserbase',
      kind: 'ready',
      message:
        'Browserbase configuration is valid; connectivity was not tested',
    }
  }
  return {
    id: 'web.cdp',
    kind: 'ready',
    message: 'CDP configuration is valid; connectivity was not tested',
  }
}
