import { describe, expect, test } from 'bun:test'
import {
  applySpecificationMetadata,
  applySpecificationSource,
  applyStructuredSpecification,
  ensureSpecificationState,
  parseExternalLinks,
  readSpecificationDocument,
  specificationSourceDiff,
} from '../index'

const checkoutSource = `# keep this comment

@smoke
Feature: Checkout
  the basket path

  # scenario comment
  @pay
  Scenario: Complete a purchase
    Given a product is in the basket
    Then the purchase succeeds

  Rule: Members
    Scenario Outline: Pay
      When the customer pays with <method>
      Then the payment succeeds

      @fast
      Examples: Payment methods
        | method |
        | card   |
        | cash   |
`

describe('readSpecificationDocument', () => {
  test('maps Feature, Rule, Scenario, steps, tags, and Examples data for structured editing', () => {
    const document = readSpecificationDocument({
      uri: 'features/checkout.feature',
      source: checkoutSource,
    })

    expect(document).toEqual({
      uri: 'features/checkout.feature',
      source: checkoutSource,
      language: 'en',
      specification: {
        name: 'Checkout',
        tags: ['@smoke'],
        children: [
          {
            kind: 'scenario',
            keyword: 'Scenario',
            name: 'Complete a purchase',
            tags: ['@pay'],
            steps: [
              { keyword: 'Given', text: 'a product is in the basket' },
              { keyword: 'Then', text: 'the purchase succeeds' },
            ],
            examples: [],
          },
          {
            kind: 'rule',
            name: 'Members',
            tags: [],
            children: [
              {
                kind: 'scenario',
                keyword: 'Scenario Outline',
                name: 'Pay',
                tags: [],
                steps: [
                  {
                    keyword: 'When',
                    text: 'the customer pays with <method>',
                  },
                  { keyword: 'Then', text: 'the payment succeeds' },
                ],
                examples: [
                  {
                    name: 'Payment methods',
                    tags: ['@fast'],
                    header: ['method'],
                    rows: [['card'], ['cash']],
                  },
                ],
              },
            ],
          },
        ],
      },
    })
    expect(JSON.stringify(document)).not.toContain('gherkinDocument')
    expect(JSON.stringify(document)).not.toContain('"pickle"')
  })
})

describe('applyStructuredSpecification', () => {
  test('renames a Feature without rewriting comments or unrelated formatting', () => {
    const next = readSpecificationDocument({
      uri: 'features/checkout.feature',
      source: checkoutSource,
    }).specification
    next.name = 'Basket'

    const source = applyStructuredSpecification({
      uri: 'features/checkout.feature',
      source: checkoutSource,
      specification: next,
    })

    expect(source).toBe(
      checkoutSource.replace('Feature: Checkout', 'Feature: Basket'),
    )
    expect(source).toContain('# keep this comment')
    expect(source).toContain('  # scenario comment')
    expect(source).toContain('| card   |')
  })

  test('replaces Feature tags without rewriting comments or Scenario text', () => {
    const next = readSpecificationDocument({
      uri: 'features/checkout.feature',
      source: checkoutSource,
    }).specification
    next.tags = ['@smoke', '@checkout']

    const source = applyStructuredSpecification({
      uri: 'features/checkout.feature',
      source: checkoutSource,
      specification: next,
    })

    expect(source).toContain('# keep this comment')
    expect(source).toContain('@smoke @checkout')
    expect(source).toContain('  # scenario comment')
    expect(source).toContain('  @pay')
    expect(source).toContain('Feature: Checkout')
  })

  test('edits Scenario name, tags, and steps without rewriting comments', () => {
    const next = readSpecificationDocument({
      uri: 'features/checkout.feature',
      source: checkoutSource,
    }).specification
    const scenario = next.children[0]
    if (scenario?.kind !== 'scenario') throw new Error('expected scenario')
    scenario.name = 'Pay for the order'
    scenario.tags = ['@pay', '@checkout']
    scenario.steps[0] = { keyword: 'Given', text: 'the basket holds a product' }
    scenario.steps.push({ keyword: 'And', text: 'the customer is signed in' })

    const source = applyStructuredSpecification({
      uri: 'features/checkout.feature',
      source: checkoutSource,
      specification: next,
    })

    expect(source).toContain('# keep this comment')
    expect(source).toContain('  # scenario comment')
    expect(source).toContain('  @pay @checkout')
    expect(source).toContain('  Scenario: Pay for the order')
    expect(source).toContain('    Given the basket holds a product')
    expect(source).toContain('    Then the purchase succeeds')
    expect(source).toContain('    And the customer is signed in')
    expect(source).toContain('  Rule: Members')
  })

  test('edits Rule name and Examples data without rewriting unrelated rows', () => {
    const next = readSpecificationDocument({
      uri: 'features/checkout.feature',
      source: checkoutSource,
    }).specification
    const rule = next.children[1]
    if (rule?.kind !== 'rule') throw new Error('expected rule')
    rule.name = 'Member checkout'
    const outline = rule.children[0]
    if (outline?.kind !== 'scenario') throw new Error('expected outline')
    const examples = outline.examples[0]
    if (!examples) throw new Error('expected examples')
    examples.name = 'Tender types'
    examples.rows[0] = ['visa']
    examples.rows.push(['wallet'])

    const source = applyStructuredSpecification({
      uri: 'features/checkout.feature',
      source: checkoutSource,
      specification: next,
    })

    expect(source).toContain('  Rule: Member checkout')
    expect(source).toContain('      Examples: Tender types')
    expect(source).toContain('        | visa   |')
    expect(source).toContain('        | cash   |')
    expect(source).toContain('        | wallet |')
    expect(source).toContain('# keep this comment')
    expect(source).toContain('  Scenario: Complete a purchase')
  })
})

