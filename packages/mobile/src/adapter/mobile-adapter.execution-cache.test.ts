import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  finalScenarioAttempt,
  openLocalExecutionCache,
  runScenario,
} from '@pickle-spec/runner'
import { createMobileAdapter } from '../../index'
import {
  type AgentDeviceClientPort,
  observeAgentDeviceInferenceRoutes,
} from '../agent-device/agent-device-client'
import { AgentDeviceGateway } from '../agent-device/agent-device-gateway'
import { mobileReplayVariableName } from '../execution-cache/mobile-execution-cache'
import type { MobileWorkerClient } from '../worker/worker-client'
import {
  type MobileWorkerRequest,
  mobileWorkerRequestSchema,
  mobileWorkerResponseSchema,
} from '../worker/worker-protocol'
import { MobileWorkerRuntime } from '../worker/worker-runtime'

const productPlaceholder = [
  '$',
  `{${mobileReplayVariableName('product')}}`,
].join('')
const script =
  'context platform=android\n' +
  'open "com.example.checkout" --relaunch\n' +
  `find "Buy ${productPlaceholder}" click\n` +
  'is visible "text=\\"Receipt\\""\n'
const payload = {
  format: 'agent-device-ad' as const,
  script,
  stepRanges: [
    { from: 2, to: 2 },
    { from: 3, to: 3 },
  ],
}

const androidEmulator = {
  platform: 'android' as const,
  target: 'mobile' as const,
  kind: 'emulator' as const,
  id: 'emulator-5554',
  name: 'Controlled Android Emulator',
  booted: true,
  identifiers: {},
  android: { serial: 'emulator-5554' },
}

type ReplayBehavior = 'healed' | 'pass' | 'semantic-inference'

interface ControlledAgentDeviceInput {
  behavior(): ReplayBehavior
  recordReplay(): void
}

