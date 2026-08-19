import type {
  AndroidApplication,
  AndroidTarget,
  MobileStep,
  MobileWorkerRequest,
  MobileWorkerResponse,
  WorkerResolvedAction,
  WorkerStepExecution,
} from './worker-protocol'
import { mobileWorkerProtocolVersion } from './worker-protocol.ts'

export interface OpenMobileGatewaySessionInput {
  sessionId: string
  targetId?: string
  application: AndroidApplication
  artifactDirectory?: string
}

export interface ExecuteMobileGatewayStepInput {
  sessionId: string
  stepIndex: number
  step: MobileStep
  plannedActions?: readonly WorkerResolvedAction[]
}

export interface MobileDeviceGateway {
  discoverTargets(): Promise<AndroidTarget[]>
  openSession(
    input: OpenMobileGatewaySessionInput,
  ): Promise<{ targetId: string }>
  executeStep(
    input: ExecuteMobileGatewayStepInput,
  ): Promise<WorkerStepExecution>
  closeSession(sessionId: string): Promise<void>
  cancelSession?(sessionId: string): Promise<void>
  dispose(): Promise<void>
}

interface RuntimeSession {
  mode: 'adaptive' | 'replay'
  plan?: {
    steps: Array<{ resolvedActions: WorkerResolvedAction[] }>
  }
}

export class MobileWorkerRuntime {
  private readonly gateway: MobileDeviceGateway
  private readonly sessions = new Map<string, RuntimeSession>()
  private readonly queues = new Map<string, Promise<void>>()
  private readonly cancelling = new Set<string>()

  constructor(gateway: MobileDeviceGateway) {
    this.gateway = gateway
  }

  async handle(request: MobileWorkerRequest): Promise<MobileWorkerResponse> {
    switch (request.type) {
      case 'discover-targets':
        return {
          version: mobileWorkerProtocolVersion,
          type: 'targets-discovered',
          targets: await this.gateway.discoverTargets(),
        }
      case 'open-session': {
        if (
          this.sessions.has(request.sessionId) ||
          this.cancelling.has(request.sessionId)
        ) {
          throw new Error(
            `Mobile logical session "${request.sessionId}" is already active`,
          )
        }
        const opened = await this.gateway.openSession({
          sessionId: request.sessionId,
          targetId: request.targetId,
          application: request.application,
          artifactDirectory: request.artifactDirectory,
        })
        this.sessions.set(request.sessionId, {
          mode: request.mode,
          plan: request.plan,
        })
        return {
          version: mobileWorkerProtocolVersion,
          type: 'session-opened',
          sessionId: request.sessionId,
          targetId: opened.targetId,
        }
      }
      case 'execute-step': {
        const session = this.sessions.get(request.sessionId)
        if (!session) {
          throw new Error(
            `Mobile logical session "${request.sessionId}" is not open`,
          )
        }
        const execution = await this.serialize(request.sessionId, () =>
          this.gateway.executeStep({
            sessionId: request.sessionId,
            stepIndex: request.stepIndex,
            step: request.step,
            plannedActions:
              session.mode === 'replay'
                ? (session.plan?.steps[request.stepIndex]?.resolvedActions ??
                  [])
                : undefined,
          }),
        )
        return {
          version: mobileWorkerProtocolVersion,
          type: 'step-executed',
          sessionId: request.sessionId,
          execution,
        }
      }
      case 'close-session':
        await this.serialize(request.sessionId, () =>
          this.gateway.closeSession(request.sessionId),
        )
        this.sessions.delete(request.sessionId)
        return {
          version: mobileWorkerProtocolVersion,
          type: 'session-closed',
          sessionId: request.sessionId,
        }
      case 'cancel-session': {
        this.cancelling.add(request.sessionId)
        this.sessions.delete(request.sessionId)
        try {
          await (this.gateway.cancelSession?.(request.sessionId) ??
            this.gateway.closeSession(request.sessionId))
          await this.queues.get(request.sessionId)?.catch(() => {})
        } finally {
          this.queues.delete(request.sessionId)
          this.cancelling.delete(request.sessionId)
        }
        return {
          version: mobileWorkerProtocolVersion,
          type: 'session-cancelled',
          sessionId: request.sessionId,
        }
      }
    }
  }

  async dispose(): Promise<void> {
    this.sessions.clear()
    this.queues.clear()
    this.cancelling.clear()
    await this.gateway.dispose()
  }

  private async serialize<T>(
    sessionId: string,
    operation: () => Promise<T>,
  ): Promise<T> {
    const previous = this.queues.get(sessionId) ?? Promise.resolve()
    const current = previous.catch(() => {}).then(operation)
    const tail = current.then(
      () => {},
      () => {},
    )
    this.queues.set(sessionId, tail)
    try {
      return await current
    } finally {
      if (this.queues.get(sessionId) === tail) this.queues.delete(sessionId)
    }
  }
}
