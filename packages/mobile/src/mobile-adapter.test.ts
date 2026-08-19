import { expect, mock, test } from 'bun:test'
import { createMobileAdapter } from '../index'
import type { MobileWorkerClient } from './worker-client'
import type {
  MobileWorkerRequest,
  MobileWorkerResponse,
} from './worker-protocol'

const specification = {
  name: 'Checkout',
  source: { uri: 'features/checkout.feature', language: 'en' },
  tags: [],
  scenarios: [],
}

const scenario = {
  name: 'Buy a product',
  tags: [],
  steps: [{ keyword: 'When', text: 'I pay', type: 'action' as const }],
}

function workerClient(
  overrides: Partial<MobileWorkerClient> = {},
): MobileWorkerClient {
  return {
    async request() {
      throw new Error('Unexpected worker request')
    },
    async dispose() {},
    ...overrides,
  }
}

test('discovers Android Emulator targets without exposing worker or vendor types', async () => {
  const request = mock(async () => ({
    version: 1 as const,
    type: 'targets-discovered' as const,
    targets: [
      {
        id: 'emulator-5554',
        name: 'Pixel 9 API 35',
        state: 'booted' as const,
        capabilities: ['android', 'screenshots', 'device-logs'],
      },
    ],
  }))
  const adapter = createMobileAdapter(
    {
      application: {
        id: 'com.example.checkout',
        binaryPath: '/tmp/checkout.apk',
      },
    },
    () => workerClient({ request }),
  )

  expect(adapter.capabilities).toEqual([
    'android',
    'android-emulator',
    'screenshots',
  ])
  expect(await adapter.discoverTargets()).toEqual([
    {
      id: 'emulator-5554',
      name: 'Pixel 9 API 35',
      state: 'booted',
      capabilities: ['android', 'screenshots', 'device-logs'],
    },
  ])
  expect(request).toHaveBeenCalledWith({
    version: 1,
    type: 'discover-targets',
  })
})

test('opens and closes one isolated Android logical session through the worker', async () => {
  const requests: MobileWorkerRequest[] = []
  const request: MobileWorkerClient['request'] = mock(async (message) => {
    requests.push(message)
    if (message.type === 'open-session') {
      return {
        version: 1 as const,
        type: 'session-opened' as const,
        sessionId: message.sessionId,
        targetId: 'emulator-5554',
      }
    }
    if (message.type === 'close-session') {
      return {
        version: 1 as const,
        type: 'session-closed' as const,
        sessionId: message.sessionId,
      }
    }
    throw new Error(`Unexpected request ${message.type}`)
  })
  const adapter = createMobileAdapter(
    {
      application: {
        id: 'com.example.checkout',
        binaryPath: '/tmp/checkout.apk',
      },
      targetId: 'emulator-5554',
    },
    () => workerClient({ request }),
  )

  const session = await adapter.openSession({
    executionTargetProfile: { id: 'android' },
    specification,
    scenario,
    mode: 'adaptive',
  })
  await session.close()
  await session.close()

  expect(requests).toHaveLength(2)
  expect(requests[0]).toMatchObject({
    version: 1,
    type: 'open-session',
    targetId: 'emulator-5554',
    application: {
      id: 'com.example.checkout',
      binaryPath: '/tmp/checkout.apk',
    },
    mode: 'adaptive',
  })
  expect(requests[1]).toMatchObject({
    version: 1,
    type: 'close-session',
  })
})

