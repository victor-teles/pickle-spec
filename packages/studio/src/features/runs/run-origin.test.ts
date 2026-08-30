import { expect, test } from 'vitest'
import { isBusyOrigin, runOriginFromRequest } from './run-origin'

test('derives the origin from the run request', () => {
  expect(runOriginFromRequest({ scenarioId: 'pay' })).toEqual({
    kind: 'scenario',
    scenarioId: 'pay',
  })
  expect(runOriginFromRequest({ refreshCache: true })).toEqual({
    kind: 'refresh',
  })
  expect(runOriginFromRequest({})).toEqual({ kind: 'all' })
  expect(
    runOriginFromRequest({ paths: ['features/checkout.feature'] }),
  ).toEqual({ kind: 'specification' })
})

test('marks only the matching run control as busy', () => {
  expect(
    isBusyOrigin({ kind: 'specification' }, { kind: 'specification' }),
  ).toBe(true)
  expect(isBusyOrigin({ kind: 'specification' }, { kind: 'all' })).toBe(false)
  expect(
    isBusyOrigin(
      { kind: 'scenario', scenarioId: 'pay' },
      { kind: 'scenario', scenarioId: 'pay' },
    ),
  ).toBe(true)
  expect(
    isBusyOrigin(
      { kind: 'scenario', scenarioId: 'pay' },
      { kind: 'scenario', scenarioId: 'review' },
    ),
  ).toBe(false)
  expect(isBusyOrigin(undefined, { kind: 'specification' })).toBe(false)
})
