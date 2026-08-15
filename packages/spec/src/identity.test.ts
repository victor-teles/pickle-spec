import { describe, expect, test } from 'bun:test'
import {
  formatMigrationPreview,
  planSpecificationMigration,
  validateSpecificationMetadata,
} from '../index'

const checkoutSource = `# keep this comment

@smoke
Feature: Checkout

  # scenario comment
  Scenario: Complete a purchase
    Given a product is in the basket
    Then the purchase succeeds

  Scenario Outline: Pay
    When the customer pays with <method>
    Then the payment succeeds

    Examples: Payment methods
      | method |
      | card   |
      | cash   |
`

describe('planSpecificationMigration', () => {
  test('previews missing Specification state without rewriting unrelated source or adding identifiers', () => {
    const plan = planSpecificationMigration([
      { uri: 'features/checkout.feature', source: checkoutSource },
    ])
    const preview = formatMigrationPreview(plan)

    expect(preview).toContain('features/checkout.feature')
    expect(preview).toContain('Feature "Checkout": add @pickle:state:active')
    expect(preview).not.toContain('@pickle:id:')
    expect(preview).not.toContain('pickle_id')

    const nextSource = plan.files[0]?.nextSource ?? ''
    expect(nextSource).toContain('# keep this comment')
    expect(nextSource).toContain('  # scenario comment')
    expect(nextSource).toContain('\n@smoke\n@pickle:state:active')
    expect(nextSource).not.toContain('@pickle:id:')
    expect(nextSource).not.toContain('pickle_id')
    expect(nextSource).toContain('| method |')
    expect(nextSource).toContain('| card   |')
    expect(nextSource).toContain('| cash   |')
    expect(plan.files[0]?.source).toBe(checkoutSource)
  })

  test('keeps existing identifiers and only fills missing metadata', () => {
    const source = `@pickle:id:specaaaaaaaaaaaa @pickle:state:draft
Feature: Checkout
  @pickle:id:scnbbbbbbbbbbbb
  Scenario: Complete a purchase
    Then the purchase succeeds
`

    const plan = planSpecificationMigration([
      { uri: 'features/checkout.feature', source },
    ])

    expect(plan.changes).toEqual([])
    expect(plan.files[0]?.nextSource).toBe(source)
  })
})

describe('validateSpecificationMetadata', () => {
  test('accepts complete unique metadata', () => {
    expect(() =>
      validateSpecificationMetadata([
        {
          uri: 'features/checkout.feature',
          source: `@pickle:id:specaaaaaaaaaaaa @pickle:state:active
Feature: Checkout
  @pickle:id:scnbbbbbbbbbbbb
  Scenario: Complete a purchase
    Then the purchase succeeds
`,
        },
      ]),
    ).not.toThrow()
  })

  test('accepts a Specification that declares state and derives identifiers', () => {
    expect(() =>
      validateSpecificationMetadata([
        {
          uri: 'features/checkout.feature',
          source: `@pickle:state:active
Feature: Checkout
  Scenario: Complete a purchase
    Then the purchase succeeds
`,
        },
      ]),
    ).not.toThrow()
  })

  test('rejects missing state, duplicate, malformed, and conflicting metadata', () => {
    expect(() =>
      validateSpecificationMetadata([
        {
          uri: 'features/missing.feature',
          source: `Feature: Missing
  Scenario: Needs identity
    Then validation fails
`,
        },
      ]),
    ).toThrow(/missing a Specification state/)

    expect(() =>
      validateSpecificationMetadata([
        {
          uri: 'features/checkout.feature',
          source: `@pickle:state:active
Feature: Checkout
  Scenario: Login
    Then it works
  Scenario: Login
    Then it also works
`,
        },
      ]),
    ).toThrow(/Duplicate identifier/)

    expect(() =>
      validateSpecificationMetadata([
        {
          uri: 'features/a.feature',
          source: `@pickle:id:duplicateduplicate @pickle:state:active
Feature: First
  @pickle:id:scncccccccccccccccc
  Scenario: One
    Then it works
`,
        },
        {
          uri: 'features/b.feature',
          source: `@pickle:id:duplicateduplicate @pickle:state:draft
Feature: Second
  @pickle:id:scnddddddddddddddd
  Scenario: Two
    Then it works
`,
        },
      ]),
    ).toThrow(/Duplicate identifier "duplicateduplicate"/)

    expect(() =>
      validateSpecificationMetadata([
        {
          uri: 'features/malformed.feature',
          source: `@pickle:id:bad.value @pickle:state:active
Feature: Malformed
  @pickle:id:scneeeeeeeeeeeeeee
  Scenario: One
    Then it works
`,
        },
      ]),
    ).toThrow(/malformed durable identifier/)

    expect(() =>
      validateSpecificationMetadata([
        {
          uri: 'features/conflict.feature',
          source: `@pickle:id:specffffffffffffffff @pickle:state:draft @pickle:state:active
Feature: Conflict
  @pickle:id:scnffffffffffffffff
  Scenario: One
    Then it works
`,
        },
      ]),
    ).toThrow(/conflicting Specification states/)
  })
})
