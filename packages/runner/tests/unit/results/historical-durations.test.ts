import { describe, expect, test } from 'vitest'
import type { TestResult } from '../../../src/execution/run-scenario'
import { historicalDurationsFrom } from '../../../src/results/historical-durations'

function result(name: string, durationMs: number, id?: string): TestResult {
  const startedAt = '2026-08-15T12:00:00.000Z'
  const finishedAt = new Date(Date.parse(startedAt) + durationMs).toISOString()
  return {
    schemaVersion: 2,
    specification: { name: 'Checkout', uri: 'features/checkout.feature' },
    scenario: { name, ...(id ? { id } : {}) },
    executionTargetProfile: { id: 'web' },
    state: 'passed',
    startedAt,
    finishedAt,
    durationMs,
    attempts: [
      {
        attempt: 1,
        startedAt,
        finishedAt,
        durationMs,
        state: 'passed',
        steps: [],
        evidenceAvailability: [
          { kind: 'screenshot', state: 'not-supported' },
          { kind: 'trace', state: 'not-supported' },
          { kind: 'recording', state: 'not-supported' },
          { kind: 'device-log', state: 'not-supported' },
          { kind: 'diagnostics', state: 'not-supported' },
        ],
      },
    ],
  }
}

describe('historicalDurationsFrom', () => {
  test('records the longest duration per Scenario key', () => {
    expect(
      historicalDurationsFrom([
        result('Guest checkout', 120, 'scn-guest'),
        result('Guest checkout', 180, 'scn-guest'),
        result('Member checkout', 90, 'scn-member'),
      ]),
    ).toEqual({
      'scn-guest': 180,
      'scn-member': 90,
    })
  })

  test('falls back to specification uri and Scenario name when no id exists', () => {
    expect(historicalDurationsFrom([result('Guest checkout', 120)])).toEqual({
      'features/checkout.feature::Guest checkout': 120,
    })
  })
})
