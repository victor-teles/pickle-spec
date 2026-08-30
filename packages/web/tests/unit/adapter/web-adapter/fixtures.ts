import type { Scenario, Specification } from '@pickle-spec/spec'
import { vi } from 'vitest'
import type {
  WebAutomation,
  WebAutomationFactory,
} from '../../../../src/adapter/automation/web-automation'

export function stubAutomation(
  overrides: Partial<WebAutomation> = {},
): WebAutomation {
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

export function factoryFor(automation: WebAutomation): WebAutomationFactory {
  return {
    launch: vi.fn(async () => ({
      openContext: vi.fn(async () => automation),
      close: vi.fn(async () => {}),
    })),
  }
}

export const scenario: Scenario = {
  name: 'Search for pickles',
  tags: ['@web'],
  steps: [
    { keyword: 'Given', text: 'I navigate to /search', type: 'context' },
    { keyword: 'When', text: 'I search for pickles', type: 'action' },
    { keyword: 'Then', text: 'pickle results are visible', type: 'outcome' },
  ],
}

export const specification: Specification = {
  name: 'Search',
  source: { uri: 'features/search.feature', language: 'en' },
  tags: ['@web'],
  scenarios: [scenario],
}

export const clearedGoogleApiKeys = {
  GOOGLE_API_KEY: undefined,
  GOOGLE_GENERATIVE_AI_API_KEY: undefined,
  GEMINI_API_KEY: undefined,
}

export async function withEnv(
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
