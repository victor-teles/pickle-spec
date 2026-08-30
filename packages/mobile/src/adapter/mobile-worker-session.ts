import type { ScenarioTargetSession } from '@pickle-spec/runner'
import type { MobileWorkerClient } from '../worker/worker-client'
import type {
  MobileWorkerResponse,
  WorkerScenarioExecution,
  WorkerSessionCompletion,
} from '../worker/worker-protocol'
import { mobileWorkerProtocolVersion } from '../worker/worker-protocol'

type MobileWorkerResponseType = MobileWorkerResponse['type']
type ResponseOf<Type extends MobileWorkerResponseType> = Extract<
  MobileWorkerResponse,
  { type: Type }
>

export function expectWorkerResponse<Type extends MobileWorkerResponseType>(
  response: MobileWorkerResponse,
  type: Type,
): ResponseOf<Type> {
  if (response.type !== type) {
    throw new Error(`Unexpected mobile worker response: ${response.type}`)
  }
  return response as ResponseOf<Type>
}

export class MobileWorkerSession implements ScenarioTargetSession {
  private cancellationPromise?: Promise<void>
  private closePromise?: Promise<void>
  private cancelled = false

  private readonly onAbort = () => {
    void this.cancel().catch(() => {})
  }

  constructor(
    private readonly worker: MobileWorkerClient,
    private readonly sessionId: string,
    private readonly signal?: AbortSignal,
    private readonly unsubscribe: () => void = () => {},
  ) {
    if (signal?.aborted) this.onAbort()
    else signal?.addEventListener('abort', this.onAbort, { once: true })
  }

  async confirmOpened(response: MobileWorkerResponse): Promise<void> {
    if (this.cancelled) {
      await this.cancellationPromise
      throw new DOMException('Aborted', 'AbortError')
    }
    expectWorkerResponse(response, 'session-opened')
  }

  async handleOpenFailure(): Promise<void> {
    this.removeAbortListener()
    this.unsubscribe()
    if (this.cancelled) await this.cancellationPromise?.catch(() => {})
  }

  async executeScenario(
    signal?: AbortSignal,
  ): Promise<WorkerScenarioExecution> {
    const operationSignal = signal ?? this.signal
    const onOperationAbort = () => {
      void this.cancel().catch(() => {})
    }
    operationSignal?.addEventListener('abort', onOperationAbort, { once: true })
    try {
      const response = await this.worker.request(
        {
          version: mobileWorkerProtocolVersion,
          type: 'execute-scenario',
          sessionId: this.sessionId,
        },
        operationSignal,
      )
      return expectWorkerResponse(response, 'scenario-executed').execution
    } finally {
      operationSignal?.removeEventListener('abort', onOperationAbort)
    }
  }

  async complete(): Promise<WorkerSessionCompletion> {
    const response = await this.worker.request({
      version: mobileWorkerProtocolVersion,
      type: 'complete-session',
      sessionId: this.sessionId,
    })
    return expectWorkerResponse(response, 'session-completed').completion
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce()
    return this.closePromise
  }

  private async cancel(): Promise<void> {
    this.cancelled = true
    this.cancellationPromise ??= this.cancelOnce()
    return this.cancellationPromise
  }

  private async cancelOnce(): Promise<void> {
    try {
      const response = await this.worker.request({
        version: mobileWorkerProtocolVersion,
        type: 'cancel-session',
        sessionId: this.sessionId,
      })
      expectWorkerResponse(response, 'session-cancelled')
    } finally {
      this.unsubscribe()
    }
  }

  private async closeOnce(): Promise<void> {
    this.removeAbortListener()
    if (this.cancelled) {
      await this.cancellationPromise
      return
    }
    try {
      const response = await this.worker.request({
        version: mobileWorkerProtocolVersion,
        type: 'close-session',
        sessionId: this.sessionId,
      })
      expectWorkerResponse(response, 'session-closed')
    } finally {
      this.unsubscribe()
    }
  }

  private removeAbortListener(): void {
    this.signal?.removeEventListener('abort', this.onAbort)
  }
}
