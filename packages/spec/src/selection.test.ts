import { describe, expect, test } from 'bun:test'
import {
  selectScenarios,
  validateSelectionOptions,
  type Scenario,
  type Specification,
} from '../index'

function scenario(name: string, tags: string[] = []): Scenario {
  return { name, tags, steps: [] }
}

function specification(uri: string, scenarios: Scenario[]): Specification {
  return {
    name: uri,
    source: { uri, language: 'en' },
    tags: [],
    scenarios,
  }
}

describe('selectScenarios', () => {
  test('filters by tag expression and name before applying a stable shard', () => {
    const specifications = [
      specification('features/b.feature', [
        scenario('Checkout as a guest', ['@smoke']),
        scenario('Checkout as a member', ['@smoke', '@slow']),
      ]),
      specification('features/a.feature', [
        scenario('Checkout with a voucher', ['@smoke']),
        scenario('View the catalogue', ['@smoke']),
      ]),
    ]

    const selected = selectScenarios(specifications, {
      scenarioName: 'checkout',
      tagExpression: '@smoke and not @slow',
      shard: { index: 1, total: 2 },
    })

    expect(selected.map(({ specification, scenario }) => [
      specification.source.uri,
      scenario.name,
    ])).toEqual([
      ['features/a.feature', 'Checkout with a voucher'],
    ])
  })

  test('rejects invalid shard coordinates', () => {
    expect(() => selectScenarios([], { shard: { index: 2, total: 1 } }))
      .toThrow('selection.shard.index must be less than or equal to selection.shard.total')
  })

  test('rejects unsupported characters in tag expressions', () => {
    expect(() => validateSelectionOptions({ tagExpression: '@smoke !' }))
      .toThrow('Unexpected character "!" in tag expression')
    expect(() => validateSelectionOptions({ tagExpression: '@smoke,' }))
      .toThrow('Unexpected character "," in tag expression')
  })

  test('does not assign ignored Scenarios to a shard or count them as shard positions', () => {
    const selected = selectScenarios([
      specification('features/search.feature', [
        scenario('Ignored', ['@ignore']),
        scenario('First runnable'),
        scenario('Second runnable'),
      ]),
    ], { shard: { index: 1, total: 2 } })

    expect(selected.map(({ scenario }) => scenario.name)).toEqual(['First runnable'])
  })
})
