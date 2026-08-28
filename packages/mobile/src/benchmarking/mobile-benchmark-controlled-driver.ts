import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  finalScenarioAttempt,
  openLocalExecutionCache,
  runScenario,
  type TestResult,
} from '@pickle-spec/runner'
import {
  assertNoProviderCredentials,
  type ProviderCredentialEnvironment,
} from '@pickle-spec/runner/benchmarking'
import { createMobileAdapter } from '../adapter/mobile-adapter'
import { compileMobileScenario } from '../agent-device/mobile-ad-script'
import { requiredValue } from '../required-value'
import type { MobileWorkerClient } from '../worker/worker-client'
import type { MobileWorkerRequest } from '../worker/worker-protocol'
import type { MobileBenchmarkMode } from './mobile-benchmark'

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

type OpenSessionRequest = Extract<MobileWorkerRequest, { type: 'open-session' }>
type ExecuteScenarioRequest = Extract<
  MobileWorkerRequest,
  { type: 'execute-scenario' }
>
type CompleteSessionRequest = Extract<
  MobileWorkerRequest,
  { type: 'complete-session' }
>

interface ControlledWorkerState {
  opened: Map<string, OpenSessionRequest>
  executedAdaptive: Map<string, ReturnType<typeof compileMobileScenario>>
  modes: Array<'adaptive' | 'replay'>
  scriptsMatched: boolean
  adaptiveScriptDigest?: string
}

function requireControlledSession(
  state: ControlledWorkerState,
  sessionId: string,
): OpenSessionRequest {
  const session = state.opened.get(sessionId)
  if (!session) throw new Error('Controlled mobile session is absent')
  return session
}

function digestScript(script: unknown): string | undefined {
  return typeof script === 'string'
    ? createHash('sha256').update(script).digest('hex')
    : undefined
}

function controlledScenarioExecution(
  state: ControlledWorkerState,
  request: ExecuteScenarioRequest,
) {
  const workerState = state
  const session = requireControlledSession(workerState, request.sessionId)
  const adaptive =
    session.mode === 'adaptive'
      ? compileMobileScenario({
          platform: 'android',
          applicationId,
          scenario: session.scenario,
        })
      : undefined
  if (adaptive) workerState.executedAdaptive.set(request.sessionId, adaptive)
  const script =
    adaptive?.payload.script ?? session.executionCache?.adapterPayload.script
  const digest = digestScript(script)
  if (session.mode === 'adaptive') workerState.adaptiveScriptDigest = digest
  else {
    workerState.scriptsMatched &&= digest === workerState.adaptiveScriptDigest
  }
  if (!workerState.scriptsMatched) {
    throw new Error('Controlled modes did not execute the same .ad')
  }
  return {
    version: 3 as const,
    type: 'scenario-executed' as const,
    sessionId: request.sessionId,
    execution: {
      stepExecutions: templateSteps.map((step) => ({
        state: 'passed' as const,
        resolvedActions: [{ description: step.text }],
      })),
    },
  }
}

function controlledSessionCompletion(
  state: ControlledWorkerState,
  request: CompleteSessionRequest,
) {
  const session = requireControlledSession(state, request.sessionId)
  const adaptive = state.executedAdaptive.get(request.sessionId)
  if (session.mode === 'adaptive' && !adaptive) {
    throw new Error('Controlled Adaptive representation is absent')
  }
  return {
    version: 3 as const,
    type: 'session-completed' as const,
    sessionId: request.sessionId,
    completion:
      session.mode === 'adaptive'
        ? {
            inferenceCount: 0,
            replayRepresentation: {
              cacheable: true as const,
              adapterPayload: requiredValue(adaptive).payload,
              requiredVariables: requiredValue(adaptive).requiredVariables,
            },
          }
        : { inferenceCount: 0 },
  }
}

function closeControlledSession(
  state: ControlledWorkerState,
  sessionId: string,
  type: 'session-closed' | 'session-cancelled',
) {
  state.opened.delete(sessionId)
  state.executedAdaptive.delete(sessionId)
  return { version: 3 as const, type, sessionId }
}

function createControlledWorker(
  state: ControlledWorkerState,
): MobileWorkerClient {
  return {
    async request(request) {
      switch (request.type) {
        case 'discover-targets':
          return { version: 3, type: 'targets-discovered', targets: [] }
        case 'open-session':
          state.opened.set(request.sessionId, request)
          state.modes.push(request.mode)
          return {
            version: 3,
            type: 'session-opened',
            sessionId: request.sessionId,
            targetId: 'controlled-emulator',
          }
        case 'execute-scenario':
          return controlledScenarioExecution(state, request)
        case 'complete-session':
          return controlledSessionCompletion(state, request)
        case 'close-session':
          return closeControlledSession(
            state,
            request.sessionId,
            'session-closed',
          )
        case 'cancel-session':
          return closeControlledSession(
            state,
            request.sessionId,
            'session-cancelled',
          )
      }
    },
    async dispose() {},
  }
}

function expectedAttemptFields(mode: MobileBenchmarkMode) {
  return mode === 'adaptive'
    ? { executionMode: 'adaptive', cacheOutcome: 'refresh' }
    : {
        executionMode: 'replay',
        cacheOutcome: 'hit',
        inferenceCount: 0,
      }
}

function assertControlledRun(
  mode: MobileBenchmarkMode,
  result: TestResult,
): void {
  const attempt = finalScenarioAttempt(result)
  if (result.state !== 'passed') {
    throw new Error(
      `Controlled ${mode} run failed: ${attempt.message ?? result.state}`,
    )
  }
  for (const [field, value] of Object.entries(expectedAttemptFields(mode))) {
    if (attempt[field as keyof typeof attempt] !== value) {
      throw new Error(`Controlled ${mode} run reported invalid ${field}`)
    }
  }
}

export async function createControlledMobileBenchmarkDriver(
  environment: ProviderCredentialEnvironment = process.env,
): Promise<ControlledMobileBenchmarkDriver> {
  assertNoProviderCredentials(environment, 'Controlled mobile benchmark')
  const projectRoot = await mkdtemp(join(tmpdir(), 'pickle-mobile-benchmark-'))
  const cacheRoot = await mkdtemp(
    join(tmpdir(), 'pickle-mobile-benchmark-cache-'),
  )
  const state: ControlledWorkerState = {
    opened: new Map(),
    executedAdaptive: new Map(),
    modes: [],
    scriptsMatched: true,
  }
  let sourceRun = 0
  const worker = createControlledWorker(state)
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
      assertControlledRun(mode, run.result)
      return performance.now() - startedAt
    },
    async evidence() {
      return {
        cacheEntries: (await cache.inspect()).length,
        modes: [...state.modes],
        scriptsMatched: state.scriptsMatched,
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
