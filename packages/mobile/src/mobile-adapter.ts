import type { ExecutionTargetAdapter } from '@pickle-spec/runner'
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

export interface MobileExecutionTargetAdapter extends ExecutionTargetAdapter {
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
      let stepIndex = 0
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
            plan: input.plan
              ? {
                  steps: input.plan.steps.map((step) => ({
                    resolvedActions: step.resolvedActions.map((action) => ({
                      ...action,
                    })),
                  })),
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
        async executeStep(step, signal) {
          const operationSignal = signal ?? input.signal
          const onOperationAbort = () => {
            void cancel().catch(() => {})
          }
          operationSignal?.addEventListener('abort', onOperationAbort, {
            once: true,
          })
          try {
            const stepResponse = await ensureWorker().request(
              {
                version: mobileWorkerProtocolVersion,
                type: 'execute-step',
                sessionId,
                stepIndex: stepIndex++,
                step: { type: step.type, text: step.text },
              },
              operationSignal,
            )
            if (stepResponse.type !== 'step-executed') {
              throw new Error(
                `Unexpected mobile worker response: ${stepResponse.type}`,
              )
            }
            return stepResponse.execution
          } finally {
            operationSignal?.removeEventListener('abort', onOperationAbort)
          }
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
