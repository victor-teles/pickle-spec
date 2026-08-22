import type {
  ExecutionTargetAdapter,
  ScenarioTargetSession,
} from '@pickle-spec/runner'
import { createMobileExecutionCache } from './mobile-execution-cache'
import {
  createNodeWorkerClient,
  type MobileWorkerClient,
  type MobileWorkerFactory,
} from './worker-client'
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
  type MobileWorkerResponse,
  mobileWorkerProtocolVersion,
} from './worker-protocol'

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

interface ExecutionTargetPolicy {
  capabilities: readonly string[]
  planFormatVersion: string
  platform: MobilePlatform
}

const executionTargetPolicies = {
  'android-emulator': {
    capabilities: androidCapabilities,
    planFormatVersion: 'mobile.android.1',
    platform: 'android',
  },
  'ios-simulator': {
    capabilities: iosCapabilities,
    planFormatVersion: 'mobile.ios.1',
    platform: 'ios',
  },
} as const satisfies Record<string, ExecutionTargetPolicy>

export function createMobileAdapter(
  options: MobileAdapterOptions,
  workerFactory?: MobileWorkerFactory,
): MobileExecutionTargetAdapter {
  const policy =
    executionTargetPolicies[options.executionTarget ?? 'android-emulator']
  const executionTarget = options.executionTarget ?? 'android-emulator'
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
    planFormatVersion: policy.planFormatVersion,
    executionCache,
    async discoverTargets() {
      const response = await ensureWorker().request({
        version: mobileWorkerProtocolVersion,
        type: 'discover-targets',
        platform: policy.platform,
      })
      if (response.type !== 'targets-discovered') {
        throw new Error(`Unexpected mobile worker response: ${response.type}`)
      }
      return response.targets
    },
    async openSession(input) {
      const sessionId = crypto.randomUUID()
      let closePromise: Promise<void> | undefined
      let cancellationPromise: Promise<void> | undefined
      let cancelled = false
      const cancel = () => {
        cancelled = true
        cancellationPromise ??= (async () => {
          const cancelledResponse = await ensureWorker().request({
            version: mobileWorkerProtocolVersion,
            type: 'cancel-session',
            sessionId,
          })
          if (cancelledResponse.type !== 'session-cancelled') {
            throw new Error(
              `Unexpected mobile worker response: ${cancelledResponse.type}`,
            )
          }
        })()
        return cancellationPromise
      }
      const onAbort = () => {
        void cancel().catch(() => {})
      }
      if (input.signal?.aborted) void cancel().catch(() => {})
      else input.signal?.addEventListener('abort', onAbort, { once: true })

      let response: MobileWorkerResponse
      try {
        const templateSteps =
          input.scenarioTemplate?.steps ?? input.scenario.steps
        const replayPayload = input.executionCache
          ? executionCache.parse(
              input.executionCache.adapterPayload,
              input.executionCache.requiredVariables,
            )
          : undefined
        if (input.executionCache && !replayPayload) {
          throw new Error('Mobile Replay cache payload is invalid')
        }
        response = await ensureWorker().request(
          {
            version: mobileWorkerProtocolVersion,
            type: 'open-session',
            sessionId,
            platform: policy.platform,
            targetId: options.targetId,
            application: options.application,
            mode: input.mode ?? 'adaptive',
            artifactDirectory: options.artifactDirectory,
            artifacts: options.artifacts ? [...options.artifacts] : undefined,
            redactions: options.redactions
              ? options.redactions.map((redaction) => ({ ...redaction }))
              : undefined,
            requiredCapabilities: input.scenario.capabilityRequirements
              ? [...input.scenario.capabilityRequirements]
              : undefined,
            scenario: {
              steps: input.scenario.steps.map((step) => ({
                type: step.type,
                text: step.text,
                argument: step.argument,
              })),
              templateSteps: templateSteps.map((step) => ({
                type: step.type,
                text: step.text,
                argument: step.argument,
              })),
              runtimeBindings: (input.runtimeBindings ?? []).map((binding) => ({
                name: binding.name,
                value: binding.value,
              })),
            },
            executionCache: replayPayload
              ? {
                  adapterPayload: replayPayload,
                  requiredVariables: [
                    ...(input.executionCache?.requiredVariables ?? []),
                  ],
                }
              : undefined,
          },
          input.signal,
        )
      } catch (error) {
        input.signal?.removeEventListener('abort', onAbort)
        if (cancelled) await cancellationPromise?.catch(() => {})
        throw error
      }
      if (cancelled) {
        await cancellationPromise
        throw new DOMException('Aborted', 'AbortError')
      }
      if (response.type !== 'session-opened') {
        throw new Error(`Unexpected mobile worker response: ${response.type}`)
      }

      return {
        async executeScenario(signal) {
          const operationSignal = signal ?? input.signal
          const onOperationAbort = () => {
            void cancel().catch(() => {})
          }
          operationSignal?.addEventListener('abort', onOperationAbort, {
            once: true,
          })
          try {
            const scenarioResponse = await ensureWorker().request(
              {
                version: mobileWorkerProtocolVersion,
                type: 'execute-scenario',
                sessionId,
              },
              operationSignal,
            )
            if (scenarioResponse.type !== 'scenario-executed') {
              throw new Error(
                `Unexpected mobile worker response: ${scenarioResponse.type}`,
              )
            }
            return scenarioResponse.execution
          } finally {
            operationSignal?.removeEventListener('abort', onOperationAbort)
          }
        },
        async complete() {
          const completionResponse = await ensureWorker().request({
            version: mobileWorkerProtocolVersion,
            type: 'complete-session',
            sessionId,
          })
          if (completionResponse.type !== 'session-completed') {
            throw new Error(
              `Unexpected mobile worker response: ${completionResponse.type}`,
            )
          }
          return completionResponse.completion
        },
        close() {
          closePromise ??= (async () => {
            input.signal?.removeEventListener('abort', onAbort)
            if (cancelled) {
              await cancellationPromise
              return
            }
            const closed = await ensureWorker().request({
              version: mobileWorkerProtocolVersion,
              type: 'close-session',
              sessionId,
            })
            if (closed.type !== 'session-closed') {
              throw new Error(
                `Unexpected mobile worker response: ${closed.type}`,
              )
            }
          })()
          return closePromise
        },
      }
    },
    async dispose() {
      if (!worker) return
      await worker.dispose()
      worker = undefined
    },
  }
}
