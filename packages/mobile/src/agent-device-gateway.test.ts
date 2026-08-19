import { expect, mock, test } from 'bun:test'
import {
  type AgentDeviceClientPort,
  AgentDeviceGateway,
} from './agent-device-gateway'

function fakeClient(
  overrides: Partial<AgentDeviceClientPort> = {},
): AgentDeviceClientPort {
  return {
    devices: {
      async list() {
        return []
      },
      async capabilities() {
        throw new Error('Unexpected capabilities request')
      },
    },
    apps: {
      async reinstall() {},
      async open() {},
    },
    command: {
      async appState() {
        return { platform: 'android', package: '', activity: '' }
      },
      async wait() {},
    },
    interactions: {
      async find() {},
    },
    capture: {
      async screenshot(options) {
        return { path: options.path ?? '' }
      },
    },
    sessions: {
      async close() {},
    },
    ...overrides,
  }
}

test('discovers compatible Android Emulator targets and normalizes capabilities', async () => {
  const close = mock(async () => {})
  const client = fakeClient({
    devices: {
      async list() {
        return [
          {
            platform: 'android',
            target: 'mobile',
            kind: 'emulator',
            id: 'emulator-5554',
            name: 'Pixel 9 API 35',
            booted: true,
            identifiers: {},
            android: { serial: 'emulator-5554' },
          },
          {
            platform: 'android',
            target: 'mobile',
            kind: 'device',
            id: 'physical-1',
            name: 'Physical phone',
            booted: true,
            identifiers: {},
            android: { serial: 'physical-1' },
          },
        ]
      },
      async capabilities() {
        return {
          device: {
            platform: 'android',
            target: 'mobile',
            kind: 'emulator',
            id: 'emulator-5554',
            name: 'Pixel 9 API 35',
            booted: true,
            identifiers: {},
            android: { serial: 'emulator-5554' },
          },
          availableCommands: ['snapshot', 'screenshot', 'logs', 'find'],
        }
      },
    },
    sessions: { close },
  })
  const gateway = new AgentDeviceGateway(() => client)

  expect(await gateway.discoverTargets()).toEqual([
    {
      id: 'emulator-5554',
      name: 'Pixel 9 API 35',
      state: 'booted',
      capabilities: [
        'android',
        'android-emulator',
        'screenshots',
        'device-logs',
      ],
    },
  ])
  expect(close).toHaveBeenCalledTimes(1)
})

test('reinstalls, opens, and verifies the configured application for a logical session', async () => {
  const reinstall = mock(async () => {})
  const open = mock(async () => {})
  const appState = mock(async () => ({
    platform: 'android' as const,
    package: 'com.example.checkout',
    activity: '.MainActivity',
  }))
  const client = fakeClient({
    devices: {
      async list() {
        return [
          {
            platform: 'android',
            target: 'mobile',
            kind: 'emulator',
            id: 'emulator-5554',
            name: 'Pixel 9 API 35',
            booted: true,
            identifiers: {},
            android: { serial: 'emulator-5554' },
          },
        ]
      },
      async capabilities() {
        throw new Error('Unexpected capabilities request')
      },
    },
    apps: { reinstall, open },
    command: { appState, async wait() {} },
  })
  const gateway = new AgentDeviceGateway(() => client)

  await expect(
    gateway.openSession({
      sessionId: 'session-1',
      targetId: 'emulator-5554',
      application: {
        id: 'com.example.checkout',
        binaryPath: '/tmp/checkout.apk',
      },
    }),
  ).resolves.toEqual({ targetId: 'emulator-5554' })
  expect(reinstall).toHaveBeenCalledWith({
    app: 'com.example.checkout',
    appPath: '/tmp/checkout.apk',
    platform: 'android',
    serial: 'emulator-5554',
  })
  expect(open).toHaveBeenCalledWith({
    app: 'com.example.checkout',
    platform: 'android',
    serial: 'emulator-5554',
  })
  expect(appState).toHaveBeenCalledWith({
    platform: 'android',
    serial: 'emulator-5554',
  })
})

