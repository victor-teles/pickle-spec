import { expect, test } from 'vitest'
import { runReplayPerformanceGate } from './replay-performance-gate'

test('retries a budget failure once before aggregating a failure', async () => {
  const adapters: string[] = []

  const exitCode = await runReplayPerformanceGate(async (adapter) => {
    adapters.push(adapter)
    return adapter === 'web' ? 1 : 0
  })

  expect(adapters).toEqual(['web', 'web', 'mobile'])
  expect(exitCode).toBe(1)
})

test('passes when a repeated benchmark clears a one-off budget failure', async () => {
  const adapters: string[] = []

  const exitCode = await runReplayPerformanceGate(async (adapter) => {
    adapters.push(adapter)
    return adapters.length === 1 ? 1 : 0
  })

  expect(adapters).toEqual(['web', 'web', 'mobile'])
  expect(exitCode).toBe(0)
})

test('does not retry an adapter execution error', async () => {
  const adapters: string[] = []

  const exitCode = await runReplayPerformanceGate(async (adapter) => {
    adapters.push(adapter)
    return adapter === 'web' ? 2 : 0
  })

  expect(adapters).toEqual(['web', 'mobile'])
  expect(exitCode).toBe(1)
})

test('passes only after both adapter gates pass', async () => {
  expect(await runReplayPerformanceGate(async () => 0)).toBe(0)
})
