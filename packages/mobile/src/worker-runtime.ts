import type {
  MobileApplication,
  MobileArtifactKind,
  MobilePlatform,
  MobileTarget,
  MobileTextRedaction,
  MobileWorkerRequest,
  MobileWorkerResponse,
  MobileWorkerScenario,
  WorkerScenarioExecution,
  WorkerSessionCompletion,
} from './worker-protocol'
import { mobileWorkerProtocolVersion } from './worker-protocol.ts'

export interface OpenMobileGatewaySessionInput {
  sessionId: string
  platform: MobilePlatform
  targetId?: string
  application: MobileApplication
  artifactDirectory?: string
  artifacts?: readonly MobileArtifactKind[]
  redactions?: readonly MobileTextRedaction[]
  requiredCapabilities?: readonly string[]
  mode: 'adaptive' | 'replay'
  scenario: MobileWorkerScenario
  executionCache?: Extract<
    MobileWorkerRequest,
    { type: 'open-session' }
  >['executionCache']
}

export interface MobileDeviceGateway {
  discoverTargets(platform: MobilePlatform): Promise<MobileTarget[]>
  openSession(
    input: OpenMobileGatewaySessionInput,
  ): Promise<{ targetId: string }>
  executeScenario(sessionId: string): Promise<WorkerScenarioExecution>
  completeSession(sessionId: string): Promise<WorkerSessionCompletion>
  closeSession(sessionId: string): Promise<void>
  cancelSession?(sessionId: string): Promise<void>
  dispose(): Promise<void>
}

export class MobileWorkerRuntime {
  private readonly gateway: MobileDeviceGateway
  private readonly sessions = new Set<string>()
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
          targets: await this.gateway.discoverTargets(
            request.platform ?? 'android',
          ),
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
          platform: request.platform ?? 'android',
          targetId: request.targetId,
          application: request.application,
          artifactDirectory: request.artifactDirectory,
          artifacts: request.artifacts,
          redactions: request.redactions,
          requiredCapabilities: request.requiredCapabilities,
          mode: request.mode,
          scenario: request.scenario,
          executionCache: request.executionCache,
        })
        this.sessions.add(request.sessionId)
        return {
          version: mobileWorkerProtocolVersion,
          type: 'session-opened',
          sessionId: request.sessionId,
          targetId: opened.targetId,
        }
      }
      case 'execute-scenario': {
        if (!this.sessions.has(request.sessionId)) {
          throw new Error(
            `Mobile logical session "${request.sessionId}" is not open`,
          )
        }
        const execution = await this.serialize(request.sessionId, () =>
          this.gateway.executeScenario(request.sessionId),
        )
        return {
          version: mobileWorkerProtocolVersion,
          type: 'scenario-executed',
          sessionId: request.sessionId,
          execution,
        }
      }
      case 'complete-session': {
        if (!this.sessions.has(request.sessionId)) {
          throw new Error(
            `Mobile logical session "${request.sessionId}" is not open`,
          )
        }
        const completion = await this.serialize(request.sessionId, () =>
          this.gateway.completeSession(request.sessionId),
        )
        return {
          version: mobileWorkerProtocolVersion,
          type: 'session-completed',
          sessionId: request.sessionId,
          completion,
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
