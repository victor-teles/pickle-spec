import { describe, expect, test } from 'bun:test'
import { historicalDurationsFrom } from './historical-durations'
import type { TestResult } from './run-scenario'

function result(name: string, durationMs: number, id?: string): TestResult {
  return {
    schemaVersion: 1,
    specification: { name: 'Checkout', uri: 'features/checkout.feature' },
    scenario: { name, ...(id ? { id } : {}) },
    executionTargetProfile: { id: 'web' },
    state: 'passed',
    steps: [],
    durationMs,
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
