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
  test('previews namespaced identifiers and lifecycle tags without rewriting unrelated source', () => {
    const plan = planSpecificationMigration([
      { uri: 'features/checkout.feature', source: checkoutSource },
    ])
    const preview = formatMigrationPreview(plan)

    expect(preview).toContain('features/checkout.feature')
    expect(preview).toMatch(/Feature "Checkout": add @pickle:id:[0-9a-f]{16} @pickle:state:active/)
    expect(preview).toMatch(/Scenario "Complete a purchase": add @pickle:id:[0-9a-f]{16}/)
    expect(preview).toMatch(/Scenario "Pay": add @pickle:id:[0-9a-f]{16}/)
    expect(preview).toMatch(/Examples "Payment methods": add @pickle:id:[0-9a-f]{16}/)
    expect(preview).toMatch(/Examples row 1: add pickle_id [0-9a-f]{16}/)
    expect(preview).toMatch(/Examples row 2: add pickle_id [0-9a-f]{16}/)

    const nextSource = plan.files[0]?.nextSource ?? ''
    expect(nextSource).toContain('# keep this comment')
    expect(nextSource).toContain('  # scenario comment')
    expect(nextSource).toContain('\n@smoke\n@pickle:id:')
    expect(nextSource).toContain('@pickle:state:active')
    expect(nextSource).toContain('| pickle_id | method |')
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

    const plan = planSpecificationMigration([{ uri: 'features/checkout.feature', source }])

    expect(plan.changes).toEqual([])
    expect(plan.files[0]?.nextSource).toBe(source)
  })
})

describe('validateSpecificationMetadata', () => {
  test('accepts complete unique metadata', () => {
    expect(() => validateSpecificationMetadata([
      {
        uri: 'features/checkout.feature',
        source: `@pickle:id:specaaaaaaaaaaaa @pickle:state:active
Feature: Checkout
  @pickle:id:scnbbbbbbbbbbbb
  Scenario: Complete a purchase
    Then the purchase succeeds
`,
      },
    ])).not.toThrow()
  })

  test('rejects missing, duplicate, malformed, and conflicting metadata', () => {
    expect(() => validateSpecificationMetadata([
      {
        uri: 'features/missing.feature',
        source: `Feature: Missing
  Scenario: Needs identity
    Then validation fails
`,
      },
    ])).toThrow(/missing a durable identifier/)

    expect(() => validateSpecificationMetadata([
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
    ])).toThrow(/Duplicate identifier "duplicateduplicate"/)

    expect(() => validateSpecificationMetadata([
      {
        uri: 'features/malformed.feature',
        source: `@pickle:id:bad.value @pickle:state:active
Feature: Malformed
  @pickle:id:scneeeeeeeeeeeeeee
  Scenario: One
    Then it works
`,
      },
    ])).toThrow(/malformed durable identifier/)

    expect(() => validateSpecificationMetadata([
      {
        uri: 'features/conflict.feature',
        source: `@pickle:id:specffffffffffffffff @pickle:state:draft @pickle:state:active
Feature: Conflict
  @pickle:id:scnffffffffffffffff
  Scenario: One
    Then it works
`,
      },
    ])).toThrow(/conflicting Specification states/)
  })
})
