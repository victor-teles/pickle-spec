import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AppError } from 'agent-device'
import { expect, test, vi } from 'vitest'
import { requiredValue } from '../required-value'
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
  const reinstall = vi.fn(async () => {})
  const open = vi.fn(async () => {})
  const replay = vi.fn(async () => ({
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

test('opens an explicitly preinstalled application without reinstalling it', async () => {
  const reinstall = vi.fn(async () => {})
  const open = vi.fn(async () => {})
  const gateway = new AgentDeviceGateway(() =>
    client({ apps: { reinstall, open } }),
  )

  await gateway.openSession({
    sessionId: 'session-1',
    platform: 'android',
    targetId: androidEmulator.id,
    application: { id: application.id, installed: true },
    mode: 'adaptive',
    scenario,
  })

  expect(reinstall).not.toHaveBeenCalled()
  expect(open).toHaveBeenCalledWith({
    platform: 'android',
    serial: androidEmulator.android.serial,
    app: application.id,
  })
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
  const record = vi.fn(
    async (options: { action: 'start' | 'stop'; path?: string }) => {
      if (options.action === 'stop' && options.path) {
        await Bun.write(options.path, 'recording')
      }
    },
  )
  const trace = vi.fn(
    async (options: { action: 'start' | 'stop'; path?: string }) => {
      if (options.action === 'stop' && options.path) {
        await Bun.write(options.path, 'trace')
      }
    },
  )
  const screenshot = vi.fn(async (options: { path?: string }) => {
    const path = options.path ?? ''
    await Bun.write(path, 'screenshot')
    return { path }
  })
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
            {
              kind: 'recording',
              mediaType: 'video/mp4',
              name: 'scenario.mp4',
            },
            { kind: 'trace', name: 'scenario.trace' },
            {
              kind: 'screenshot',
              mediaType: 'image/png',
              name: 'scenario.png',
            },
          ],
          evidenceAvailability: [
            { kind: 'recording', state: 'available' },
            { kind: 'trace', state: 'available' },
            { kind: 'screenshot', state: 'available' },
          ],
        },
      ],
    })
    const artifacts = (
      await gateway.executeScenario('session-1')
    ).stepExecutions.at(-1)?.artifacts
    expect(
      artifacts?.every((artifact) =>
        artifact.capturedAt
          ? /^\d{4}-\d{2}-\d{2}T/.test(artifact.capturedAt)
          : false,
      ),
    ).toBe(true)
    expect(record.mock.calls.map(([options]) => options.action)).toEqual([
      'start',
      'stop',
    ])
    expect(trace.mock.calls.map(([options]) => options.action)).toEqual([
      'start',
      'stop',
    ])
    expect(screenshot).toHaveBeenCalledTimes(2)
    expect(screenshot).toHaveBeenCalledWith(
      expect.objectContaining({ scale: 0.5, stabilize: false }),
    )
  } finally {
    await gateway.dispose()
    await rm(artifactDirectory, { recursive: true, force: true })
  }
})

test('retains successful Mobile artifacts when a sibling capture fails', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'pickle-evidence-'))
  const gateway = new AgentDeviceGateway(() =>
    client({
      recording: {
        async record(options) {
          if (options.action === 'stop' && options.path) {
            await Bun.write(options.path, 'recording')
          }
        },
        async trace() {},
      },
      capture: {
        async screenshot() {
          throw new Error('Screenshot transport closed')
        },
      },
    }),
  )

  try {
    await gateway.openSession({
      sessionId: 'session-partial-evidence',
      application,
      artifactDirectory,
      artifacts: ['recording', 'screenshot'],
      mode: 'adaptive',
      scenario,
    })

    const finalStep = (
      await gateway.executeScenario('session-partial-evidence')
    ).stepExecutions.at(-1)

    expect(finalStep?.artifacts).toEqual([
      expect.objectContaining({ kind: 'recording', name: 'scenario.mp4' }),
    ])
    expect(finalStep?.evidenceAvailability).toEqual([
      { kind: 'recording', state: 'available' },
      {
        kind: 'screenshot',
        state: 'capture-failed',
        message: 'Screenshot transport closed',
      },
    ])
  } finally {
    await gateway.dispose()
    await rm(artifactDirectory, { recursive: true, force: true })
  }
})

