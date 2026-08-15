import { expect, test } from 'bun:test'
import { resolveRunConfiguration, type ExecutionTargetAdapter } from '../index'

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
    executionTargetProfile: { id: 'extended-web' },
  })

  expect(resolved).toEqual({
    adapter,
    executionTargetProfile: { id: 'extended-web' },
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
