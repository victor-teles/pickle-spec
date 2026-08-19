import { expect, mock, test } from 'bun:test'
import {
  type AgentDeviceClientPort,
  AgentDeviceGateway,
} from './agent-device-gateway'

const androidEmulator = {
  platform: 'android',
  target: 'mobile',
  kind: 'emulator',
  id: 'emulator-5554',
  name: 'Pixel 9 API 35',
  booted: true,
  identifiers: {},
  android: { serial: 'emulator-5554' },
}

const application = {
  id: 'com.example.checkout',
  binaryPath: '/tmp/checkout.apk',
}

const runningAppState = {
  platform: 'android',
  package: application.id,
  activity: '.MainActivity',
}

interface OpenTestSessionOptions {
  targetId?: string
  artifactDirectory?: string
}

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

function emulatorClient(
  overrides: Partial<AgentDeviceClientPort> = {},
): AgentDeviceClientPort {
  return fakeClient({
    devices: {
      async list() {
        return [androidEmulator]
      },
      async capabilities() {
        throw new Error('Unexpected capabilities request')
      },
    },
    command: {
      async appState() {
        return runningAppState
      },
      async wait() {},
    },
    ...overrides,
  })
}

async function openTestSession(
  gateway: AgentDeviceGateway,
  options: OpenTestSessionOptions = {},
): Promise<void> {
  await gateway.openSession({
    sessionId: 'session-1',
    targetId: options.targetId,
    application,
    artifactDirectory: options.artifactDirectory,
  })
}

test('discovers compatible Android Emulator targets and normalizes capabilities', async () => {
  const close = mock(async () => {})
  const client = fakeClient({
    devices: {
      async list() {
        return [
          androidEmulator,
          {
            ...androidEmulator,
            kind: 'device',
            id: 'physical-1',
            name: 'Physical phone',
            android: { serial: 'physical-1' },
          },
        ]
      },
      async capabilities() {
        return {
          device: androidEmulator,
          availableCommands: ['snapshot', 'screenshot', 'logs', 'find'],
        }
      },
    },
    sessions: { close },
  })
  const gateway = new AgentDeviceGateway(() => client)

  expect(await gateway.discoverTargets()).toEqual([
    {
      id: androidEmulator.id,
      name: androidEmulator.name,
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
  const appState = mock(async () => runningAppState)
  const client = emulatorClient({
    apps: { reinstall, open },
    command: { appState, async wait() {} },
  })
  const gateway = new AgentDeviceGateway(() => client)

  await expect(
    gateway.openSession({
      sessionId: 'session-1',
      targetId: androidEmulator.id,
      application,
    }),
  ).resolves.toEqual({ targetId: androidEmulator.id })
  expect(reinstall).toHaveBeenCalledWith({
    app: application.id,
    appPath: application.binaryPath,
    platform: 'android',
    serial: androidEmulator.android.serial,
  })
  expect(open).toHaveBeenCalledWith({
    app: application.id,
    platform: 'android',
    serial: androidEmulator.android.serial,
  })
  expect(appState).toHaveBeenCalledWith({
    platform: 'android',
    serial: androidEmulator.android.serial,
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
    application,
  })

  await gateway.cancelSession('session-1')
  resolveDevices([androidEmulator])

  await expect(opening).rejects.toThrow('Aborted')
  expect(reinstall).not.toHaveBeenCalled()
  expect(close).toHaveBeenCalledTimes(1)
})

test('normalizes Adaptive actions and screenshot artifacts without vendor results', async () => {
  const find = mock(async () => ({ ref: '@e4', message: 'clicked' }))
  const screenshot = mock(async (options: { path?: string }) => ({
    path: options.path ?? '',
  }))
  const gateway = new AgentDeviceGateway(() =>
    emulatorClient({
      interactions: { find },
      capture: { screenshot },
    }),
  )
  await openTestSession(gateway, {
    targetId: androidEmulator.id,
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
    serial: androidEmulator.android.serial,
    query: 'Pay now',
    action: 'click',
  })
  expect(screenshot).toHaveBeenCalledWith({
    path: '/tmp/pickle-mobile-artifacts/session-1/step-01.png',
  })
})

test('replays normalized actions and adapts when a replay action is unavailable', async () => {
  const find = mock(async (_options: unknown) => {})
  const gateway = new AgentDeviceGateway(() =>
    emulatorClient({ interactions: { find } }),
  )
  await openTestSession(gateway, {
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
      serial: androidEmulator.android.serial,
      query: 'Saved pay button',
      action: 'click',
    },
    {
      platform: 'android',
      serial: androidEmulator.android.serial,
      query: 'Confirm order',
      action: 'click',
    },
  ])
})

test('classifies unexpected worker and device errors as infrastructure errors', async () => {
  const gateway = new AgentDeviceGateway(() =>
    emulatorClient({
      interactions: {
        async find() {
          throw new Error('ADB disconnected')
        },
      },
    }),
  )
  await openTestSession(gateway)

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
  const gateway = new AgentDeviceGateway(() =>
    emulatorClient({
      capture: {
        async screenshot() {
          throw new Error('Screenshot helper is unavailable')
        },
      },
    }),
  )
  await openTestSession(gateway, {
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
  const gateway = new AgentDeviceGateway(() =>
    emulatorClient({ sessions: { close } }),
  )
  await openTestSession(gateway)

  await expect(gateway.closeSession('session-1')).rejects.toThrow(
    'Close failed',
  )
  await gateway.dispose()

  expect(close).toHaveBeenCalledTimes(2)
})