test('reports unsupported requested Mobile evidence without failing the Scenario', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'pickle-evidence-'))
  const gateway = new AgentDeviceGateway(() =>
    client({
      devices: {
        async list() {
          return [androidEmulator, iosSimulator]
        },
        async capabilities() {
          return {
            device: androidEmulator,
            availableCommands: ['screenshot'],
          }
        },
      },
      capture: {
        async screenshot(options) {
          const path = options.path ?? ''
          await Bun.write(path, 'screenshot')
          return { path }
        },
      },
    }),
  )

  try {
    await gateway.openSession({
      sessionId: 'session-unsupported-evidence',
      application,
      artifactDirectory,
      artifacts: ['recording', 'screenshot'],
      mode: 'adaptive',
      scenario,
    })

    const finalStep = (
      await gateway.executeScenario('session-unsupported-evidence')
    ).stepExecutions.at(-1)

    expect(finalStep?.artifacts).toEqual([
      expect.objectContaining({ kind: 'screenshot', name: 'scenario.png' }),
    ])
    expect(finalStep?.evidenceAvailability).toEqual([
      {
        kind: 'recording',
        state: 'not-supported',
        message: 'Android Emulator does not support recording evidence',
      },
      { kind: 'screenshot', state: 'available' },
    ])
  } finally {
    await gateway.dispose()
    await rm(artifactDirectory, { recursive: true, force: true })
  }
})

test('reports a missing Mobile artifact when capture returns no file', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'pickle-evidence-'))
  const gateway = new AgentDeviceGateway(() =>
    client({
      capture: {
        async screenshot(options) {
          return { path: options.path ?? '' }
        },
      },
    }),
  )

  try {
    await gateway.openSession({
      sessionId: 'session-missing-evidence',
      application,
      artifactDirectory,
      artifacts: ['screenshot'],
      mode: 'adaptive',
      scenario,
    })

    const finalStep = (
      await gateway.executeScenario('session-missing-evidence')
    ).stepExecutions.at(-1)

    expect(finalStep?.artifacts).toBeUndefined()
    expect(finalStep?.evidenceAvailability).toEqual([
      {
        kind: 'screenshot',
        state: 'missing',
        message: 'Captured screenshot file is missing',
      },
    ])
  } finally {
    await gateway.dispose()
    await rm(artifactDirectory, { recursive: true, force: true })
  }
})

test('rejects a screenshot path outside the requested evidence directory', async () => {
  const artifactDirectory = await mkdtemp(join(tmpdir(), 'pickle-evidence-'))
  const outsidePath = join(artifactDirectory, '..', 'outside-screenshot.png')
  await Bun.write(outsidePath, 'private')
  const gateway = new AgentDeviceGateway(() =>
    client({
      capture: {
        async screenshot() {
          return { path: outsidePath }
        },
      },
    }),
  )

  try {
    await gateway.openSession({
      sessionId: 'session-outside-evidence',
      application,
      artifactDirectory,
      artifacts: ['screenshot'],
      mode: 'adaptive',
      scenario,
    })

    const finalStep = (
      await gateway.executeScenario('session-outside-evidence')
    ).stepExecutions.at(-1)

    expect(finalStep?.artifacts).toBeUndefined()
    expect(finalStep?.evidenceAvailability).toEqual([
      expect.objectContaining({
        kind: 'screenshot',
        state: 'capture-failed',
      }),
    ])
  } finally {
    await gateway.dispose()
    await rm(artifactDirectory, { recursive: true, force: true })
    await rm(outsidePath, { force: true })
  }
})

test('rejects binary evidence redaction before opening Agent Device', async () => {
  const createClient = vi.fn(() => client())
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
  const createClient = vi.fn(() => client())
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
    expect(await Bun.file(requiredValue(artifactPath)).text()).toBe(
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
