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
  type MobileWorkerResponse,
  mobileWorkerProtocolVersion,
} from './worker-protocol'

export type { AndroidApplication, AndroidTarget }
export { androidCapabilities }

export interface MobileAdapterOptions {
  application: AndroidApplication
  targetId?: string
  artifactDirectory?: string
  nodePath?: string
}

export interface MobileExecutionTargetAdapter extends ExecutionTargetAdapter {
  discoverTargets(): Promise<AndroidTarget[]>
}

export function createMobileAdapter(
  options: MobileAdapterOptions,
  workerFactory?: MobileWorkerFactory,
): MobileExecutionTargetAdapter {
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
    capabilities: androidCapabilities,
    planFormatVersion: 'mobile.android.1',
    async discoverTargets() {
      const response = await ensureWorker().request({
        version: mobileWorkerProtocolVersion,
        type: 'discover-targets',
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
            targetId: options.targetId,
            application: options.application,
            mode: input.mode ?? 'adaptive',
            artifactDirectory: options.artifactDirectory,
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