test('executes mobile steps and returns common runner actions and artifacts', async () => {
  const requests: MobileWorkerRequest[] = []
  const request: MobileWorkerClient['request'] = mock(async (message) => {
    requests.push(message)
    if (message.type === 'open-session') {
      return {
        version: 1 as const,
        type: 'session-opened' as const,
        sessionId: message.sessionId,
        targetId: 'emulator-5554',
      }
    }
    if (message.type === 'execute-step') {
      return {
        version: 1 as const,
        type: 'step-executed' as const,
        sessionId: message.sessionId,
        execution: {
          state: 'passed' as const,
          resolvedActions: [
            {
              description: 'Tap: I pay',
              replay: { kind: 'find', query: 'I pay', action: 'click' },
            },
          ],
          artifacts: [
            {
              kind: 'screenshot' as const,
              path: '/tmp/artifacts/step-01.png',
              mediaType: 'image/png',
            },
          ],
        },
      }
    }
    if (message.type === 'close-session') {
      return {
        version: 1 as const,
        type: 'session-closed' as const,
        sessionId: message.sessionId,
      }
    }
    throw new Error(`Unexpected request ${message.type}`)
  })
  const adapter = createMobileAdapter(
    {
      application: {
        id: 'com.example.checkout',
        binaryPath: '/tmp/checkout.apk',
      },
      artifactDirectory: '/tmp/artifacts',
    },
    () => workerClient({ request }),
  )
  const session = await adapter.openSession({
    executionTargetProfile: { id: 'android' },
    specification,
    scenario,
  })

  await expect(session.executeStep(scenario.steps[0]!)).resolves.toEqual({
    state: 'passed',
    resolvedActions: [
      {
        description: 'Tap: I pay',
        replay: { kind: 'find', query: 'I pay', action: 'click' },
      },
    ],
    artifacts: [
      {
        kind: 'screenshot',
        path: '/tmp/artifacts/step-01.png',
        mediaType: 'image/png',
      },
    ],
  })
  expect(requests[1]).toMatchObject({
    version: 1,
    type: 'execute-step',
    stepIndex: 0,
    step: { type: 'action', text: 'I pay' },
  })
})

test('cancels the worker session on abort and disposes the worker before reuse', async () => {
  const requests: MobileWorkerRequest[] = []
  let disposed = false
  const request: MobileWorkerClient['request'] = mock(async (message) => {
    requests.push(message)
    if (message.type === 'open-session') {
      return {
        version: 1 as const,
        type: 'session-opened' as const,
        sessionId: message.sessionId,
        targetId: 'emulator-5554',
      }
    }
    if (message.type === 'cancel-session') {
      return {
        version: 1 as const,
        type: 'session-cancelled' as const,
        sessionId: message.sessionId,
      }
    }
    throw new Error(`Unexpected request ${message.type}`)
  })
  const controller = new AbortController()
  const adapter = createMobileAdapter(
    {
      application: {
        id: 'com.example.checkout',
        binaryPath: '/tmp/checkout.apk',
      },
    },
    () =>
      workerClient({
        request,
        async dispose() {
          disposed = true
        },
      }),
  )
  const session = await adapter.openSession({
    executionTargetProfile: { id: 'android' },
    specification,
    scenario,
    signal: controller.signal,
  })

  controller.abort()
  await session.close()
  await adapter.dispose?.()

  expect(requests.map((message) => message.type)).toEqual([
    'open-session',
    'cancel-session',
  ])
  expect(disposed).toBe(true)
})

test('cancels installation when abort occurs while the logical session opens', async () => {
  const requests: MobileWorkerRequest[] = []
  const request: MobileWorkerClient['request'] = mock(
    async (message, signal): Promise<MobileWorkerResponse> => {
      requests.push(message)
      if (message.type === 'open-session') {
        return new Promise((_, reject) => {
          signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          )
        })
      }
      if (message.type === 'cancel-session') {
        return {
          version: 1,
          type: 'session-cancelled',
          sessionId: message.sessionId,
        }
      }
      throw new Error(`Unexpected request ${message.type}`)
    },
  )
  const controller = new AbortController()
  const adapter = createMobileAdapter(
    {
      application: {
        id: 'com.example.checkout',
        binaryPath: '/tmp/checkout.apk',
      },
    },
    () => workerClient({ request }),
  )

  const opening = adapter.openSession({
    executionTargetProfile: { id: 'android' },
    specification,
    scenario,
    signal: controller.signal,
  })
  controller.abort()

  await expect(opening).rejects.toThrow('Aborted')
  expect(requests.map((message) => message.type)).toEqual([
    'open-session',
    'cancel-session',
  ])
})
