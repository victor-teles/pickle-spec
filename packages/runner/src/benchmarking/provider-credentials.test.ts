import { expect, test } from 'bun:test'
import type { ProviderCredentialEnvironment } from '../../benchmarking'
import {
  assertNoProviderCredentials,
  providerCredentialEnvironmentNames,
  removeProviderCredentials,
} from '../../benchmarking'

const requiredProviderCredentialEnvironmentNames = [
  'ANTHROPIC_API_KEY',
  'AWS_SECRET_ACCESS_KEY',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'VERCEL_AI_GATEWAY_API_KEY',
] as const

const knownNonKeyCredentialEnvironmentNames = [
  'AWS_ACCESS_KEY_ID',
  'AWS_SESSION_TOKEN',
  'GOOGLE_APPLICATION_CREDENTIALS',
] as const

test('keeps canonical provider credential names unique and well formed', () => {
  expect(new Set(providerCredentialEnvironmentNames).size).toBe(
    providerCredentialEnvironmentNames.length,
  )
  expect(
    providerCredentialEnvironmentNames.filter((name) => !name.endsWith('_KEY')),
  ).toEqual([...knownNonKeyCredentialEnvironmentNames])
  for (const name of requiredProviderCredentialEnvironmentNames) {
    expect(providerCredentialEnvironmentNames).toContain(name)
  }
})

test('rejects every canonical provider credential name', () => {
  for (const name of providerCredentialEnvironmentNames) {
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
  const environment: ProviderCredentialEnvironment = Object.fromEntries(
    providerCredentialEnvironmentNames.map((name) => [name, 'must-be-removed']),
  )
  environment.PICKLE_CACHE_ROOT = '/safe/cache'

  removeProviderCredentials(environment)

  expect(environment).toEqual({ PICKLE_CACHE_ROOT: '/safe/cache' })
  expect(() =>
    assertNoProviderCredentials(environment, 'Controlled benchmark'),
  ).not.toThrow()
})
