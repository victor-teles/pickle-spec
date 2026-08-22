import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assertNoProviderCredentials,
  openLocalExecutionCache,
  type ProviderCredentialEnvironment,
  runScenario,
} from '@pickle-spec/runner'
import { compileMobileScenario } from './mobile-ad-script'
import { createMobileAdapter } from './mobile-adapter'
import type { MobileBenchmarkMode } from './mobile-benchmark'
import type { MobileWorkerClient } from './worker-client'
import type { MobileWorkerRequest } from './worker-protocol'

export interface ControlledMobileBenchmarkEvidence {
  cacheEntries: number
  modes: Array<'adaptive' | 'replay'>
  scriptsMatched: boolean
}

export interface ControlledMobileBenchmarkDriver {
  measure(mode: MobileBenchmarkMode): Promise<number>
  evidence(): Promise<ControlledMobileBenchmarkEvidence>
  dispose(): Promise<void>
}

const applicationId = 'com.pickle-spec.benchmark'
const runtimeProduct = 'Pickles'
const templateSteps = Array.from({ length: 300 }, (_, index) =>
  index % 2 === 0
    ? {
        keyword: 'When',
        type: 'action' as const,
        text: `Buy <product> item ${index}`,
      }
    : {
        keyword: 'Then',
        type: 'outcome' as const,
        text: `visible: id="receipt-${index}"`,
      },
)
const steps = templateSteps.map((step) => ({
  ...step,
  text: step.text.replace('<product>', runtimeProduct),
}))
const runtimeBindings = [{ name: 'product', value: runtimeProduct }]
const specification = {
  id: 'spec-mobile-benchmark',
  name: 'Mobile benchmark',
  source: { uri: 'benchmark/mobile.feature', language: 'en' },
  tags: [],
  scenarios: [],
}
const scenario = {
  id: 'scenario-mobile-benchmark',
  name: 'Replay a complete mobile flow',
  tags: [],
  steps,
  template: {
    name: 'Replay a complete mobile flow',
    variableNames: ['product'],
    steps: templateSteps,
  },
  runtimeBindings,
}

export async function createControlledMobileBenchmarkDriver(
  environment: ProviderCredentialEnvironment = process.env,
): Promise<ControlledMobileBenchmarkDriver> {
  assertNoProviderCredentials(environment, 'Controlled mobile benchmark')
  const projectRoot = await mkdtemp(join(tmpdir(), 'pickle-mobile-benchmark-'))
  const cacheRoot = await mkdtemp(
    join(tmpdir(), 'pickle-mobile-benchmark-cache-'),
  )
  const opened = new Map<
    string,
    Extract<MobileWorkerRequest, { type: 'open-session' }>
  >()
  const executedAdaptive = new Map<
    string,
    ReturnType<typeof compileMobileScenario>
  >()
  const modes: Array<'adaptive' | 'replay'> = []
  let scriptsMatched = true
  let adaptiveScriptDigest: string | undefined
  let sourceRun = 0
  const worker: MobileWorkerClient = {
    async request(request) {
      switch (request.type) {
        case 'discover-targets':
          return { version: 3, type: 'targets-discovered', targets: [] }
        case 'open-session':
          opened.set(request.sessionId, request)
          modes.push(request.mode)
          return {
            version: 3,
            type: 'session-opened',
            sessionId: request.sessionId,
            targetId: 'controlled-emulator',
          }
        case 'execute-scenario': {
          const session = opened.get(request.sessionId)
          if (!session) throw new Error('Controlled mobile session is absent')
          const adaptive =
            session.mode === 'adaptive'
              ? compileMobileScenario({
                  platform: 'android',
                  applicationId,
                  scenario: session.scenario,
                })
              : undefined
          if (adaptive) executedAdaptive.set(request.sessionId, adaptive)
          const script =
            adaptive?.payload.script ??
            session.executionCache?.adapterPayload.script
          const digest =
            typeof script === 'string'
              ? createHash('sha256').update(script).digest('hex')
              : undefined
          if (session.mode === 'adaptive') adaptiveScriptDigest = digest
          else scriptsMatched &&= digest === adaptiveScriptDigest
          if (!scriptsMatched) {
            throw new Error('Controlled modes did not execute the same .ad')
          }
          return {
            version: 3,
            type: 'scenario-executed',
            sessionId: request.sessionId,
            execution: {
              stepExecutions: templateSteps.map((step) => ({
                state: 'passed' as const,
                resolvedActions: [{ description: step.text }],
              })),
            },
          }
        }
        case 'complete-session': {
          const session = opened.get(request.sessionId)
          if (!session) throw new Error('Controlled mobile session is absent')
          const adaptive = executedAdaptive.get(request.sessionId)
          if (session.mode === 'adaptive' && !adaptive) {
            throw new Error('Controlled Adaptive representation is absent')
          }
          return {
            version: 3,
            type: 'session-completed',
            sessionId: request.sessionId,
            completion:
              session.mode === 'adaptive'
                ? {
                    inferenceCount: 0,
                    replayRepresentation: {
                      cacheable: true as const,
                      adapterPayload: adaptive!.payload,
                      requiredVariables: adaptive!.requiredVariables,
                    },
                  }
                : { inferenceCount: 0 },
          }
        }
        case 'close-session':
          opened.delete(request.sessionId)
          executedAdaptive.delete(request.sessionId)
          return {
            version: 3,
            type: 'session-closed',
            sessionId: request.sessionId,
          }
        case 'cancel-session':
          opened.delete(request.sessionId)
          executedAdaptive.delete(request.sessionId)
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
        id: applicationId,
        binaryPath: '/controlled/mobile-benchmark.apk',
      },
      targetId: 'controlled-emulator',
    },
    () => worker,
  )
  const cache = await openLocalExecutionCache({ projectRoot, cacheRoot })

  return {
    async measure(mode) {
      const startedAt = performance.now()
      const run = await runScenario({
        specification,
        scenario,
        executionTargetProfile: { id: 'controlled-android' },
        adapter,
        applicationRevision: 'controlled-app-1',
        cachePolicy: mode === 'adaptive' ? 'refresh' : 'cache-only',
        executionCache: {
          store: cache,
          projectKey: cache.projectKey,
          sourceRunId: `mobile-benchmark-${++sourceRun}`,
        },
      })
      const expected =
        mode === 'adaptive'
          ? { executionMode: 'adaptive', cacheOutcome: 'refresh' }
          : {
              executionMode: 'replay',
              cacheOutcome: 'hit',
              inferenceCount: 0,
            }
      if (run.result.state !== 'passed') {
        throw new Error(
          `Controlled ${mode} run failed: ${run.result.message ?? run.result.state}`,
        )
      }
      for (const [field, value] of Object.entries(expected)) {
        if (run.result[field as keyof typeof run.result] !== value) {
          throw new Error(`Controlled ${mode} run reported invalid ${field}`)
        }
      }
      return performance.now() - startedAt
    },
    async evidence() {
      return {
        cacheEntries: (await cache.inspect()).length,
        modes: [...modes],
        scriptsMatched,
      }
    },
    async dispose() {
      try {
        await adapter.dispose?.()
      } finally {
        await Promise.all([
          rm(projectRoot, { recursive: true, force: true }),
          rm(cacheRoot, { recursive: true, force: true }),
        ])
      }
    },
  }
}
