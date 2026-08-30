import type {
  ExecutionTargetAdapter,
  OpenSessionInput,
  ScenarioTargetSession,
} from '@pickle-spec/runner'
import { resolveScenarioId } from '@pickle-spec/spec'
import { createMobileExecutionCache } from '../execution-cache/mobile-execution-cache'
import {
  createNodeWorkerClient,
  type MobileWorkerClient,
  type MobileWorkerFactory,
} from '../worker/worker-client'
import {
  type AndroidApplication,
  type AndroidTarget,
  androidCapabilities,
  type IosApplication,
  type IosTarget,
  iosCapabilities,
  type MobileArtifactKind,
  type MobilePlatform,
  type MobileTextRedaction,
  type MobileWorkerEvent,
  type MobileWorkerRequest,
  mobileWorkerProtocolVersion,
} from '../worker/worker-protocol'
import {
  expectWorkerResponse,
  MobileWorkerSession,
} from './mobile-worker-session'

export type {
  AndroidApplication,
  AndroidTarget,
  IosApplication,
  IosTarget,
  MobileArtifactKind,
  MobileTextRedaction,
}
export { androidCapabilities, iosCapabilities }

interface MobileAdapterBaseOptions {
  targetId?: string
  artifactDirectory?: string
  artifacts?: readonly MobileArtifactKind[]
  redactions?: readonly MobileTextRedaction[]
  nodePath?: string
}

export interface AndroidMobileAdapterOptions extends MobileAdapterBaseOptions {
  executionTarget?: 'android-emulator'
  application: AndroidApplication
}

export interface IosMobileAdapterOptions extends MobileAdapterBaseOptions {
  executionTarget: 'ios-simulator'
  application: IosApplication
}

export type MobileAdapterOptions =
  | AndroidMobileAdapterOptions
  | IosMobileAdapterOptions

export interface MobileExecutionTargetAdapter
  extends ExecutionTargetAdapter<ScenarioTargetSession> {
  discoverTargets(): Promise<Array<AndroidTarget | IosTarget>>
}

export type MobileLiveViewportTarget = {
  scenarioId: string
  examplesRowId?: string
  profileId: string
  attempt?: number
}

export type MobileLiveViewportUpdate =
  | {
      kind: 'device-frame'
      data: string
      mimeType: 'image/png'
      width?: number
      height?: number
      target: MobileLiveViewportTarget
    }
  | { kind: 'closed'; target: MobileLiveViewportTarget }

export interface MobileAdapterBehavior {
  onLiveViewport?: (update: MobileLiveViewportUpdate) => void
}

interface ExecutionTargetPolicy {
  capabilities: readonly string[]
  platform: MobilePlatform
}

const executionTargetPolicies = {
  'android-emulator': {
    capabilities: androidCapabilities,
    platform: 'android',
  },
  'ios-simulator': {
    capabilities: iosCapabilities,
    platform: 'ios',
  },
} as const satisfies Record<string, ExecutionTargetPolicy>

type OpenSessionRequest = Extract<MobileWorkerRequest, { type: 'open-session' }>
type ScenarioStep = OpenSessionInput['scenario']['steps'][number]

function mobileLiveViewportTarget(
  input: OpenSessionInput,
): MobileLiveViewportTarget {
  return {
    scenarioId:
      input.scenario.id ??
      resolveScenarioId(
        input.specification.source.uri,
        input.specification.name,
        input.scenario.template?.name ?? input.scenario.name,
        input.scenario.tags,
      ),
    examplesRowId: input.scenario.examplesRowId,
    profileId: input.executionTargetProfile.id,
  }
}

function subscribeLiveViewport(input: {
  behavior: MobileAdapterBehavior
  sessionId: string
  target: MobileLiveViewportTarget
  worker: MobileWorkerClient
}): () => void {
  return input.worker.subscribe((event: MobileWorkerEvent) => {
    if (event.sessionId !== input.sessionId) return
    if (event.type === 'viewport-closed') {
      input.behavior.onLiveViewport?.({ kind: 'closed', target: input.target })
      return
    }
    input.behavior.onLiveViewport?.({
      ...event.frame,
      kind: 'device-frame',
      target: input.target,
    })
  })
}

