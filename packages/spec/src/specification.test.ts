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
          tags: ['@smoke'],
          steps: [
            {
              keyword: 'Given',
              text: 'a product is in the basket',
              type: 'context',
            },
            {
              keyword: 'When',
              text: 'the customer confirms the order',
              type: 'action',
            },
            { keyword: 'Then', text: 'the purchase succeeds', type: 'outcome' },
          ],
        },
      ],
    })

    expect(JSON.stringify(specification)).not.toContain('gherkinDocument')
    expect(JSON.stringify(specification)).not.toContain('pickle')
  })

  test('maps namespaced identity tags and Examples row identifiers onto the Specification', () => {
    const specification = parseSpecification({
      uri: 'features/search.feature',
      source: `@pickle:id:specaaaaaaaaaaaa @pickle:state:draft
Feature: Search
  @pickle:id:scnbbbbbbbbbbbb
  Scenario Outline: Find a product
    When the customer searches for <product>
    Then the product page shows <product>

    @pickle:id:exscccccccccccccccc
    Examples:
      | pickle_id | product |
      | rowdddddddddddddd | Pickles |
      | roweeeeeeeeeeeeee | Olives  |
`,
    })

    expect(specification.id).toBe('specaaaaaaaaaaaa')
    expect(specification.state).toBe('draft')
    expect(specification.scenarios).toEqual([
      {
        name: 'Find a product',
        id: 'scnbbbbbbbbbbbb',
        examplesId: 'exscccccccccccccccc',
        examplesRowId: 'rowdddddddddddddd',
        tags: [
          '@pickle:id:specaaaaaaaaaaaa',
          '@pickle:state:draft',
          '@pickle:id:scnbbbbbbbbbbbb',
          '@pickle:id:exscccccccccccccccc',
        ],
        steps: [
          {
            keyword: 'When',
            text: 'the customer searches for Pickles',
            type: 'action',
          },
          {
            keyword: 'Then',
            text: 'the product page shows Pickles',
            type: 'outcome',
          },
        ],
      },
      {
        name: 'Find a product',
        id: 'scnbbbbbbbbbbbb',
        examplesId: 'exscccccccccccccccc',
        examplesRowId: 'roweeeeeeeeeeeeee',
        tags: [
          '@pickle:id:specaaaaaaaaaaaa',
          '@pickle:state:draft',
          '@pickle:id:scnbbbbbbbbbbbb',
          '@pickle:id:exscccccccccccccccc',
        ],
        steps: [
          {
            keyword: 'When',
            text: 'the customer searches for Olives',
            type: 'action',
          },
          {
            keyword: 'Then',
            text: 'the product page shows Olives',
            type: 'outcome',
          },
        ],
      },
    ])
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
          { keyword: 'Given', text: 'an account exists', type: 'context' },
          {
            keyword: 'When',
            text: 'the customer opens the account',
            type: 'action',
          },
          { keyword: 'Then', text: 'the balance is visible', type: 'outcome' },
        ],
      },
      {
        name: 'Reject access',
        tags: ['@locked', '@security'],
        steps: [
          { keyword: 'Given', text: 'an account exists', type: 'context' },
          { keyword: 'Given', text: 'the account is locked', type: 'context' },
          {
            keyword: 'When',
            text: 'the customer opens the account',
            type: 'action',
          },
          { keyword: 'Then', text: 'access is denied', type: 'outcome' },
        ],
      },
    ])
  })

  test('expands Scenario Outlines and exposes adapter-neutral step types', () => {
    const specification = parseSpecification({
      uri: 'features/search.feature',
      source: `@web
Feature: Search
  Background:
    Given the search page is open

  Scenario Outline: Find a product
    When the customer searches for <product>
    And opens the first result
    Then the product page shows <product>

    Examples:
      | product |
      | Pickles |
      | Olives  |`,
    })

    expect(specification.scenarios).toEqual([
      {
        name: 'Find a product',
        tags: ['@web'],
        steps: [
          {
            keyword: 'Given',
            text: 'the search page is open',
            type: 'context',
          },
          {
            keyword: 'When',
            text: 'the customer searches for Pickles',
            type: 'action',
          },
          { keyword: 'And', text: 'opens the first result', type: 'action' },
          {
            keyword: 'Then',
            text: 'the product page shows Pickles',
            type: 'outcome',
          },
        ],
      },
      {
        name: 'Find a product',
        tags: ['@web'],
        steps: [
          {
            keyword: 'Given',
            text: 'the search page is open',
            type: 'context',
          },
          {
            keyword: 'When',
            text: 'the customer searches for Olives',
            type: 'action',
          },
          { keyword: 'And', text: 'opens the first result', type: 'action' },
          {
            keyword: 'Then',
            text: 'the product page shows Olives',
            type: 'outcome',
          },
        ],
      },
    ])
  })
})
