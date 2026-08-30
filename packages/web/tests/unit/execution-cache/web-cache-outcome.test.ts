import { describe, expect, test } from 'vitest'
import { compileObservedOutcomes } from '../../../src/execution-cache/web-cache-outcome'

const backpack = {
  description: 'Sauce Labs Backpack cart item',
  handle: { selector: '.cart_item:has-text("Sauce Labs Backpack")' },
}
const bikeLight = {
  description: 'Sauce Labs Bike Light cart item',
  handle: { selector: '.cart_item:has-text("Sauce Labs Bike Light")' },
}
const badge = {
  description: 'Shopping cart badge',
  handle: { selector: '.shopping_cart_badge' },
}
const productsHeading = {
  description: 'Products page heading',
  handle: { selector: '.title' },
}

describe('compileObservedOutcomes', () => {
  test('compiles a cart badge count from the Gherkin expectation', () => {
    expect(
      compileObservedOutcomes(
        [badge],
        'the shopping cart badge should show 2 items',
        [],
      ),
    ).toEqual([
      {
        kind: 'text-contains',
        locator: {
          selector: { segments: [{ literal: '.shopping_cart_badge' }] },
        },
        expected: { segments: [{ literal: '2' }] },
      },
    ])
  })

  test('compiles one text assertion per quoted cart item', () => {
    expect(
      compileObservedOutcomes(
        [backpack, bikeLight],
        'the cart should contain "Sauce Labs Backpack" and "Sauce Labs Bike Light"',
        [],
      ),
    ).toEqual([
      {
        kind: 'text-contains',
        locator: {
          selector: {
            segments: [
              { literal: '.cart_item:has-text("Sauce Labs Backpack")' },
            ],
          },
        },
        expected: { segments: [{ literal: 'Sauce Labs Backpack' }] },
      },
      {
        kind: 'text-contains',
        locator: {
          selector: {
            segments: [
              { literal: '.cart_item:has-text("Sauce Labs Bike Light")' },
            ],
          },
        },
        expected: { segments: [{ literal: 'Sauce Labs Bike Light' }] },
      },
    ])
  })

  test('does not compile a compound Then from a single observed element', () => {
    expect(
      compileObservedOutcomes(
        [backpack],
        'the cart should contain "Sauce Labs Backpack" and "Sauce Labs Bike Light"',
        [],
      ),
    ).toBeUndefined()
  })

  test('compiles visibility for quoted field names, not inner text', () => {
    expect(
      compileObservedOutcomes(
        [
          {
            description: 'Username input field',
            handle: { selector: '#user-name' },
          },
          {
            description: 'Password input field',
            handle: { selector: '#password' },
          },
        ],
        'the "Username" and "Password" fields should remain visible',
        [],
      ),
    ).toEqual([
      {
        kind: 'visible',
        locator: { selector: { segments: [{ literal: '#user-name' }] } },
      },
      {
        kind: 'visible',
        locator: { selector: { segments: [{ literal: '#password' }] } },
      },
    ])
  })

  test('compiles visibility for a page heading', () => {
    expect(
      compileObservedOutcomes(
        [productsHeading],
        'the "Products" page should be visible',
        [],
      ),
    ).toEqual([
      {
        kind: 'text-contains',
        locator: { selector: { segments: [{ literal: '.title' }] } },
        expected: { segments: [{ literal: 'Products' }] },
      },
    ])
  })
})
