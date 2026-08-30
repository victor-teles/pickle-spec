import type { OpenSessionInput } from '@pickle-spec/runner'
import { requiredValue } from '../../required-value'
import {
  type BrowserOptions,
  defaultModelName,
  resolveBrowserConnection,
  type WebAdapterOptions,
} from '../configuration/web-options'

const providerApiKeyEnvNames: Record<string, string[]> = {
  openai: ['OPENAI_API_KEY'],
  anthropic: ['ANTHROPIC_API_KEY'],
  google: ['GOOGLE_GENERATIVE_AI_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'],
  groq: ['GROQ_API_KEY'],
  cerebras: ['CEREBRAS_API_KEY'],
}

function apiKeyEnvNames(modelName: string | undefined): string[] {
  const provider = requiredValue((modelName ?? defaultModelName).split('/')[0])
  return providerApiKeyEnvNames[provider] ?? []
}

function modelApiKey(browser: BrowserOptions | undefined): string | undefined {
  const configured = browser?.modelApiKey?.trim()
  if (configured) return configured
  for (const name of apiKeyEnvNames(browser?.modelName)) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
}

interface ResolveBrowserOptionsInput {
  browser: BrowserOptions | undefined
  requireProviderApiKey: boolean
  requiresInference: boolean
}

function resolveBrowserOptions({
  browser,
  requireProviderApiKey,
  requiresInference,
}: ResolveBrowserOptionsInput): BrowserOptions {
  const resolvedBrowser: BrowserOptions = {
    ...browser,
    modelApiKey: requiresInference ? modelApiKey(browser) : undefined,
  }
  if (
    requireProviderApiKey &&
    requiresInference &&
    resolveBrowserConnection(resolvedBrowser).kind !== 'browserbase' &&
    !resolvedBrowser.modelApiKey
  ) {
    throw new Error(
      'Model inference requires a provider API key or a Browserbase session. ' +
        `Set ${apiKeyEnvNames(resolvedBrowser.modelName).join(', ')}, or web.browser.modelApiKey.`,
    )
  }
  return resolvedBrowser
}

export function browserOptionsForSession(
  input: OpenSessionInput,
  options: WebAdapterOptions,
  requireProviderApiKey: boolean,
): BrowserOptions {
  const executionMode = input.mode ?? 'adaptive'
  const cacheReplay =
    executionMode === 'replay' && input.executionCache !== undefined
  return resolveBrowserOptions({
    browser: {
      ...options.browser,
      selfHeal:
        executionMode === 'replay'
          ? false
          : (options.browser?.selfHeal ?? true),
    },
    requireProviderApiKey,
    requiresInference: !cacheReplay,
  })
}
