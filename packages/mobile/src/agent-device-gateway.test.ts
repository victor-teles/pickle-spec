import { expect, mock, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError } from 'agent-device'
import {
  type AgentDeviceClientPort,
  observeAgentDeviceInferenceRoutes,
} from './agent-device-client'
import { AgentDeviceGateway } from './agent-device-gateway'

const androidEmulator = {
  platform: 'android',
  target: 'mobile',
  kind: 'emulator',
  id: 'emulator-5554',
  name: 'Pixel 9',
  booted: true,
  identifiers: {},
  android: { serial: 'emulator-5554' },
}

const iosSimulator = {
  platform: 'ios',
  target: 'mobile',
  kind: 'simulator',
  id: 'simulator-1',
  name: 'iPhone 16',
  booted: true,
  identifiers: {},
  ios: { udid: 'simulator-1' },
}

const application = {
  id: 'com.example.checkout',
  binaryPath: '/tmp/checkout.apk',
}

const scenario = {
  steps: [
    { type: 'action' as const, text: 'Pay' },
    { type: 'outcome' as const, text: 'Receipt' },
  ],
  templateSteps: [
    { type: 'action' as const, text: 'Pay' },
    { type: 'outcome' as const, text: 'Receipt' },
  ],
  runtimeBindings: [],
}

function client(
  overrides: Partial<AgentDeviceClientPort> = {},
): AgentDeviceClientPort {
  const observed = observeAgentDeviceInferenceRoutes({
    devices: {
      async list() {
        return [androidEmulator, iosSimulator]
      },
      async capabilities(selection) {
        return {
          device:
            selection.platform === 'android' ? androidEmulator : iosSimulator,
          availableCommands: ['screenshot', 'logs', 'record', 'trace'],
        }
      },
    },
    apps: {
      async reinstall() {},
      async open() {},
    },
    command: {
      async appState(selection) {
        return selection.platform === 'android'
          ? {
              platform: 'android',
              package: application.id,
              activity: '.MainActivity',
            }
          : {
              platform: 'ios',
              appName: 'Checkout',
              appBundleId: application.id,
              source: 'session',
              surface: 'app',
            }
      },
      async wait() {},
    },
    interactions: {
      async find() {},
    },
    replay: {
      async run() {
        return {
          replayed: 3,
          healed: 0,
          session: 'session-1',
          sessionActive: true,
          artifactPaths: [],
          message: 'Replay completed',
        }
      },
    },
    capture: {
      async screenshot() {},
    },
    observability: {
      async logs() {},
    },
    recording: {
      async record() {},
      async trace() {},
    },
    sessions: {
      async close() {},
    },
  })
  return { ...observed, ...overrides }
}

test('discovers only booted targets compatible with each mobile platform', async () => {
  const gateway = new AgentDeviceGateway(() => client())

  await expect(gateway.discoverTargets('android')).resolves.toEqual([
    {
      id: androidEmulator.id,
      name: androidEmulator.name,
      state: 'booted',
      capabilities: [
        'android',
        'android-emulator',
        'screenshots',
        'device-logs',
        'recordings',
        'traces',
      ],
    },
  ])
  await expect(gateway.discoverTargets('ios')).resolves.toEqual([
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
        'traces',
      ],
    },
  ])
})

test('resets the selected application before the private Scenario Replay', async () => {
  const reinstall = mock(async () => {})
  const open = mock(async () => {})
  const replay = mock(async () => ({
    replayed: 3,
    healed: 0,
    session: 'session-1',
    sessionActive: true,
    artifactPaths: [],
    message: 'Replay completed',
  }))
  const gateway = new AgentDeviceGateway(() =>
    client({
      apps: { reinstall, open },
      replay: { run: replay },
    }),
  )

  await gateway.openSession({
    sessionId: 'session-1',
    platform: 'android',
    targetId: androidEmulator.id,
    application,
    mode: 'adaptive',
    scenario,
  })
  await gateway.executeScenario('session-1')

  expect(reinstall).toHaveBeenCalledWith({
    platform: 'android',
    serial: androidEmulator.android.serial,
    app: application.id,
    appPath: application.binaryPath,
  })
  expect(open).toHaveBeenCalledWith({
    platform: 'android',
    serial: androidEmulator.android.serial,
    app: application.id,
  })
  expect(replay).toHaveBeenCalledTimes(1)
})

test('classifies native Replay divergence at the matching Scenario step', async () => {
  const replayError = new AppError(
    'REPLAY_DIVERGENCE',
    'Receipt was not visible',
    {
      divergence: { step: { index: 3 } },
    },
  )
  const gateway = new AgentDeviceGateway(() =>
    client({
      replay: {
        async run() {
          throw replayError
        },
      },
    }),
  )
  await gateway.openSession({
    sessionId: 'session-1',
    application,
    mode: 'replay',
    scenario,
  })

  await expect(gateway.executeScenario('session-1')).resolves.toEqual({
    stepExecutions: [
      {
        state: 'passed',
        resolvedActions: [{ description: 'Act: Pay' }],
      },
      {
        state: 'failed',
        resolvedActions: [{ description: 'Assert visible: Receipt' }],
        replayDiverged: true,
        message: 'Agent Device Replay diverged at Scenario step 2',
      },
    ],
    replayDiverged: true,
  })
})

