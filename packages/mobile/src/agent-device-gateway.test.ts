import { expect, mock, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError } from 'agent-device'
import { isFunctionalAgentDeviceFailure } from './agent-device-client'
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

const iosSimulator = {
  platform: 'ios',
  target: 'mobile',
  kind: 'simulator',
  id: 'F2D95476-0A9E-4A8C-9F48-8C77B2F5B8D0',
  name: 'iPhone 16 Pro',
  booted: true,
  appleOs: 'ios',
  identifiers: {},
  ios: { udid: 'F2D95476-0A9E-4A8C-9F48-8C77B2F5B8D0' },
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

const runningIosAppState = {
  platform: 'ios',
  appName: 'Checkout',
  appBundleId: application.id,
  source: 'session',
  surface: 'app',
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
    observability: {
      async logs() {
        throw new Error('Unexpected logs request')
      },
    },
    recording: {
      async record() {
        throw new Error('Unexpected recording request')
      },
      async trace() {
        throw new Error('Unexpected trace request')
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
        return {
          device: androidEmulator,
          availableCommands: ['screenshot'],
        }
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

test('discovers compatible iOS Simulator targets and normalizes supported evidence', async () => {
  const close = mock(async () => {})
  const capabilities = mock(async () => ({
    device: iosSimulator,
    availableCommands: ['snapshot', 'screenshot', 'logs', 'record', 'find'],
  }))
  const client = fakeClient({
    devices: {
      async list() {
        return [
          iosSimulator,
          {
            ...iosSimulator,
            kind: 'device',
            id: 'physical-ios-1',
            name: 'Physical iPhone',
            ios: { udid: 'physical-ios-1' },
          },
        ]
      },
      capabilities,
    },
    sessions: { close },
  })
  const gateway = new AgentDeviceGateway(() => client)

  expect(await gateway.discoverTargets('ios')).toEqual([
    {
      id: iosSimulator.id,
      name: iosSimulator.name,
      state: 'booted',
      capabilities: [
        'ios',
        'ios-simulator',
        'screenshots',
        'device-logs',
        'recordings',
      ],
    },
  ])
  expect(capabilities).toHaveBeenCalledWith({
    platform: 'ios',
    udid: iosSimulator.ios.udid,
  })
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

test('reinstalls, opens, and verifies an iOS application for a logical session', async () => {
  const reinstall = mock(async () => {})
  const open = mock(async () => {})
  const appState = mock(async () => runningIosAppState)
  const client = fakeClient({
    devices: {
      async list() {
        return [iosSimulator]
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
      platform: 'ios',
      targetId: iosSimulator.id,
      application,
    }),
  ).resolves.toEqual({ targetId: iosSimulator.id })
  expect(reinstall).toHaveBeenCalledWith({
    app: application.id,
    appPath: application.binaryPath,
    platform: 'ios',
    udid: iosSimulator.ios.udid,
  })
  expect(open).toHaveBeenCalledWith({
    app: application.id,
    platform: 'ios',
    udid: iosSimulator.ios.udid,
  })
  expect(appState).toHaveBeenCalledWith({
    platform: 'ios',
    udid: iosSimulator.ios.udid,
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

test('normalizes iOS device errors into the common infrastructure-error model', async () => {
  const gateway = new AgentDeviceGateway(() =>
    fakeClient({
      devices: {
        async list() {
          return [iosSimulator]
        },
        async capabilities() {
          throw new Error('Unexpected capabilities request')
        },
      },
      command: {
        async appState() {
          return runningIosAppState
        },
        async wait() {},
      },
      interactions: {
        async find() {
          throw new AppError('COMMAND_FAILED', 'XCTest runner disconnected', {
            reason: 'IOS_RUNNER_CONNECT_TIMEOUT',
            retriable: true,
          })
        },
      },
    }),
  )
  await gateway.openSession({
    sessionId: 'session-1',
    platform: 'ios',
    application,
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
    message: 'XCTest runner disconnected',
  })
})

test('classifies unannotated daemon and iOS runner command failures as infrastructure', () => {
  for (const message of [
    'Daemon request timed out',
    'Failed to communicate with daemon',
    'Remote daemon is unavailable',
    'Runner did not accept connection',
    'Invalid runner response',
  ]) {
    expect(
      isFunctionalAgentDeviceFailure(new AppError('COMMAND_FAILED', message)),
    ).toBe(false)
  }
})

test('normalizes iOS interaction errors into the common failure model', async () => {
  const find = mock(async () => {
    throw new AppError('AMBIGUOUS_MATCH', 'Multiple buttons matched')
  })
  const gateway = new AgentDeviceGateway(() =>
    fakeClient({
      devices: {
        async list() {
          return [iosSimulator]
        },
        async capabilities() {
          throw new Error('Unexpected capabilities request')
        },
      },
      command: {
        async appState() {
          return runningIosAppState
        },
        async wait() {},
      },
      interactions: { find },
    }),
  )
  await gateway.openSession({
    sessionId: 'session-1',
    platform: 'ios',
    application,
  })

  await expect(
    gateway.executeStep({
      sessionId: 'session-1',
      stepIndex: 0,
      step: { type: 'action', text: 'Pay now' },
    }),
  ).resolves.toEqual({
    state: 'failed',
    resolvedActions: [],
    message: 'Multiple buttons matched',
  })
  expect(find).toHaveBeenCalledWith({
    platform: 'ios',
    udid: iosSimulator.ios.udid,
    query: 'Pay now',
    action: 'click',
  })
})

test('classifies iOS selector misses and offscreen elements as functional', () => {
  for (const code of ['ELEMENT_NOT_FOUND', 'ELEMENT_OFFSCREEN']) {
    expect(
      isFunctionalAgentDeviceFailure(
        new AppError(code, `iOS interaction failed: ${code}`),
      ),
    ).toBe(true)
  }
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

test('captures requested iOS logs, recordings, and traces as common test artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pickle-ios-evidence-'))
  const sourceLogPath = join(root, 'app.log')
  await Bun.write(sourceLogPath, 'Checkout started\n')
  const logs = mock(async (options: { action: string }) =>
    options.action === 'path' ? { path: sourceLogPath } : {},
  )
  const record = mock(async (options: { action: string; path?: string }) => ({
    recording: options.action === 'start' ? 'started' : 'stopped',
    outPath: options.path ?? '',
  }))
  const trace = mock(async (options: { action: string; path?: string }) => ({
    trace: options.action === 'start' ? 'started' : 'stopped',
    outPath: options.path ?? '',
  }))
  const gateway = new AgentDeviceGateway(() =>
    fakeClient({
      devices: {
        async list() {
          return [iosSimulator]
        },
        async capabilities() {
          return {
            device: iosSimulator,
            availableCommands: ['logs', 'record', 'trace'],
          }
        },
      },
      command: {
        async appState() {
          return runningIosAppState
        },
        async wait() {},
      },
      observability: { logs },
      recording: { record, trace },
    }),
  )

  try {
    await gateway.openSession({
      sessionId: 'session-1',
      platform: 'ios',
      application,
      artifactDirectory: root,
      artifacts: ['device-log', 'recording', 'trace'],
    })

    await expect(
      gateway.executeStep({
        sessionId: 'session-1',
        stepIndex: 0,
        step: { type: 'action', text: 'Pay now' },
      }),
    ).resolves.toMatchObject({
      state: 'passed',
      artifacts: [
        {
          kind: 'device-log',
          path: join(root, 'session-1', 'step-01.log'),
          mediaType: 'text/plain',
        },
        {
          kind: 'recording',
          path: join(root, 'session-1', 'step-01.mp4'),
          mediaType: 'video/mp4',
        },
        {
          kind: 'trace',
          path: join(root, 'session-1', 'step-01.trace'),
        },
      ],
    })
    expect(record.mock.calls.map((call) => call[0].action)).toEqual([
      'start',
      'stop',
    ])
    expect(trace.mock.calls.map((call) => call[0].action)).toEqual([
      'start',
      'stop',
    ])
    await gateway.closeSession('session-1')
    expect(logs.mock.calls.map((call) => call[0].action)).toEqual([
      'start',
      'path',
      'stop',
    ])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('redacts configured text before persisting device logs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pickle-ios-redaction-'))
  const sourceLogPath = join(root, 'app.log')
  await Bun.write(sourceLogPath, 'token=secret-value\n')
  const gateway = new AgentDeviceGateway(() =>
    fakeClient({
      devices: {
        async list() {
          return [iosSimulator]
        },
        async capabilities() {
          return { device: iosSimulator, availableCommands: ['logs'] }
        },
      },
      command: {
        async appState() {
          return runningIosAppState
        },
        async wait() {},
      },
      observability: {
        async logs(options) {
          return options.action === 'path' ? { path: sourceLogPath } : {}
        },
      },
    }),
  )

  try {
    await gateway.openSession({
      sessionId: 'session-1',
      platform: 'ios',
      application,
      artifactDirectory: root,
      artifacts: ['device-log'],
      redactions: [{ match: 'secret-value', replacement: '[REDACTED]' }],
    })
    await gateway.executeStep({
      sessionId: 'session-1',
      stepIndex: 0,
      step: { type: 'action', text: 'Pay now' },
    })

    expect(await readFile(join(root, 'session-1', 'step-01.log'), 'utf8')).toBe(
      'token=[REDACTED]\n',
    )
  } finally {
    await gateway.dispose().catch(() => {})
    await rm(root, { recursive: true, force: true })
  }
})

test('rejects requested evidence that the selected target does not support', async () => {
  const reinstall = mock(async () => {})
  const gateway = new AgentDeviceGateway(() =>
    fakeClient({
      devices: {
        async list() {
          return [iosSimulator]
        },
        async capabilities() {
          return { device: iosSimulator, availableCommands: ['screenshot'] }
        },
      },
      apps: { reinstall, async open() {} },
    }),
  )

  await expect(
    gateway.openSession({
      sessionId: 'session-1',
      platform: 'ios',
      application,
      artifacts: ['recording'],
    }),
  ).rejects.toThrow('does not support requested evidence: recording')
  expect(reinstall).not.toHaveBeenCalled()
})

test('rejects Scenario requirements unsupported by the selected target', async () => {
  const reinstall = mock(async () => {})
  const gateway = new AgentDeviceGateway(() =>
    fakeClient({
      devices: {
        async list() {
          return [iosSimulator]
        },
        async capabilities() {
          return { device: iosSimulator, availableCommands: ['screenshot'] }
        },
      },
      apps: { reinstall, async open() {} },
    }),
  )

  await expect(
    gateway.openSession({
      sessionId: 'session-1',
      platform: 'ios',
      application,
      requiredCapabilities: ['traces'],
    }),
  ).rejects.toThrow('does not satisfy required capabilities: traces')
  expect(reinstall).not.toHaveBeenCalled()
})

test('rejects text redaction policies for binary evidence', async () => {
  const gateway = new AgentDeviceGateway(() => fakeClient())

  await expect(
    gateway.openSession({
      sessionId: 'session-1',
      platform: 'ios',
      application,
      artifacts: ['recording'],
      redactions: [{ match: 'secret' }],
    }),
  ).rejects.toThrow('Binary mobile evidence cannot apply text redactions')
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