function workerStep(
  step: ScenarioStep,
): OpenSessionRequest['scenario']['steps'][number] {
  return {
    type: step.type,
    text: step.text,
    argument: step.argument,
  }
}

function openSessionRequest(
  input: OpenSessionInput,
  options: MobileAdapterOptions,
  platform: MobilePlatform,
  executionCache: ReturnType<typeof createMobileExecutionCache>,
  sessionId: string,
): OpenSessionRequest {
  const replayCache = input.executionCache
  const replayPayload = replayCache
    ? executionCache.parse(
        replayCache.adapterPayload,
        replayCache.requiredVariables,
      )
    : undefined
  if (replayCache && !replayPayload) {
    throw new Error('Mobile Replay cache payload is invalid')
  }

  const templateSteps = input.scenarioTemplate?.steps ?? input.scenario.steps
  return {
    version: mobileWorkerProtocolVersion,
    type: 'open-session',
    sessionId,
    platform,
    targetId: options.targetId,
    application: options.application,
    mode: input.mode ?? 'adaptive',
    artifactDirectory: options.artifactDirectory,
    artifacts: options.artifacts ? [...options.artifacts] : undefined,
    redactions: options.redactions?.map((redaction) => ({ ...redaction })),
    requiredCapabilities: input.scenario.capabilityRequirements
      ? [...input.scenario.capabilityRequirements]
      : undefined,
    scenario: {
      steps: input.scenario.steps.map(workerStep),
      templateSteps: templateSteps.map(workerStep),
      runtimeBindings: (input.runtimeBindings ?? []).map((binding) => ({
        name: binding.name,
        value: binding.value,
      })),
    },
    executionCache:
      replayPayload && replayCache
        ? {
            adapterPayload: replayPayload,
            requiredVariables: [...replayCache.requiredVariables],
          }
        : undefined,
  }
}

async function openMobileSession(input: {
  behavior: MobileAdapterBehavior
  executionCache: ReturnType<typeof createMobileExecutionCache>
  openSession: OpenSessionInput
  options: MobileAdapterOptions
  platform: MobilePlatform
  worker: MobileWorkerClient
}): Promise<MobileWorkerSession> {
  const sessionId = crypto.randomUUID()
  const unsubscribe = subscribeLiveViewport({
    behavior: input.behavior,
    sessionId,
    target: mobileLiveViewportTarget(input.openSession),
    worker: input.worker,
  })
  const session = new MobileWorkerSession(
    input.worker,
    sessionId,
    input.openSession.signal,
    unsubscribe,
  )
  try {
    const response = await input.worker.request(
      openSessionRequest(
        input.openSession,
        input.options,
        input.platform,
        input.executionCache,
        sessionId,
      ),
      input.openSession.signal,
    )
    await session.confirmOpened(response)
  } catch (error) {
    await session.handleOpenFailure()
    throw error
  }
  return session
}

export function createMobileAdapter(
  options: MobileAdapterOptions,
  workerFactory?: MobileWorkerFactory,
  behavior: MobileAdapterBehavior = {},
): MobileExecutionTargetAdapter {
  const executionTarget = options.executionTarget ?? 'android-emulator'
  const policy = executionTargetPolicies[executionTarget]
  const executionCache = createMobileExecutionCache({
    platform: policy.platform,
    executionTarget,
    applicationId: options.application.id,
    targetId: options.targetId,
  })
  let worker: MobileWorkerClient | undefined
  const ensureWorker = () => {
    worker ??=
      workerFactory?.() ??
      createNodeWorkerClient({
        nodePath: options.nodePath,
      })
    return worker
  }

  return {
    capabilities: policy.capabilities,
    executionCache,
    async discoverTargets() {
      const response = await ensureWorker().request({
        version: mobileWorkerProtocolVersion,
        type: 'discover-targets',
        platform: policy.platform,
      })
      return expectWorkerResponse(response, 'targets-discovered').targets
    },
    async openSession(input) {
      return openMobileSession({
        behavior,
        executionCache,
        openSession: input,
        options,
        platform: policy.platform,
        worker: ensureWorker(),
      })
    },
    async dispose() {
      if (!worker) return
      await worker.dispose()
      worker = undefined
    },
  }
}
