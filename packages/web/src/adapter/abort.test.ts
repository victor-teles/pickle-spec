import { expect, test } from 'bun:test'
import { abortError, isAbortError, withAbort } from './abort'

test('withAbort returns the operation result without a signal', async () => {
  await expect(withAbort(Promise.resolve('completed'))).resolves.toBe(
    'completed',
  )
})

test('withAbort rejects before starting with an aborted signal', async () => {
  const controller = new AbortController()
  controller.abort()

  await expect(
    withAbort(Promise.resolve('completed'), controller.signal),
  ).rejects.toMatchObject({ name: 'AbortError' })
})

test('withAbort rejects when the signal aborts an active operation', async () => {
  const controller = new AbortController()
  const operation = new Promise<never>(() => {})
  const result = withAbort(operation, controller.signal)

  controller.abort()

  await expect(result).rejects.toMatchObject({ name: 'AbortError' })
})

test('isAbortError recognizes cancellation from the signal or error', () => {
  const controller = new AbortController()
  controller.abort()

  expect(isAbortError(new Error('failed'), controller.signal)).toBe(true)
  expect(isAbortError(abortError())).toBe(true)
  expect(isAbortError(new Error('failed'))).toBe(false)
})
