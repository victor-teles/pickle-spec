import { expect, test } from 'bun:test'
import {
  assertSupportedNodeVersion,
  createNodeWorkerClient,
} from './worker-client'

test('launches the versioned worker protocol explicitly through Node', async () => {
  const client = createNodeWorkerClient({
    workerEntry: new URL('../test/echo-worker.mjs', import.meta.url),
  })

  try {
    expect(
      await client.request({ version: 2, type: 'discover-targets' }),
    ).toEqual({
      version: 2,
      type: 'targets-discovered',
      targets: [],
    })
  } finally {
    await client.dispose()
  }
})

test('rejects Node runtimes older than 22.12', () => {
  expect(() => assertSupportedNodeVersion('22.11.0')).toThrow(
    'The mobile worker requires Node 22.12 or newer; found 22.11.0',
  )
  expect(() => assertSupportedNodeVersion('22.12.0')).not.toThrow()
  expect(() => assertSupportedNodeVersion('24.0.0')).not.toThrow()
})

test('rejects a request when disposal interrupts worker startup', async () => {
  const client = createNodeWorkerClient({
    workerEntry: new URL('../test/slow-worker.mjs', import.meta.url),
  })
  const request = client.request({ version: 2, type: 'discover-targets' })
  const rejection = request.catch((error: unknown) => error)
  await new Promise((resolve) => setTimeout(resolve, 10))

  await client.dispose()

  expect(await rejection).toEqual(
    expect.objectContaining({ message: 'The mobile worker was disposed' }),
  )
})
