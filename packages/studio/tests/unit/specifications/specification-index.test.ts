import { describe, expect, test } from 'vitest'
import {
  filterSpecificationIndex,
  type SpecificationIndexEntry,
} from '../../../src/features/specifications/specification-index'
import type { StudioSpecification } from '../../../src/server/contracts'

const specifications: readonly StudioSpecification[] = [
  {
    id: 'spec-checkout',
    name: 'Checkout',
    uri: 'features/checkout.feature',
    scenarios: [
      { id: 'scenario-pay', name: 'Pay for the order' },
      { id: 'scenario-review', name: 'Review the purchase' },
    ],
  },
  {
    id: 'spec-search',
    name: 'Search',
    uri: 'features/catalog-search.feature',
    scenarios: [{ id: 'scenario-query', name: 'Query the catalog' }],
  },
]

function entryNames(entries: readonly SpecificationIndexEntry[]): string[] {
  return entries.map((entry) => entry.specification.name)
}

describe('Specification index filters', () => {
  test('keeps the complete accordion index when no filter is entered', () => {
    const entries = filterSpecificationIndex(specifications, 'all', '')

    expect(entryNames(entries)).toEqual(['Checkout', 'Search'])
    expect(entries[0]?.scenarios).toEqual(specifications[0]?.scenarios)
  })

  test('matches a Specification by name or URI and keeps all its Scenarios', () => {
    const byName = filterSpecificationIndex(
      specifications,
      'specifications',
      'checkout',
    )
    const byUri = filterSpecificationIndex(
      specifications,
      'specifications',
      'catalog-search',
    )

    expect(entryNames(byName)).toEqual(['Checkout'])
    expect(byName[0]?.scenarios).toHaveLength(2)
    expect(entryNames(byUri)).toEqual(['Search'])
  })

  test('matches Scenarios while preserving their owning Specification', () => {
    const entries = filterSpecificationIndex(
      specifications,
      'scenarios',
      'query',
    )

    expect(entryNames(entries)).toEqual(['Search'])
    expect(entries[0]?.scenarios.map((scenario) => scenario.name)).toEqual([
      'Query the catalog',
    ])
  })

  test('lets All match either a Specification or one of its Scenarios', () => {
    const specificationMatch = filterSpecificationIndex(
      specifications,
      'all',
      'checkout',
    )
    const scenarioMatch = filterSpecificationIndex(
      specifications,
      'all',
      'review',
    )

    expect(specificationMatch[0]?.scenarios).toHaveLength(2)
    expect(scenarioMatch[0]?.specification.name).toBe('Checkout')
    expect(
      scenarioMatch[0]?.scenarios.map((scenario) => scenario.name),
    ).toEqual(['Review the purchase'])
  })
})
