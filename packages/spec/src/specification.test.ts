import { describe, expect, test } from 'bun:test'
import { parseSpecification } from '../index'

describe('parseSpecification', () => {
  test('maps Gherkin source into Pickle Spec domain concepts', () => {
    const specification = parseSpecification({
      uri: 'features/checkout.feature',
      source: `@smoke
Feature: Checkout
  Scenario: Complete a purchase
    Given a product is in the basket
    When the customer confirms the order
    Then the purchase succeeds`,
    })

    expect(specification).toEqual({
      name: 'Checkout',
      source: {
        uri: 'features/checkout.feature',
        language: 'en',
      },
      tags: ['@smoke'],
      scenarios: [
        {
          name: 'Complete a purchase',
          tags: [],
          steps: [
            { keyword: 'Given', text: 'a product is in the basket' },
            { keyword: 'When', text: 'the customer confirms the order' },
            { keyword: 'Then', text: 'the purchase succeeds' },
          ],
        },
      ],
    })

    expect(JSON.stringify(specification)).not.toContain('gherkinDocument')
    expect(JSON.stringify(specification)).not.toContain('pickle')
  })
})