test('keeps Agent Device infrastructure failures out of divergence fallback', async () => {
  const gateway = new AgentDeviceGateway(() =>
    client({
      replay: {
        async run() {
          throw new AppError('COMMAND_FAILED', 'ADB transport unavailable')
        },
      },
    }),
  )
  await gateway.openSession({
    sessionId: 'session-1',
    application,
    mode: 'replay',
    scenario,
  })

  await expect(gateway.executeScenario('session-1')).rejects.toThrow(
    'ADB transport unavailable',
  )
})

test('captures Scenario-wide evidence around the exact Replay', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'pickle-evidence-'))
  const record = mock(
    async (_options: { action: 'start' | 'stop'; path?: string }) => {},
  )
  const trace = mock(
    async (_options: { action: 'start' | 'stop'; path?: string }) => {},
  )
  const screenshot = mock(async (options: { path?: string }) => ({
    path: options.path ?? '',
  }))
  const gateway = new AgentDeviceGateway(() =>
    client({
      recording: { record, trace },
      capture: { screenshot },
    }),
  )

  try {
    await gateway.openSession({
      sessionId: 'session-1',
      application,
      artifactDirectory,
      artifacts: ['recording', 'trace', 'screenshot'],
      mode: 'adaptive',
      scenario,
    })

    await expect(gateway.executeScenario('session-1')).resolves.toMatchObject({
      stepExecutions: [
        { state: 'passed' },
        {
          state: 'passed',
          artifacts: [
            { kind: 'recording', mediaType: 'video/mp4' },
            { kind: 'trace' },
            { kind: 'screenshot', mediaType: 'image/png' },
          ],
        },
      ],
    })
    expect(record.mock.calls.map(([options]) => options.action)).toEqual([
      'start',
      'stop',
    ])
    expect(trace.mock.calls.map(([options]) => options.action)).toEqual([
      'start',
      'stop',
    ])
    expect(screenshot).toHaveBeenCalledTimes(1)
  } finally {
    await gateway.dispose()
    await rm(artifactDirectory, { recursive: true, force: true })
  }
})

test('rejects binary evidence redaction before opening Agent Device', async () => {
  const createClient = mock(() => client())
  const gateway = new AgentDeviceGateway(createClient)

  await expect(
    gateway.openSession({
      sessionId: 'session-1',
      application,
      artifacts: ['screenshot'],
      redactions: [{ match: 'secret' }],
      mode: 'adaptive',
      scenario,
    }),
  ).rejects.toThrow('Binary mobile evidence cannot apply text redactions')
  expect(createClient).not.toHaveBeenCalled()
})

test('rejects an invalid cached .ad before opening Agent Device', async () => {
  const createClient = mock(() => client())
  const gateway = new AgentDeviceGateway(createClient)

  await expect(
    gateway.openSession({
      sessionId: 'session-1',
      application,
      mode: 'replay',
      scenario,
      executionCache: {
        adapterPayload: {
          format: 'agent-device-ad',
          script:
            'context platform=android\n' +
            'open "com.example.checkout" --relaunch\n' +
            'find "Email" fill "private@example.com"\n',
          stepRanges: [{ from: 2, to: 2 }],
        },
        requiredVariables: [],
      },
    }),
  ).rejects.toThrow('Mobile Replay cache payload is invalid')
  expect(createClient).not.toHaveBeenCalled()
})

test('redacts runtime binding values from text evidence', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'pickle-evidence-'))
  const sourceLog = join(artifactDirectory, 'device.log')
  const privateValue = 'account-4111111111111111'
  await Bun.write(sourceLog, `Checkout account: ${privateValue}`)
  const gateway = new AgentDeviceGateway(() =>
    client({
      observability: {
        async logs(options) {
          return options.action === 'path' ? { path: sourceLog } : undefined
        },
      },
    }),
  )

  try {
    await gateway.openSession({
      sessionId: 'session-redaction',
      application,
      artifactDirectory,
      artifacts: ['device-log'],
      mode: 'adaptive',
      scenario: {
        steps: [
          { type: 'action', text: `Pay ${privateValue}` },
          { type: 'outcome', text: 'Receipt' },
        ],
        templateSteps: [
          { type: 'action', text: 'Pay <account>' },
          { type: 'outcome', text: 'Receipt' },
        ],
        runtimeBindings: [{ name: 'account', value: privateValue }],
      },
    })

    const execution = await gateway.executeScenario('session-redaction')
    const artifactPath = execution.stepExecutions.at(-1)?.artifacts?.[0]?.path

    expect(artifactPath).toBeDefined()
    expect(await Bun.file(artifactPath!).text()).toBe(
      'Checkout account: [REDACTED]',
    )
    expect(JSON.stringify(execution)).not.toContain(privateValue)
    expect(
      JSON.stringify(await gateway.completeSession('session-redaction')),
    ).not.toContain(privateValue)
  } finally {
    await gateway.dispose()
    await rm(artifactDirectory, { recursive: true, force: true })
  }
})
