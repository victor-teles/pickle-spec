import { describe, expect, test } from 'vitest'
import { catalogFromSource, gherkinCompletions } from './gherkin-language'

const checkout = `# keep this comment
@pickle:id:speccheckaaaaaaaa @pickle:state:active
Feature: Checkout
  @pickle:id:scnpaybbbbbbbbbb
  Scenario: Pay for the order
    Then payment is captured
`

describe('gherkinCompletions', () => {
  test('suggests Gherkin keywords and Specification state tags', () => {
    const labels = gherkinCompletions({ line: '' }).map((item) => item.label)
    expect(labels).toContain('Feature')
    expect(labels).toContain('Scenario Outline')
    expect(labels).toContain('Given')
    expect(labels).toContain('@pickle:state:draft')
  })

  test('filters by the token at the caret and includes catalog steps', () => {
    const items = gherkinCompletions({
      line: '    Gi',
      catalog: {
        tags: ['@smoke'],
        steps: ['Given a product is in the basket'],
      },
    })
    expect(items.map((item) => item.label)).toEqual([
      'Given',
      'Given a product is in the basket',
    ])
  })
})

describe('catalogFromSource', () => {
  test('collects tags and steps from a Gherkin document', () => {
    expect(catalogFromSource(checkout)).toEqual({
      tags: [
        '@pickle:id:scnpaybbbbbbbbbb',
        '@pickle:id:speccheckaaaaaaaa',
        '@pickle:state:active',
      ],
      steps: ['Then payment is captured'],
    })
  })
})
