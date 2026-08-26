import { expect, mock, test } from 'bun:test'
import { createMobileAdapter } from '../../index'
import { mobileReplayVariableName } from '../execution-cache/mobile-execution-cache'
import type { MobileWorkerClient } from '../worker/worker-client'
import type {
  MobileWorkerRequest,
  MobileWorkerResponse,
} from '../worker/worker-protocol'

const specification = {
  name: 'Checkout',
  source: { uri: 'features/checkout.feature', language: 'en' },
  tags: [],
  scenarios: [],
}

const scenario = {
  name: 'Buy a product',
  tags: [],
  steps: [
    { keyword: 'When', text: 'Buy Pickles', type: 'action' as const },
    { keyword: 'Then', text: 'Receipt', type: 'outcome' as const },
  ],
  template: {
    name: 'Buy a product',
    variableNames: ['product'],
    steps: [
      { keyword: 'When', text: 'Buy <product>', type: 'action' as const },
      { keyword: 'Then', text: 'Receipt', type: 'outcome' as const },
    ],
  },
  runtimeBindings: [{ name: 'product', value: 'Pickles' }],
}

const application = {
  id: 'com.example.checkout',
  binaryPath: '/tmp/checkout.apk',
}
const productPlaceholder = [
  '$',
  `{${mobileReplayVariableName('product')}}`,
].join('')

function workerClient(
  request: MobileWorkerClient['request'],
  dispose: MobileWorkerClient['dispose'] = async () => {},
): MobileWorkerClient {
  return { request, dispose }
}

function successfulWorker(
  requestLog: MobileWorkerRequest[],
): MobileWorkerClient {
  return workerClient(async (request) => {
    requestLog.push(request)
    switch (request.type) {
      case 'discover-targets':
        return {
          version: 3,
          type: 'targets-discovered',
          targets: [
            {
              id: 'emulator-5554',
              name: 'Pixel 9',
              state: 'booted',
              capabilities: ['android', 'android-emulator'],
            },
          ],
        }
      case 'open-session':
        return {
          version: 3,
          type: 'session-opened',
          sessionId: request.sessionId,
          targetId: 'emulator-5554',
        }
      case 'execute-scenario':
        return {
          version: 3,
          type: 'scenario-executed',
          sessionId: request.sessionId,
          execution: {
            stepExecutions: scenario.steps.map((step) => ({
              state: 'passed',
              resolvedActions: [{ description: step.text }],
            })),
          },
        }
      case 'complete-session':
        return {
          version: 3,
          type: 'session-completed',
          sessionId: request.sessionId,
          completion: { inferenceCount: 0 },
        }
      case 'close-session':
        return {
          version: 3,
          type: 'session-closed',
          sessionId: request.sessionId,
        }
      case 'cancel-session':
        return {
          version: 3,
          type: 'session-cancelled',
          sessionId: request.sessionId,
        }
    }
  })
}

test('exposes mobile targets and deterministic cache identity', async () => {
  const requests: MobileWorkerRequest[] = []
  const adapter = createMobileAdapter({ application }, () =>
    successfulWorker(requests),
  )

  await expect(adapter.discoverTargets()).resolves.toMatchObject([
    { id: 'emulator-5554', state: 'booted' },
  ])
  expect(adapter.executionCache).toMatchObject({
    adapterKind: 'mobile.agent-device',
    adapterCacheSchemaVersion: 'agent-device-ad.1+0.20.10',
  })
  expect(requests[0]).toEqual({
    version: 3,
    type: 'discover-targets',
    platform: 'android',
  })
})

test('runs one complete Scenario and completes it through the worker', async () => {
  const requests: MobileWorkerRequest[] = []
  const adapter = createMobileAdapter(
    { application, targetId: 'emulator-5554' },
    () => successfulWorker(requests),
  )
  const session = await adapter.openSession({
    executionTargetProfile: { id: 'android' },
    specification,
    scenario,
    scenarioTemplate: scenario.template,
    runtimeBindings: scenario.runtimeBindings,
    mode: 'adaptive',
  })

  await expect(session.executeScenario()).resolves.toMatchObject({
    stepExecutions: [{ state: 'passed' }, { state: 'passed' }],
  })
  await expect(session.complete?.()).resolves.toEqual({ inferenceCount: 0 })
  await session.close()
  await session.close()

  expect(requests.map((request) => request.type)).toEqual([
    'open-session',
    'execute-scenario',
    'complete-session',
    'close-session',
  ])
  expect(requests[0]).toMatchObject({
    version: 3,
    type: 'open-session',
    mode: 'adaptive',
    scenario: {
      steps: [
        { type: 'action', text: 'Buy Pickles' },
        { type: 'outcome', text: 'Receipt' },
      ],
      templateSteps: [
        { type: 'action', text: 'Buy <product>' },
        { type: 'outcome', text: 'Receipt' },
      ],
      runtimeBindings: [{ name: 'product', value: 'Pickles' }],
    },
  })
})

test('passes only a validated complete .ad payload into Replay', async () => {
  const requests: MobileWorkerRequest[] = []
  const adapter = createMobileAdapter({ application }, () =>
    successfulWorker(requests),
  )
  const payload = {
    format: 'agent-device-ad' as const,
    script:
      'context platform=android\n' +
      'open "com.example.checkout" --relaunch\n' +
      `find "Buy ${productPlaceholder}" click\n` +
      'is visible "text=\\"Receipt\\""\n',
    stepRanges: [
      { from: 2, to: 2 },
      { from: 3, to: 3 },
    ],
  }

  const session = await adapter.openSession({
    executionTargetProfile: { id: 'android' },
    specification,
    scenario,
    mode: 'replay',
    scenarioTemplate: scenario.template,
    runtimeBindings: scenario.runtimeBindings,
    executionCache: {
      adapterPayload: payload,
      requiredVariables: ['product'],
    },
  })
  await session.close()

  expect(requests[0]).toMatchObject({
    type: 'open-session',
    executionCache: {
      adapterPayload: payload,
      requiredVariables: ['product'],
    },
  })
})

test('cancels the worker session when the run is aborted', async () => {
  const requests: MobileWorkerRequest[] = []
  let disposed = false
  const controller = new AbortController()
  const base = successfulWorker(requests)
  const adapter = createMobileAdapter({ application }, () =>
    workerClient(base.request, async () => {
      disposed = true
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

  expect(requests.map((request) => request.type)).toEqual([
    'open-session',
    'cancel-session',
  ])
  expect(disposed).toBe(true)
})

test('cancels installation when abort occurs while opening', async () => {
  const requests: MobileWorkerRequest[] = []
  const request = mock(
    async (
      message: MobileWorkerRequest,
      signal?: AbortSignal,
    ): Promise<MobileWorkerResponse> => {
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
          version: 3,
          type: 'session-cancelled',
          sessionId: message.sessionId,
        }
      }
      throw new Error(`Unexpected request ${message.type}`)
    },
  )
  const controller = new AbortController()
  const adapter = createMobileAdapter({ application }, () =>
    workerClient(request),
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
