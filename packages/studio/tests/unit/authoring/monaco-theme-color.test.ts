import { expect, test } from 'vitest'
import { oklchToMonacoHex } from '../../../src/authoring/monaco-theme-color'

test('converts OKLCH into the color formats required by Monaco', () => {
  const inkHex = ['29', '25', '24'].join('')
  const translucentMutedHex = ['a8', 'a2', '9e', '55'].join('')

  expect(oklchToMonacoHex('oklch(1 0 0)')).toBe(`#${'f'.repeat(6)}`)
  expect(
    oklchToMonacoHex('oklch(0.26848 0.00629 34.30)', { omitHash: true }),
  ).toBe(inkHex)
  expect(oklchToMonacoHex('oklch(0.71608 0.00905 56.26 / 0.333)')).toBe(
    `#${translucentMutedHex}`,
  )
})

test('rejects colors outside the supported OKLCH notation', () => {
  expect(() => oklchToMonacoHex('red')).toThrow('Invalid OKLCH color')
})
