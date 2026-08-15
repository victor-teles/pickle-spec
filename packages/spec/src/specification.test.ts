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

  test('includes feature and rule backgrounds in nested scenarios', () => {
    const specification = parseSpecification({
      uri: 'features/account.feature',
      source: `Feature: Account access
  Background:
    Given an account exists

  Scenario: View the account
    When the customer opens the account
    Then the balance is visible

  @locked
  Rule: Locked accounts
    Background:
      Given the account is locked

    @security
    Scenario: Reject access
      When the customer opens the account
      Then access is denied`,
    })

    expect(specification.scenarios).toEqual([
      {
        name: 'View the account',
        tags: [],
        steps: [
          { keyword: 'Given', text: 'an account exists' },
          { keyword: 'When', text: 'the customer opens the account' },
          { keyword: 'Then', text: 'the balance is visible' },
        ],
      },
      {
        name: 'Reject access',
        tags: ['@locked', '@security'],
        steps: [
          { keyword: 'Given', text: 'an account exists' },
          { keyword: 'Given', text: 'the account is locked' },
          { keyword: 'When', text: 'the customer opens the account' },
          { keyword: 'Then', text: 'access is denied' },
        ],
      },
    ])
  })
})
