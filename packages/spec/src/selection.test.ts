import { describe, expect, test } from 'bun:test'
import {
  type Scenario,
  type Specification,
  type SpecificationState,
  selectScenarios,
  validateSelectionOptions,
} from '../index'

function scenario(name: string, tags: string[] = []): Scenario {
  return { name, tags, steps: [] }
}

function specification(
  uri: string,
  scenarios: Scenario[],
  state?: SpecificationState,
): Specification {
  return {
    name: uri,
    source: { uri, language: 'en' },
    tags: [],
    scenarios,
    ...(state ? { state } : {}),
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

    expect(
      selected.map(({ specification, scenario }) => [
        specification.source.uri,
        scenario.name,
      ]),
    ).toEqual([['features/a.feature', 'Checkout with a voucher']])
  })

  test('rejects invalid shard coordinates', () => {
    expect(() =>
      selectScenarios([], { shard: { index: 2, total: 1 } }),
    ).toThrow(
      'selection.shard.index must be less than or equal to selection.shard.total',
    )
  })

  test('rejects unsupported characters in tag expressions', () => {
    expect(() =>
      validateSelectionOptions({ tagExpression: '@smoke !' }),
    ).toThrow('Unexpected character "!" in tag expression')
    expect(() =>
      validateSelectionOptions({ tagExpression: '@smoke,' }),
    ).toThrow('Unexpected character "," in tag expression')
  })

  test('balances shards by historical duration when timing data exists', () => {
    const specifications = [
      specification('features/a.feature', [
        scenario('Fast checkout', ['@pickle:id:scn-fast']),
        scenario('Slow checkout', ['@pickle:id:scn-slow']),
      ]),
      specification('features/b.feature', [
        scenario('Medium checkout', ['@pickle:id:scn-medium']),
        scenario('Another slow checkout', ['@pickle:id:scn-slow-2']),
      ]),
    ]

    const shardOne = selectScenarios(
      specifications,
      { shard: { index: 1, total: 2 } },
      {
        historicalDurations: {
          'scn-fast': 100,
          'scn-slow': 900,
          'scn-medium': 400,
          'scn-slow-2': 850,
        },
      },
    )
    const shardTwo = selectScenarios(
      specifications,
      { shard: { index: 2, total: 2 } },
      {
        historicalDurations: {
          'scn-fast': 100,
          'scn-slow': 900,
          'scn-medium': 400,
          'scn-slow-2': 850,
        },
      },
    )

    expect(shardOne.map(({ scenario }) => scenario.name).sort()).toEqual([
      'Fast checkout',
      'Slow checkout',
    ])
    expect(shardTwo.map(({ scenario }) => scenario.name).sort()).toEqual([
      'Another slow checkout',
      'Medium checkout',
    ])
  })

  test('uses deterministic scenario counts when no historical durations match', () => {
    const specifications = [
      specification('features/a.feature', [
        scenario('First runnable'),
        scenario('Second runnable'),
      ]),
    ]

    const selected = selectScenarios(
      specifications,
      { shard: { index: 1, total: 2 } },
      { historicalDurations: { 'other-scenario': 500 } },
    )

    expect(selected.map(({ scenario }) => scenario.name)).toEqual([
      'First runnable',
    ])
  })

  test('does not assign ignored Scenarios to a shard or count them as shard positions', () => {
    const selected = selectScenarios(
      [
        specification('features/search.feature', [
          scenario('Ignored', ['@ignore']),
          scenario('First runnable'),
          scenario('Second runnable'),
        ]),
      ],
      { shard: { index: 1, total: 2 } },
    )

    expect(selected.map(({ scenario }) => scenario.name)).toEqual([
      'First runnable',
    ])
  })

  test('selects Scenarios by path, tag, state, and name query', () => {
    const specifications = [
      specification(
        'features/checkout/guest.feature',
        [scenario('Checkout as a guest', ['@smoke'])],
        'active',
      ),
      specification(
        'features/checkout/member.feature',
        [scenario('Checkout as a member', ['@smoke'])],
        'draft',
      ),
      specification(
        'features/search.feature',
        [scenario('Find a product', ['@smoke'])],
        'active',
      ),
      specification(
        'features/legacy.feature',
        [scenario('Deprecated checkout', ['@smoke'])],
        'deprecated',
      ),
    ]

    const selected = selectScenarios(specifications, {
      paths: ['features/checkout/**'],
      tagExpression: '@smoke',
      states: ['active', 'draft'],
      scenarioName: 'checkout',
    })

    expect(
      selected.map(({ specification, scenario }) => [
        specification.source.uri,
        specification.state,
        scenario.name,
      ]),
    ).toEqual([
      ['features/checkout/guest.feature', 'active', 'Checkout as a guest'],
      ['features/checkout/member.feature', 'draft', 'Checkout as a member'],
    ])
  })

  test('runs active Specifications by default and keeps draft and deprecated outside normal selection', () => {
    const selected = selectScenarios([
      specification(
        'features/active.feature',
        [scenario('Active checkout')],
        'active',
      ),
      specification('features/untagged.feature', [
        scenario('Untagged checkout'),
      ]),
      specification(
        'features/draft.feature',
        [scenario('Draft checkout')],
        'draft',
      ),
      specification(
        'features/deprecated.feature',
        [scenario('Deprecated checkout')],
        'deprecated',
      ),
    ])

    expect(selected.map(({ scenario }) => scenario.name)).toEqual([
      'Active checkout',
      'Untagged checkout',
    ])
  })

  test('includes draft or deprecated Specifications only when a state query selects them', () => {
    const specifications = [
      specification('features/draft.feature', [scenario('Draft')], 'draft'),
      specification(
        'features/deprecated.feature',
        [scenario('Deprecated')],
        'deprecated',
      ),
    ]

    expect(
      selectScenarios(specifications, { states: ['draft'] }).map(
        ({ scenario }) => scenario.name,
      ),
    ).toEqual(['Draft'])
    expect(
      selectScenarios(specifications, { states: ['deprecated'] }).map(
        ({ scenario }) => scenario.name,
      ),
    ).toEqual(['Deprecated'])
  })

  test('rejects unsupported selection path and state queries', () => {
    expect(() => validateSelectionOptions({ paths: '' })).toThrow(
      'selection.paths must contain at least one path',
    )
    expect(() => validateSelectionOptions({ paths: [''] })).toThrow(
      'selection.paths must not contain an empty path',
    )
    expect(() => validateSelectionOptions({ states: [] })).toThrow(
      'selection.states must contain at least one Specification state',
    )
    expect(() => validateSelectionOptions({ states: ['published'] })).toThrow(
      'selection.states must be draft, active, or deprecated',
    )
  })
})
