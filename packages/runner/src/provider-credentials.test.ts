import { expect, test } from 'bun:test'
import type { ProviderCredentialEnvironment } from '../index'
import {
  assertNoProviderCredentials,
  providerCredentialEnvironmentNames,
  removeProviderCredentials,
} from '../index'

const expectedProviderCredentialEnvironmentNames = [
  'AI_GATEWAY_API_KEY',
  'ANTHROPIC_API_KEY',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AZURE_OPENAI_API_KEY',
  'CEREBRAS_API_KEY',
  'COHERE_API_KEY',
  'DEEPSEEK_API_KEY',
  'FIREWORKS_API_KEY',
  'GEMINI_API_KEY',
  'GOOGLE_API_KEY',
  'GOOGLE_GENERATIVE_AI_API_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'GROQ_API_KEY',
  'MISTRAL_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'PERPLEXITY_API_KEY',
  'TOGETHER_AI_API_KEY',
  'VERCEL_AI_GATEWAY_API_KEY',
  'XAI_API_KEY',
] as const

test('exposes one provider credential name list and rejects every listed name', () => {
  expect(providerCredentialEnvironmentNames).toEqual(
    expectedProviderCredentialEnvironmentNames,
  )

  for (const name of expectedProviderCredentialEnvironmentNames) {
    expect(() =>
      assertNoProviderCredentials(
        { [name]: 'must-not-reach-benchmark' },
        'Controlled benchmark',
      ),
    ).toThrow(
      `Controlled benchmark must not receive provider credentials: ${name}`,
    )
  }
})

test('removes only provider credentials from an environment', () => {
  const environment: ProviderCredentialEnvironment = {
    OPENAI_API_KEY: 'must-be-removed',
    PICKLE_CACHE_ROOT: '/safe/cache',
  }

  removeProviderCredentials(environment)

  expect(environment).toEqual({ PICKLE_CACHE_ROOT: '/safe/cache' })
  expect(() =>
    assertNoProviderCredentials(environment, 'Controlled benchmark'),
  ).not.toThrow()
})
