import { describe, expect, test } from 'vitest'
import {
  observedSelectorNeedsStabilizing,
  stabilizeSelector,
  stableSelectorFor,
  xpathValue,
} from './stable-selector'

describe('stableSelectorFor', () => {
  test('prefers an id over data-test and name', () => {
    expect(
      stableSelectorFor({
        id: 'user-name',
        tagName: 'INPUT',
        dataTest: 'username',
        dataTestId: null,
        name: 'user-name',
      }),
    ).toBe('#user-name')
  })

  test('uses data-test when the node has no id', () => {
    expect(
      stableSelectorFor({
        id: '',
        tagName: 'INPUT',
        dataTest: 'username',
        dataTestId: null,
        name: 'user-name',
      }),
    ).toBe('[data-test="username"]')
  })
})

describe('observedSelectorNeedsStabilizing', () => {
  test('detects Stagehand absolute xpaths', () => {
    expect(
      observedSelectorNeedsStabilizing(
        'xpath=/html[1]/body[1]/div[1]/form[1]/input[1]',
      ),
    ).toBe(true)
    expect(observedSelectorNeedsStabilizing('#user-name')).toBe(false)
  })

  test('strips the xpath= prefix', () => {
    expect(xpathValue('xpath=/html[1]/body[1]')).toBe('/html[1]/body[1]')
  })
})

describe('stabilizeSelector', () => {
  test('rewrites a SauceDemo xpath to the element id', async () => {
    const page = {
      async evaluate() {
        return '#user-name'
      },
    }
    expect(
      await stabilizeSelector(
        page,
        'xpath=/html[1]/body[1]/div[1]/div[1]/div[2]/div[1]/div[1]/div[1]/form[1]/div[1]/input[1]',
      ),
    ).toBe('#user-name')
  })

  test('keeps CSS selectors unchanged', async () => {
    const page = {
      async evaluate() {
        throw new Error('must not evaluate CSS selectors')
      },
    }
    expect(await stabilizeSelector(page, '#user-name')).toBe('#user-name')
  })
})
