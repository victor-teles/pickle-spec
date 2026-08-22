import { expect, mock, test } from 'bun:test'
import { access, readFile, stat } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { AgentDeviceClientPort } from './agent-device-client'
import { AgentDeviceGateway } from './agent-device-gateway'
import { mobileReplayVariableName } from './mobile-execution-cache'

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

const application = {
  id: 'com.example.checkout',
  binaryPath: '/tmp/checkout.apk',
}
const productVariable = mobileReplayVariableName('product')
const productPlaceholder = ['$', `{${productVariable}}`].join('')
const cachedScript =
  'context platform=android\n' +
  'open "com.example.checkout" --relaunch\n' +
  `find "Buy ${productPlaceholder}" click\n` +
  'is visible "text=\\"Receipt\\""\n'

function client(
  replayRun: AgentDeviceClientPort['replay']['run'],
  semanticOperations: {
    wait?: AgentDeviceClientPort['command']['wait']
    find?: AgentDeviceClientPort['interactions']['find']
  } = {},
): AgentDeviceClientPort {
  return {
    devices: {
      async list() {
        return [androidEmulator]
      },
      async capabilities() {
        return { device: androidEmulator, availableCommands: [] }
      },
    },
    apps: {
      async reinstall() {},
      async open() {},
    },
    command: {
      async appState() {
        return {
          platform: 'android',
          package: application.id,
          activity: '.MainActivity',
        }
      },
      wait: semanticOperations.wait ?? (async () => {}),
    },
    interactions: {
      find: semanticOperations.find ?? (async () => {}),
    },
    replay: { run: replayRun },
    capture: {
      async screenshot(options) {
        return { path: options.path ?? '' }
      },
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
  }
}

test('Adaptive executes the exact private full-Scenario .ad before returning it', async () => {
  let materializedPath = ''
  let materializedScript = ''
  const replayRun = mock(async (options) => {
    materializedPath = options.path
    materializedScript = await readFile(options.path, 'utf8')
    expect((await stat(dirname(options.path))).mode & 0o777).toBe(0o700)
    expect((await stat(options.path)).mode & 0o777).toBe(0o600)
    expect(options.env).toEqual([`${productVariable}=Pickles`])
    return {
      replayed: 3,
      healed: 0,
      session: 'session-1',
      sessionActive: true,
      artifactPaths: [],
      message: 'Replay completed',
    }
  })
  const gateway = new AgentDeviceGateway(() => client(replayRun))

  await gateway.openSession({
    sessionId: 'session-1',
    platform: 'android',
    targetId: androidEmulator.id,
    application,
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

  await expect(gateway.executeScenario('session-1')).resolves.toEqual({
    stepExecutions: [
      {
        state: 'passed',
        resolvedActions: [{ description: 'Act: Buy <product>' }],
      },
      {
        state: 'passed',
        resolvedActions: [{ description: 'Assert visible: Receipt' }],
      },
    ],
  })
  const completion = await gateway.completeSession('session-1')

  expect(materializedScript).toBe(
    'context platform=android\n' +
      'open "com.example.checkout" --relaunch\n' +
      `find "Buy ${productPlaceholder}" click\n` +
      'is visible "text=\\"Receipt\\""\n',
  )
  expect(completion).toEqual({
    inferenceCount: 0,
    replayRepresentation: {
      cacheable: true,
      requiredVariables: ['product'],
      adapterPayload: {
        format: 'agent-device-ad',
        script: materializedScript,
        stepRanges: [
          { from: 2, to: 2 },
          { from: 3, to: 3 },
        ],
      },
    },
  })
  await expect(access(materializedPath)).rejects.toThrow()
  await expect(access(dirname(materializedPath))).rejects.toThrow()
})

test('Replay executes only the cached .ad and reports zero inference', async () => {
  const wait = mock(async () => {})
  const find = mock(async () => {})
  const replayRun = mock(async (options) => {
    expect(await readFile(options.path, 'utf8')).toBe(cachedScript)
    expect(options.env).toEqual([`${productVariable}=Pickles`])
    return {
      replayed: 3,
      healed: 0,
      session: 'session-1',
      sessionActive: true,
      artifactPaths: [],
      message: 'Replay completed',
    }
  })
  const gateway = new AgentDeviceGateway(() =>
    client(replayRun, { wait, find }),
  )
  await gateway.openSession({
    sessionId: 'session-1',
    platform: 'android',
    application,
    mode: 'replay',
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
    executionCache: {
      adapterPayload: {
        format: 'agent-device-ad',
        script: cachedScript,
        stepRanges: [
          { from: 2, to: 2 },
          { from: 3, to: 3 },
        ],
      },
      requiredVariables: ['product'],
    },
  })

  await expect(gateway.executeScenario('session-1')).resolves.toMatchObject({
    stepExecutions: [{ state: 'passed' }, { state: 'passed' }],
  })
  await expect(gateway.completeSession('session-1')).resolves.toEqual({
    inferenceCount: 0,
  })
  expect(replayRun).toHaveBeenCalledTimes(1)
  expect(wait).not.toHaveBeenCalled()
  expect(find).not.toHaveBeenCalled()
})

test('Replay rejects Agent Device healing', async () => {
  const gateway = new AgentDeviceGateway(() =>
    client(async () => ({
      replayed: 2,
      healed: 1,
      session: 'session-1',
      sessionActive: true,
      artifactPaths: [],
      message: 'Replay healed one step',
    })),
  )

  await openCachedReplay(gateway)
  await expect(gateway.executeScenario('session-1')).rejects.toThrow(
    'unexpectedly healed',
  )
})

test('Replay rejects an Agent Device inference report', async () => {
  const gateway = new AgentDeviceGateway(() =>
    client(async () => ({
      replayed: 3,
      healed: 0,
      inferenceCount: 1,
      session: 'session-1',
      sessionActive: true,
      artifactPaths: [],
      message: 'Replay completed with inference',
    })),
  )

  await openCachedReplay(gateway)
  await expect(gateway.executeScenario('session-1')).rejects.toThrow(
    'unexpectedly reported inference',
  )
})

async function openCachedReplay(gateway: AgentDeviceGateway): Promise<void> {
  await gateway.openSession({
    sessionId: 'session-1',
    platform: 'android',
    application,
    mode: 'replay',
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
    executionCache: {
      adapterPayload: {
        format: 'agent-device-ad',
        script: cachedScript,
        stepRanges: [
          { from: 2, to: 2 },
          { from: 3, to: 3 },
        ],
      },
      requiredVariables: ['product'],
    },
  })
}