test('cancels a logical session while Android target discovery is in flight', async () => {
  let resolveDevices: (devices: unknown[]) => void = () => {}
  const devices = new Promise<unknown[]>((resolve) => {
    resolveDevices = resolve
  })
  const reinstall = mock(async () => {})
  const close = mock(async () => {})
  const client = fakeClient({
    devices: {
      async list() {
        return devices
      },
      async capabilities() {
        throw new Error('Unexpected capabilities request')
      },
    },
    apps: { reinstall, async open() {} },
    sessions: { close },
  })
  const gateway = new AgentDeviceGateway(() => client)
  const opening = gateway.openSession({
    sessionId: 'session-1',
    application: {
      id: 'com.example.checkout',
      binaryPath: '/tmp/checkout.apk',
    },
  })

  await gateway.cancelSession('session-1')
  resolveDevices([
    {
      platform: 'android',
      target: 'mobile',
      kind: 'emulator',
      id: 'emulator-5554',
      name: 'Pixel 9 API 35',
      booted: true,
      identifiers: {},
      android: { serial: 'emulator-5554' },
    },
  ])

  await expect(opening).rejects.toThrow('Aborted')
  expect(reinstall).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledTimes(1)
})

test('normalizes Adaptive actions and screenshot artifacts without vendor results', async () => {
  const find = mock(async () => ({ ref: '@e4', message: 'clicked' }))
  const screenshot = mock(async (options: { path?: string }) => ({
    path: options.path ?? '',
  }))
  const client = fakeClient({
    devices: {
      async list() {
        return [
          {
            platform: 'android',
            target: 'mobile',
            kind: 'emulator',
            id: 'emulator-5554',
            name: 'Pixel 9 API 35',
            booted: true,
            identifiers: {},
            android: { serial: 'emulator-5554' },
          },
        ]
      },
      async capabilities() {
        throw new Error('Unexpected capabilities request')
      },
    },
    apps: { async reinstall() {}, async open() {} },
    command: {
      async appState() {
        return {
          platform: 'android',
          package: 'com.example.checkout',
          activity: '.MainActivity',
        }
      },
      async wait() {},
    },
    interactions: { find },
    capture: { screenshot },
  })
  const gateway = new AgentDeviceGateway(() => client)
  await gateway.openSession({
    sessionId: 'session-1',
    targetId: 'emulator-5554',
    application: {
      id: 'com.example.checkout',
      binaryPath: '/tmp/checkout.apk',
    },
    artifactDirectory: '/tmp/pickle-mobile-artifacts',
  })

  const execution = await gateway.executeStep({
    sessionId: 'session-1',
    stepIndex: 0,
    step: { type: 'action', text: 'Pay now' },
  })

  expect(execution).toEqual({
    state: 'passed',
    resolvedActions: [
      {
        description: 'Tap: Pay now',
        replay: { kind: 'find', query: 'Pay now', action: 'click' },
      },
    ],
    artifacts: [
      {
        kind: 'screenshot',
        path: '/tmp/pickle-mobile-artifacts/session-1/step-01.png',
        mediaType: 'image/png',
      },
    ],
  })
  expect(find).toHaveBeenCalledWith({
    platform: 'android',
    serial: 'emulator-5554',
    query: 'Pay now',
    action: 'click',
  })
  expect(screenshot).toHaveBeenCalledWith({
    path: '/tmp/pickle-mobile-artifacts/session-1/step-01.png',
  })
})

test('replays normalized actions and adapts when a replay action is unavailable', async () => {
  const find = mock(async (_options: unknown) => {})
  const client = fakeClient({
    devices: {
      async list() {
        return [
          {
            platform: 'android',
            target: 'mobile',
            kind: 'emulator',
            id: 'emulator-5554',
            name: 'Pixel 9 API 35',
            booted: true,
            identifiers: {},
            android: { serial: 'emulator-5554' },
          },
        ]
      },
      async capabilities() {
        throw new Error('Unexpected capabilities request')
      },
    },
    apps: { async reinstall() {}, async open() {} },
    command: {
      async appState() {
        return {
          platform: 'android',
          package: 'com.example.checkout',
          activity: '.MainActivity',
        }
      },
      async wait() {},
    },
    interactions: { find },
  })
  const gateway = new AgentDeviceGateway(() => client)
  await gateway.openSession({
    sessionId: 'session-1',
    application: {
      id: 'com.example.checkout',
      binaryPath: '/tmp/checkout.apk',
    },
    artifactDirectory: '/tmp/pickle-mobile-artifacts',
  })

  const replayed = await gateway.executeStep({
    sessionId: 'session-1',
    stepIndex: 0,
    step: { type: 'action', text: 'Pay now' },
    plannedActions: [
      {
        description: 'Tap: Saved pay button',
        replay: { kind: 'find', query: 'Saved pay button', action: 'click' },
      },
    ],
  })
  const adapted = await gateway.executeStep({
    sessionId: 'session-1',
    stepIndex: 1,
    step: { type: 'action', text: 'Confirm order' },
    plannedActions: [],
  })

  expect(replayed).toMatchObject({
    state: 'passed',
    resolvedActions: [{ description: 'Tap: Saved pay button' }],
  })
  expect(adapted).toMatchObject({
    state: 'passed-with-adaptation',
    resolvedActions: [{ description: 'Tap: Confirm order' }],
  })
  expect(find.mock.calls.map((call) => call[0])).toEqual([
    {
      platform: 'android',
      serial: 'emulator-5554',
      query: 'Saved pay button',
      action: 'click',
    },
    {
      platform: 'android',
      serial: 'emulator-5554',
      query: 'Confirm order',
      action: 'click',
    },
  ])
})

