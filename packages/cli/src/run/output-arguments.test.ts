import { expect, test } from 'vitest'
import { parseTestRunOutput } from './output-arguments'

test('parses a supported Test run output and preserves equals signs in its path', () => {
  expect(parseTestRunOutput('json=reports/run=ci.json')).toEqual({
    format: 'json',
    path: 'reports/run=ci.json',
  })
})

test('rejects unsupported or incomplete Test run output requests', () => {
  expect(() => parseTestRunOutput('tap=results.tap')).toThrow(
    'Unsupported output format "tap"',
  )
  expect(() => parseTestRunOutput('json=')).toThrow(
    '--output requires format=path',
  )
})
