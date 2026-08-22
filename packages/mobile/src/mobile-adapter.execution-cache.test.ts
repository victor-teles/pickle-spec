import { expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openLocalExecutionCache, runScenario } from '@pickle-spec/runner'
import { createMobileAdapter } from '../index'
import { mobileReplayVariableName } from './mobile-execution-cache'
import type { MobileWorkerClient } from './worker-client'
import type { MobileWorkerRequest } from './worker-protocol'

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

test('public cache-only replays SQLite .ad with zero inference and rejects inference', async () => {
  const projectRoot = await mkdtemp(join(tmpdir(), 'pickle-mobile-project-'))
  const cacheRoot = await mkdtemp(join(tmpdir(), 'pickle-mobile-cache-'))
  const opened: Array<Extract<MobileWorkerRequest, { type: 'open-session' }>> =
    []
  let replayInferenceCount = 0
  const worker: MobileWorkerClient = {
    async request(request) {
      switch (request.type) {
        case 'discover-targets':
          return { version: 3, type: 'targets-discovered', targets: [] }
        case 'open-session':
          opened.push(request)
          return {
            version: 3,
            type: 'session-opened',
            sessionId: request.sessionId,
            targetId: 'emulator-5554',
          }
        case 'execute-scenario': {
          const session = opened.find(
            (candidate) => candidate.sessionId === request.sessionId,
          )
          if (!session) throw new Error('Session is not open')
          return {
            version: 3,
            type: 'scenario-executed',
            sessionId: request.sessionId,
            execution: {
              stepExecutions: session.scenario.templateSteps.map((step) => ({
                state: 'passed',
                resolvedActions: [{ description: step.text }],
              })),
            },
          }
        }
        case 'complete-session': {
          const session = opened.find(
            (candidate) => candidate.sessionId === request.sessionId,
          )
          if (!session) throw new Error('Session is not open')
          return {
            version: 3,
            type: 'session-completed',
            sessionId: request.sessionId,
            completion:
              session.mode === 'adaptive'
                ? {
                    inferenceCount: 0,
                    replayRepresentation: {
                      cacheable: true,
                      adapterPayload: payload,
                      requiredVariables: ['product'],
                    },
                  }
                : { inferenceCount: replayInferenceCount },
          }
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
    },
    async dispose() {},
  }
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
    replayInferenceCount = 1
    const inferredReplay = await runScenario({
      ...commonInput,
      cachePolicy: 'cache-only',
      executionCache: { ...commonInput.executionCache, sourceRunId: 'run-3' },
    })

    expect(adaptive.result).toMatchObject({
      state: 'passed',
      executionMode: 'adaptive',
      cacheOutcome: 'miss',
    })
    expect(replay.result).toMatchObject({
      state: 'passed',
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 0,
    })
    expect(inferredReplay.result).toMatchObject({
      state: 'failed',
      executionMode: 'replay',
      cacheOutcome: 'hit',
      inferenceCount: 1,
    })
    expect(inferredReplay.result.message).toContain('zero evaluation inference')
    expect(opened.map((request) => request.mode)).toEqual([
      'adaptive',
      'replay',
      'replay',
    ])
    expect(opened[1]?.executionCache).toEqual({
      adapterPayload: payload,
      requiredVariables: ['product'],
    })
    const [entry] = await cache.inspect()
    expect(entry?.hitCount).toBe(2)
    expect(JSON.stringify(entry)).not.toContain('Pickles')
    const database = await Bun.file(
      join(cacheRoot, cache.projectKey, 'execution-cache.sqlite'),
    ).bytes()
    expect(Buffer.from(database).includes(Buffer.from('Pickles'))).toBe(false)
  } finally {
    await adapter.dispose?.()
    await rm(projectRoot, { recursive: true, force: true })
    await rm(cacheRoot, { recursive: true, force: true })
  }
})
