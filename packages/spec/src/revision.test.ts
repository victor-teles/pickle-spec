import { describe, expect, test } from 'bun:test'
import { parseSpecification, scenarioRevision } from '../index'

const checkout = parseSpecification({
  uri: 'features/checkout.feature',
  source: `@pickle:id:specaaaaaaaaaaaa @pickle:state:active
Feature: Checkout
  @pickle:id:scnbbbbbbbbbbbb
  Scenario: Complete a purchase
    Given a product is in the basket
    Then the purchase succeeds`,
})

describe('scenarioRevision', () => {
  test('stays stable when the Scenario name or identifier changes', () => {
    const renamed = parseSpecification({
      uri: 'features/checkout.feature',
      source: `@pickle:id:specaaaaaaaaaaaa @pickle:state:active
Feature: Checkout
  @pickle:id:scncccccccccccccccc
  Scenario: Finish buying
    Given a product is in the basket
    Then the purchase succeeds`,
    })

    expect(scenarioRevision(checkout.scenarios[0]!)).toBe(
      scenarioRevision(renamed.scenarios[0]!),
    )
  })

  test('changes when step text or step arguments change', () => {
    const editedText = parseSpecification({
      uri: 'features/checkout.feature',
      source: `@pickle:id:specaaaaaaaaaaaa @pickle:state:active
Feature: Checkout
  @pickle:id:scnbbbbbbbbbbbb
  Scenario: Complete a purchase
    Given two products are in the basket
    Then the purchase succeeds`,
    })
    const withArgument = parseSpecification({
      uri: 'features/checkout.feature',
      source: `@pickle:id:specaaaaaaaaaaaa @pickle:state:active
Feature: Checkout
  @pickle:id:scnbbbbbbbbbbbb
  Scenario: Complete a purchase
    Given a product is in the basket
      | sku |
      | A1  |
    Then the purchase succeeds`,
    })

    const original = scenarioRevision(checkout.scenarios[0]!)
    expect(scenarioRevision(editedText.scenarios[0]!)).not.toBe(original)
    expect(scenarioRevision(withArgument.scenarios[0]!)).not.toBe(original)
    expect(scenarioRevision(editedText.scenarios[0]!)).not.toBe(
      scenarioRevision(withArgument.scenarios[0]!),
    )
  })
})
