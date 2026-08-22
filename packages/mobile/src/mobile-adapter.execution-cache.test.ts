import { expect, test } from 'bun:test'
import { type ExecutionCacheStore, runScenario } from '@pickle-spec/runner'
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

function memoryCache() {
  const entries = new Map<string, string>()
  const writes: string[] = []
  const store: ExecutionCacheStore = {
    async read(key) {
      return entries.get(JSON.stringify(key))
    },
    async write(serialized) {
      entries.set(JSON.stringify(serialized.key), serialized.source)
      writes.push(serialized.source)
      return { stored: true, evictedEntries: 0 }
    },
    async delete(key) {
      entries.delete(JSON.stringify(key))
    },
    async inspect() {
      return []
    },
    async clear() {
      entries.clear()
    },
  }
  return { store, writes }
}

test('runner stores Adaptive .ad then reuses it through public mobile Replay', async () => {
  const opened: Array<Extract<MobileWorkerRequest, { type: 'open-session' }>> =
    []
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
                : { inferenceCount: 0 },
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
  const cache = memoryCache()
  const commonInput = {
    specification,
    scenario,
    executionTargetProfile: { id: 'android' },
    adapter,
    applicationRevision: 'checkout-v1',
    executionCache: {
      store: cache.store,
      projectKey: 'project-1',
      sourceRunId: 'run-1',
    },
  }

  const adaptive = await runScenario(commonInput)
  const replay = await runScenario({
    ...commonInput,
    executionCache: { ...commonInput.executionCache, sourceRunId: 'run-2' },
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
  expect(opened.map((request) => request.mode)).toEqual(['adaptive', 'replay'])
  expect(opened[1]?.executionCache).toEqual({
    adapterPayload: payload,
    requiredVariables: ['product'],
  })
  expect(cache.writes).toHaveLength(1)
  expect(cache.writes[0]).toContain(productPlaceholder)
  expect(cache.writes[0]).not.toContain('Pickles')
})
