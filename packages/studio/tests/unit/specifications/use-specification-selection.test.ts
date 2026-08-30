import { describe, expect, test } from 'vitest'
import type { StudioSpecification } from '../../../src/server/server'
import { resolveSpecificationSelection } from '../../../src/specifications/use-specification-selection'

const specifications = [
  {
    id: 'checkout',
    uri: 'features/checkout.feature',
    name: 'Checkout',
    state: 'active',
    scenarios: [{ id: 'pay', name: 'Pay' }],
  },
  {
    id: 'refunds',
    uri: 'features/refunds.feature',
    name: 'Refunds',
    state: 'active',
    scenarios: [
      {
        id: 'request-refund',
        name: 'Request refund',
      },
    ],
  },
] satisfies readonly StudioSpecification[]

describe('Specification route selection', () => {
  test('defaults the Specifications root to the first Specification', () => {
    expect(
      resolveSpecificationSelection({ kind: 'specifications' }, specifications),
    ).toEqual({ selected: specifications[0] })
  })

  test('resolves Specification and scenario identity from the route', () => {
    expect(
      resolveSpecificationSelection(
        { kind: 'specification', specificationId: 'refunds' },
        specifications,
      ),
    ).toEqual({ selected: specifications[1] })
    expect(
      resolveSpecificationSelection(
        {
          kind: 'scenario',
          specificationId: 'checkout',
          scenarioId: 'pay',
        },
        specifications,
      ),
    ).toEqual({
      selected: specifications[0],
      currentScenario: specifications[0]?.scenarios[0],
    })
  })

  test('keeps semantic misses explicit instead of selecting another entity', () => {
    expect(
      resolveSpecificationSelection(
        { kind: 'specification', specificationId: 'missing' },
        specifications,
      ),
    ).toEqual({
      missing: { kind: 'specification', specificationId: 'missing' },
    })
    expect(
      resolveSpecificationSelection(
        {
          kind: 'scenario',
          specificationId: 'checkout',
          scenarioId: 'missing',
        },
        specifications,
      ),
    ).toEqual({
      selected: specifications[0],
      missing: {
        kind: 'scenario',
        specificationId: 'checkout',
        scenarioId: 'missing',
      },
    })
  })

  test('does not invent a Specification selection for Runs routes', () => {
    expect(
      resolveSpecificationSelection(
        { kind: 'run', runId: 'run-42' },
        specifications,
      ),
    ).toEqual({})
  })
})
