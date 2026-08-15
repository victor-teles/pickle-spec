import { expect, test } from 'bun:test'
import {
  resolveRunConfiguration,
  validateProjectRunConfiguration,
  validateRunConfiguration,
  type ExecutionTargetAdapter,
} from '../index'

const adapter: ExecutionTargetAdapter = {
  async openSession() {
    return {
      async executeStep() { return { state: 'passed', resolvedActions: [] } },
      async close() {},
    }
  },
}

test('combines versioned configuration and extensions into validated runner input', () => {
  const resolved = resolveRunConfiguration({
    schemaVersion: 1,
    executionTargetProfile: { id: 'configured-web' },
    concurrency: 3,
    execution: {
      infrastructureRetries: 2,
      scenarioTimeoutMs: 30_000,
      stepTimeoutMs: 5_000,
    },
  }, {
    adapter,
  })

  expect(resolved).toEqual({
    adapter,
    executionTargetProfile: { id: 'configured-web' },
    concurrency: 3,
    retry: { infrastructureErrors: 2 },
    timeout: { scenarioMs: 30_000, stepMs: 5_000 },
  })
})

test('rejects an unsupported configuration schema before execution', () => {
  expect(() => resolveRunConfiguration({
    schemaVersion: 2 as 1,
    executionTargetProfile: { id: 'web' },
  }, { adapter })).toThrow('Unsupported configuration schemaVersion: 2')
})

test('validates run policies without requiring an execution adapter', () => {
  expect(() => validateRunConfiguration({
    schemaVersion: 1,
    executionTargetProfile: { id: 'web' },
    execution: { scenarioTimeoutMs: 0 },
  })).toThrow('execution.scenarioTimeoutMs must be an integer greater than or equal to 1')
})

test('combines project configuration with the extension manifest before execution', () => {
  const configuration = {
    schemaVersion: 1 as const,
    executionTargetProfile: { id: 'custom' },
  }

  expect(validateProjectRunConfiguration(configuration, {
    adapterAvailable: true,
    fallbackAdapterAvailable: false,
  }))
    .toEqual(configuration)
  expect(validateProjectRunConfiguration(configuration, {
    adapterAvailable: false,
    fallbackAdapterAvailable: true,
  }))
    .toEqual(configuration)
  expect(() => validateProjectRunConfiguration(configuration, {
    adapterAvailable: false,
    fallbackAdapterAvailable: false,
  })).toThrow('Configure web.baseUrl or export an adapter from pickle.extensions.ts')
})