test('classifies unexpected worker and device errors as infrastructure errors', async () => {
  const client = fakeClient({
    devices: {
      async list() {
        return [
          {
            platform: 'android',
            target: 'mobile',
            kind: 'emulator',
            id: 'emulator-5554',
            name: 'Pixel 9 API 35',
            booted: true,
            identifiers: {},
            android: { serial: 'emulator-5554' },
          },
        ]
      },
      async capabilities() {
        throw new Error('Unexpected capabilities request')
      },
    },
    apps: { async reinstall() {}, async open() {} },
    command: {
      async appState() {
        return {
          platform: 'android',
          package: 'com.example.checkout',
          activity: '.MainActivity',
        }
      },
      async wait() {},
    },
    interactions: {
      async find() {
        throw new Error('ADB disconnected')
      },
    },
  })
  const gateway = new AgentDeviceGateway(() => client)
  await gateway.openSession({
    sessionId: 'session-1',
    application: {
      id: 'com.example.checkout',
      binaryPath: '/tmp/checkout.apk',
    },
  })

  await expect(
    gateway.executeStep({
      sessionId: 'session-1',
      stepIndex: 0,
      step: { type: 'action', text: 'Pay now' },
    }),
  ).resolves.toEqual({
    state: 'infrastructure-error',
    resolvedActions: [],
    message: 'ADB disconnected',
  })
})

test('reports requested screenshot capture failures as infrastructure errors', async () => {
  const client = fakeClient({
    devices: {
      async list() {
        return [
          {
            platform: 'android',
            target: 'mobile',
            kind: 'emulator',
            id: 'emulator-5554',
            name: 'Pixel 9 API 35',
            booted: true,
            identifiers: {},
            android: { serial: 'emulator-5554' },
          },
        ]
      },
      async capabilities() {
        throw new Error('Unexpected capabilities request')
      },
    },
    apps: { async reinstall() {}, async open() {} },
    command: {
      async appState() {
        return {
          platform: 'android',
          package: 'com.example.checkout',
          activity: '.MainActivity',
        }
      },
      async wait() {},
    },
    interactions: { async find() {} },
    capture: {
      async screenshot() {
        throw new Error('Screenshot helper is unavailable')
      },
    },
  })
  const gateway = new AgentDeviceGateway(() => client)
  await gateway.openSession({
    sessionId: 'session-1',
    application: {
      id: 'com.example.checkout',
      binaryPath: '/tmp/checkout.apk',
    },
    artifactDirectory: '/tmp/pickle-mobile-artifacts',
  })

  await expect(
    gateway.executeStep({
      sessionId: 'session-1',
      stepIndex: 0,
      step: { type: 'action', text: 'Pay now' },
    }),
  ).resolves.toMatchObject({
    state: 'infrastructure-error',
    message: 'Screenshot capture failed: Screenshot helper is unavailable',
  })
})

test('retains session ownership when close fails so disposal can retry', async () => {
  let closeAttempts = 0
  const close = mock(async () => {
    closeAttempts++
    if (closeAttempts === 1) throw new Error('Close failed')
  })
  const client = fakeClient({
    devices: {
      async list() {
        return [
          {
            platform: 'android',
            target: 'mobile',
            kind: 'emulator',
            id: 'emulator-5554',
            name: 'Pixel 9 API 35',
            booted: true,
            identifiers: {},
            android: { serial: 'emulator-5554' },
          },
        ]
      },
      async capabilities() {
        throw new Error('Unexpected capabilities request')
      },
    },
    apps: { async reinstall() {}, async open() {} },
    command: {
      async appState() {
        return {
          platform: 'android',
          package: 'com.example.checkout',
          activity: '.MainActivity',
        }
      },
      async wait() {},
    },
    sessions: { close },
  })
  const gateway = new AgentDeviceGateway(() => client)
  await gateway.openSession({
    sessionId: 'session-1',
    application: {
      id: 'com.example.checkout',
      binaryPath: '/tmp/checkout.apk',
    },
  })

  await expect(gateway.closeSession('session-1')).rejects.toThrow(
    'Close failed',
  )
  await gateway.dispose()

  expect(close).toHaveBeenCalledTimes(2)
})
