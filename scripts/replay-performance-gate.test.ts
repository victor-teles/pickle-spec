import { expect, test } from 'bun:test'
import { runReplayPerformanceGate } from './replay-performance-gate'

test('runs both adapter gates before aggregating a failure', async () => {
  const adapters: string[] = []

  const exitCode = await runReplayPerformanceGate(async (adapter) => {
    adapters.push(adapter)
    return adapter === 'web' ? 1 : 0
  })

  expect(adapters).toEqual(['web', 'mobile'])
  expect(exitCode).toBe(1)
})

test('passes only after both adapter gates pass', async () => {
  expect(await runReplayPerformanceGate(async () => 0)).toBe(0)
})
