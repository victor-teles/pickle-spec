import { describe, expect, test } from 'vitest'
import { parseSpecification, scenarioRevision } from '../../index'
import { requiredValue } from '../required-value'

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

    expect(scenarioRevision(requiredValue(checkout.scenarios[0]))).toBe(
      scenarioRevision(requiredValue(renamed.scenarios[0])),
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

    const original = scenarioRevision(requiredValue(checkout.scenarios[0]))
    expect(scenarioRevision(requiredValue(editedText.scenarios[0]))).not.toBe(
      original,
    )
    expect(scenarioRevision(requiredValue(withArgument.scenarios[0]))).not.toBe(
      original,
    )
    expect(scenarioRevision(requiredValue(editedText.scenarios[0]))).not.toBe(
      scenarioRevision(requiredValue(withArgument.scenarios[0])),
    )
  })

  test('uses the Scenario Outline template instead of runtime binding values', () => {
    const specification = parseSpecification({
      uri: 'features/search.feature',
      source: `Feature: Search
  Scenario Outline: Find <product>
    When the customer searches for <product>
    Then the result contains <product>

    Examples:
      | product |
      | Pickles |
      | Olives  |`,
    })

    expect(scenarioRevision(requiredValue(specification.scenarios[0]))).toBe(
      scenarioRevision(requiredValue(specification.scenarios[1])),
    )
  })
})
