import { expect, test } from 'bun:test'
import {
  type ExecutionTargetAdapter,
  resolveRunConfiguration,
  validateProjectRunConfiguration,
  validateRunConfiguration,
} from '../../index'

const adapter: ExecutionTargetAdapter = {
  async openSession() {
    return {
      async executeStep() {
        return { state: 'passed', resolvedActions: [] }
      },
      async close() {},
    }
  },
}

test('combines versioned configuration and extensions into validated runner input', () => {
  const resolved = resolveRunConfiguration(
    {
      schemaVersion: 1,
      executionTargetProfile: { id: 'configured-web' },
      concurrency: 3,
      execution: {
        infrastructureRetries: 2,
        scenarioTimeoutMs: 30_000,
        stepTimeoutMs: 5_000,
      },
    },
    {
      adapter,
    },
  )

  expect(resolved).toEqual({
    adapter,
    executionTargetProfile: { id: 'configured-web' },
    targets: [
      {
        executionTargetProfile: { id: 'configured-web' },
        adapter,
      },
    ],
    concurrency: 3,
    retry: { infrastructureErrors: 2, functionalFailures: 0 },
    timeout: { scenarioMs: 30_000, stepMs: 5_000 },
  })
})

test('rejects an unsupported configuration schema before execution', () => {
  expect(() =>
    validateRunConfiguration({
      schemaVersion: 2,
      executionTargetProfile: { id: 'web' },
    }),
  ).toThrow('Unsupported configuration schemaVersion: 2')
})

test('validates run policies without requiring an execution adapter', () => {
  expect(() =>
    validateRunConfiguration({
      schemaVersion: 1,
      executionTargetProfile: { id: 'web' },
      execution: { scenarioTimeoutMs: 0 },
    }),
  ).toThrow(
    'execution.scenarioTimeoutMs must be an integer greater than or equal to 1',
  )
})

test('combines project configuration with the extension manifest before execution', () => {
  const configuration = {
    schemaVersion: 1 as const,
    executionTargetProfile: { id: 'custom' },
  }

  expect(
    validateProjectRunConfiguration(configuration, {
      adapterAvailable: true,
      fallbackAdapterAvailable: false,
    }),
  ).toEqual(configuration)
  expect(
    validateProjectRunConfiguration(configuration, {
      adapterAvailable: false,
      fallbackAdapterAvailable: true,
    }),
  ).toEqual(configuration)
  expect(() =>
    validateProjectRunConfiguration(configuration, {
      adapterAvailable: false,
      fallbackAdapterAvailable: false,
    }),
  ).toThrow(
    'Configure web.baseUrl or export an adapter from pickle.extensions.ts',
  )
})

test('resolves named execution target profiles with adapter configuration and capabilities', () => {
  const webAdapter: ExecutionTargetAdapter = {
    ...adapter,
    capabilities: ['screenshots', 'web'],
  }
  const customAdapter: ExecutionTargetAdapter = {
    ...adapter,
    capabilities: ['filesystem'],
  }

  const resolved = resolveRunConfiguration(
    {
      schemaVersion: 1,
      executionTargetProfiles: [
        { id: 'web', adapter: 'web', capabilities: ['screenshots'] },
        { id: 'desktop', adapter: 'custom', capabilities: ['filesystem'] },
      ],
    },
    {
      adapters: {
        web: webAdapter,
        custom: customAdapter,
      },
    },
  )

  expect(resolved.targets).toEqual([
    {
      executionTargetProfile: {
        id: 'web',
        adapter: 'web',
        capabilities: ['screenshots'],
      },
      adapter: webAdapter,
    },
    {
      executionTargetProfile: {
        id: 'desktop',
        adapter: 'custom',
        capabilities: ['filesystem'],
      },
      adapter: customAdapter,
    },
  ])
})

test('rejects a profile that names an adapter the extensions did not import', () => {
  expect(() =>
    resolveRunConfiguration(
      {
        schemaVersion: 1,
        executionTargetProfiles: [
          { id: 'android', adapter: 'android', capabilities: ['geolocation'] },
        ],
      },
      { adapters: { web: adapter } },
    ),
  ).toThrow(
    'Execution target profile "android" requires adapter "android". Import it from pickle.extensions.ts.',
  )
})

test('rejects a profile that claims a capability its adapter does not provide', () => {
  expect(() =>
    resolveRunConfiguration(
      {
        schemaVersion: 1,
        executionTargetProfiles: [
          { id: 'web', adapter: 'web', capabilities: ['geolocation'] },
        ],
      },
      { adapters: { web: { ...adapter, capabilities: ['screenshots'] } } },
    ),
  ).toThrow(
    'Execution target profile "web" declares capabilities the adapter does not provide: geolocation',
  )
})

test('binds adapter configuration per execution target profile', () => {
  const staging: ExecutionTargetAdapter = {
    ...adapter,
    capabilities: ['screenshots'],
  }
  const production: ExecutionTargetAdapter = {
    ...adapter,
    capabilities: ['screenshots'],
  }

  const resolved = resolveRunConfiguration(
    {
      schemaVersion: 1,
      executionTargetProfiles: [
        { id: 'staging', adapter: 'web', capabilities: ['screenshots'] },
        { id: 'production', adapter: 'web', capabilities: ['screenshots'] },
      ],
    },
    { adapters: { staging, production } },
  )

  expect(resolved.targets.map((target) => target.adapter)).toEqual([
    staging,
    production,
  ])
})

test('carries the application revision into the resolved run', () => {
  const resolved = resolveRunConfiguration(
    {
      schemaVersion: 1,
      executionTargetProfile: { id: 'web' },
      applicationRevision: 'app-1',
    },
    { adapter },
  )

  expect(resolved.applicationRevision).toBe('app-1')
})

test('defaults infrastructure retries to one when execution policy is omitted', () => {
  const resolved = resolveRunConfiguration(
    {
      schemaVersion: 1,
      executionTargetProfile: { id: 'web' },
    },
    { adapter },
  )

  expect(resolved.retry).toEqual({
    infrastructureErrors: 1,
    functionalFailures: 0,
  })
})

test('disables infrastructure retries when execution.infrastructureRetries is zero', () => {
  const resolved = resolveRunConfiguration(
    {
      schemaVersion: 1,
      executionTargetProfile: { id: 'web' },
      execution: { infrastructureRetries: 0 },
    },
    { adapter },
  )

  expect(resolved.retry).toEqual({
    infrastructureErrors: 0,
    functionalFailures: 0,
  })
})