function controlledAgentDeviceClient(
  input: ControlledAgentDeviceInput,
): AgentDeviceClientPort {
  let observedClient: AgentDeviceClientPort
  observedClient = observeAgentDeviceInferenceRoutes({
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
          package: 'com.example.checkout',
          activity: '.MainActivity',
        }
      },
      async wait() {},
    },
    interactions: {
      async find() {},
    },
    replay: {
      async run() {
        input.recordReplay()
        const behavior = input.behavior()
        if (behavior === 'semantic-inference') {
          await observedClient.command.wait({
            platform: 'android',
            serial: androidEmulator.android.serial,
            text: 'model-selected target',
          })
        }
        return {
          replayed: 3,
          healed: behavior === 'healed' ? 1 : 0,
          session: 'controlled-session',
          sessionActive: true,
          artifactPaths: [],
          message: 'Controlled Replay completed',
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
  return observedClient
}

function controlledRuntimeWorker(
  runtime: MobileWorkerRuntime,
  opened: Array<Extract<MobileWorkerRequest, { type: 'open-session' }>>,
): MobileWorkerClient {
  return {
    async request(request) {
      const validatedRequest = mobileWorkerRequestSchema.parse(request)
      if (validatedRequest.type === 'open-session')
        opened.push(validatedRequest)
      return mobileWorkerResponseSchema.parse(
        await runtime.handle(validatedRequest),
      )
    },
    async dispose() {
      await runtime.dispose()
    },
  }
}

test('public cache-only replays SQLite .ad and rejects semantic inference or healing', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'pickle-mobile-project-'))
  const cacheRoot = await mkdtemp(join(tmpdir(), 'pickle-mobile-cache-'))
  const opened: Array<Extract<MobileWorkerRequest, { type: 'open-session' }>> =
    []
  let replayBehavior: ReplayBehavior = 'pass'
  let replayRuns = 0
  const gateway = new AgentDeviceGateway(() =>
    controlledAgentDeviceClient({
      behavior: () => replayBehavior,
      recordReplay: () => replayRuns++,
    }),
  )
  const worker = controlledRuntimeWorker(
    new MobileWorkerRuntime(gateway),
    opened,
  )
  const adapter = createMobileAdapter(
    {
      application: {
        id: 'com.example.checkout',
        binaryPath: '/tmp/checkout.apk',
      },
      targetId: 'emulator-5554',
    },
    () => worker,
  )
  const specification = {
    id: 'spec-checkout',
    name: 'Checkout',
    source: { uri: 'features/checkout.feature', language: 'en' },
    tags: [],
    scenarios: [],
  }
  const scenario = {
    id: 'scenario-checkout',
    name: 'Buy product',
    tags: [],
    steps: [
      { keyword: 'When', type: 'action' as const, text: 'Buy Pickles' },
      { keyword: 'Then', type: 'outcome' as const, text: 'Receipt' },
    ],
    template: {
      name: 'Buy product',
      variableNames: ['product'],
      steps: [
        { keyword: 'When', type: 'action' as const, text: 'Buy <product>' },
        { keyword: 'Then', type: 'outcome' as const, text: 'Receipt' },
      ],
    },
    runtimeBindings: [{ name: 'product', value: 'Pickles' }],
  }
  const cache = await openLocalExecutionCache({ projectRoot, cacheRoot })
  const commonInput = {
    specification,
    scenario,
    executionTargetProfile: { id: 'android' },
    adapter,
    applicationRevision: 'checkout-v1',
    executionCache: {
      store: cache,
      projectKey: cache.projectKey,
      sourceRunId: 'run-1',
    },
  }

  try {
    const adaptive = await runScenario(commonInput)
    const replay = await runScenario({
      ...commonInput,
      cachePolicy: 'cache-only',
      executionCache: { ...commonInput.executionCache, sourceRunId: 'run-2' },
    })
    replayBehavior = 'semantic-inference'
    const semanticInferenceReplay = await runScenario({
      ...commonInput,
      cachePolicy: 'cache-only',
      executionCache: { ...commonInput.executionCache, sourceRunId: 'run-3' },
    })
    replayBehavior = 'healed'
    const healedReplay = await runScenario({
      ...commonInput,
      cachePolicy: 'cache-only',
      executionCache: { ...commonInput.executionCache, sourceRunId: 'run-4' },
    })

    expect(finalScenarioAttempt(adaptive.result)).toMatchObject({
      state: 'passed',
      executionMode: 'adaptive',
      cacheOutcome: 'miss',
    })
    expect(finalScenarioAttempt(replay.result)).toMatchObject({
      state: 'passed',
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 0,
    })
    expect(finalScenarioAttempt(semanticInferenceReplay.result)).toMatchObject({
      state: 'infrastructure-error',
      executionMode: 'replay',
      cacheOutcome: 'hit',
    })
    expect(
      finalScenarioAttempt(semanticInferenceReplay.result).message,
    ).toContain('semantic inference route')
    expect(finalScenarioAttempt(healedReplay.result)).toMatchObject({
      state: 'infrastructure-error',
      executionMode: 'replay',
      cacheOutcome: 'hit',
    })
    expect(finalScenarioAttempt(healedReplay.result).message).toContain(
      'unexpectedly healed',
    )
    expect(opened.map((request) => request.mode)).toEqual([
      'adaptive',
      'replay',
      'replay',
      'replay',
    ])
    expect(opened[1]?.executionCache).toEqual({
      adapterPayload: payload,
      requiredVariables: ['product'],
    })
    expect(replayRuns).toBe(4)
    const [entry] = await cache.inspect()
    expect(entry?.hitCount).toBe(3)
    expect(JSON.stringify(entry)).not.toContain('Pickles')
    const database = await Bun.file(
      join(cacheRoot, 'execution-cache.sqlite'),
    ).bytes()
    expect(Buffer.from(database).includes(Buffer.from('Pickles'))).toBe(false)
  } finally {
    await adapter.dispose?.()
    await rm(projectRoot, { recursive: true, force: true })
    await rm(cacheRoot, { recursive: true, force: true })
  }
})
