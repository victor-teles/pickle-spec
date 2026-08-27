import { describe, expect, test } from 'bun:test'
import type { ScenarioStep } from '@pickle-spec/spec'
import { observeInstruction, promptFor } from './web-step'

const addBackpack: ScenarioStep = {
  keyword: 'When',
  text: 'I add "Sauce Labs Backpack" to the cart',
  type: 'action',
}

const badgeCount: ScenarioStep = {
  keyword: 'Then',
  text: 'the shopping cart badge should show 2 items',
  type: 'outcome',
}

describe('observeInstruction', () => {
  test('asks Stagehand to find action controls by type and label', () => {
    expect(observeInstruction(addBackpack)).toBe(
      'Find the controls, by type and visible label, needed to: ' +
        promptFor(addBackpack),
    )
  })

  test('asks Stagehand to find assertion elements without clicking', () => {
    expect(observeInstruction(badgeCount)).toBe(
      'Find the elements, by type and visible label, that confirm this ' +
        `expectation. Do not click or type. Expectation: ${promptFor(badgeCount)}`,
    )
  })
})