describe('applySpecificationSource', () => {
  test('accepts a complete Gherkin document and keeps structured views in sync', () => {
    const source = applySpecificationSource({
      uri: 'features/search.feature',
      source: `@pickle:state:active
Feature: Search
  Scenario: Query the catalog
    Then results are shown
`,
    })
    expect(source).toContain('Feature: Search')
    expect(
      readSpecificationDocument({
        uri: 'features/search.feature',
        source,
      }).specification,
    ).toMatchObject({
      name: 'Search',
      children: [
        {
          kind: 'scenario',
          name: 'Query the catalog',
          steps: [{ keyword: 'Then', text: 'results are shown' }],
        },
      ],
    })
  })

  test('rejects invalid Gherkin instead of updating the structured view', () => {
    expect(() =>
      applySpecificationSource({
        uri: 'features/search.feature',
        source: 'this is not a Feature',
      }),
    ).toThrow(/Parser errors|does not contain a Feature/)
  })
})

describe('specificationSourceDiff', () => {
  test('shows only the Gherkin lines a structured edit would write', () => {
    const next = readSpecificationDocument({
      uri: 'features/checkout.feature',
      source: checkoutSource,
    }).specification
    next.name = 'Basket'
    const proposed = applyStructuredSpecification({
      uri: 'features/checkout.feature',
      source: checkoutSource,
      specification: next,
    })
    const diff = specificationSourceDiff(checkoutSource, proposed)
    expect(diff).toContain('-Feature: Checkout')
    expect(diff).toContain('+Feature: Basket')
    expect(specificationSourceDiff(checkoutSource, checkoutSource)).toBe('')
  })
})

describe('ensureSpecificationState', () => {
  test('adds a draft state without rewriting unrelated source', () => {
    const source = `@pickle:id:specaaaaaaaaaaaa
Feature: Search
  Scenario: Query the catalog
    Then results are shown
`
    const next = ensureSpecificationState(source, 'draft')
    expect(next).toContain('@pickle:id:specaaaaaaaaaaaa')
    expect(next).toContain('@pickle:state:draft')
    expect(next).toContain('Feature: Search')
    expect(next).toContain('  Scenario: Query the catalog')
  })

  test('replaces an existing Specification state with draft', () => {
    const source = `@pickle:state:active
Feature: Search
  Scenario: Query the catalog
    Then results are shown
`
    const next = ensureSpecificationState(source, 'draft')
    expect(next).toContain('@pickle:state:draft')
    expect(next).not.toContain('@pickle:state:active')
    expect(next).toContain('Feature: Search')
  })
})

describe('applySpecificationMetadata', () => {
  test('updates Specification state, author tags, and namespaced external links', () => {
    const source = `# keep this comment
@pickle:id:specaaaaaaaaaaaa @pickle:state:active @smoke
Feature: Checkout
  Scenario: Pay
    Then payment is captured
`
    const next = applySpecificationMetadata(source, {
      state: 'draft',
      tags: ['@checkout', '@regression'],
      links: [{ namespace: 'jira', id: 'PROJ-12' }],
    })
    expect(next).toContain('# keep this comment')
    expect(next).toContain('@pickle:id:specaaaaaaaaaaaa')
    expect(next).toContain('@pickle:state:draft')
    expect(next).not.toContain('@pickle:state:active')
    expect(next).toContain('@checkout')
    expect(next).toContain('@regression')
    expect(next).not.toContain('@smoke')
    expect(next).toContain('@jira:PROJ-12')
    expect(next).toContain('Feature: Checkout')
  })
})

describe('parseExternalLinks', () => {
  test('maps namespaced tags onto external links using configured namespaces', () => {
    expect(
      parseExternalLinks(
        [
          '@pickle:id:specaaaaaaaaaaaa',
          '@pickle:state:active',
          '@smoke',
          '@jira:PROJ-12',
          '@gh:23',
        ],
        ['jira', 'gh'],
      ),
    ).toEqual([
      { namespace: 'jira', id: 'PROJ-12' },
      { namespace: 'gh', id: '23' },
    ])
  })
})
