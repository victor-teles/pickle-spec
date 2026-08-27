import { expect, test } from 'bun:test'
import { resolveEvidencePersistence } from './evidence-persistence'

test('keeps captured artifacts after a passing stock run', () => {
  expect(resolveEvidencePersistence({})).toBe('always')
})

test('lets an explicit persistence policy win', () => {
  expect(
    resolveEvidencePersistence({
      argument: 'off',
      configured: 'always',
      artifactsCapture: 'always',
    }),
  ).toBe('off')
  expect(
    resolveEvidencePersistence({
      configured: 'on-failure',
      artifactsCapture: 'always',
    }),
  ).toBe('on-failure')
  expect(resolveEvidencePersistence({ artifactsCapture: 'on-failure' })).toBe(
    'on-failure',
  )
})
