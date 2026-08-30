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
} from './worker-protocol.ts'
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
        return this.discoverTargets(request)
      case 'open-session':
        return this.openSession(request)
      case 'execute-scenario':
        return this.executeScenario(request)
      case 'complete-session':
        return this.completeSession(request)
      case 'close-session':
        return this.closeSession(request.sessionId)
      case 'cancel-session':
        return this.cancelSession(request.sessionId)
    }
  }

  private async discoverTargets(
    request: Extract<MobileWorkerRequest, { type: 'discover-targets' }>,
  ): Promise<MobileWorkerResponse> {
    return {
      version: mobileWorkerProtocolVersion,
      type: 'targets-discovered',
      targets: await this.gateway.discoverTargets(
        request.platform ?? 'android',
      ),
    }
  }

  private async openSession(
    request: Extract<MobileWorkerRequest, { type: 'open-session' }>,
  ): Promise<MobileWorkerResponse> {
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

  private requireSession(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Mobile logical session "${sessionId}" is not open`)
    }
  }

  private async executeScenario(
    request: Extract<MobileWorkerRequest, { type: 'execute-scenario' }>,
  ): Promise<MobileWorkerResponse> {
    this.requireSession(request.sessionId)
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

  private async completeSession(
    request: Extract<MobileWorkerRequest, { type: 'complete-session' }>,
  ): Promise<MobileWorkerResponse> {
    this.requireSession(request.sessionId)
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

  private async closeSession(sessionId: string): Promise<MobileWorkerResponse> {
    await this.serialize(sessionId, () => this.gateway.closeSession(sessionId))
    this.sessions.delete(sessionId)
    return {
      version: mobileWorkerProtocolVersion,
      type: 'session-closed',
      sessionId,
    }
  }

  private async cancelSession(
    sessionId: string,
  ): Promise<MobileWorkerResponse> {
    this.cancelling.add(sessionId)
    this.sessions.delete(sessionId)
    try {
      await (this.gateway.cancelSession?.(sessionId) ??
        this.gateway.closeSession(sessionId))
      await this.queues.get(sessionId)?.catch(() => {})
    } finally {
      this.queues.delete(sessionId)
      this.cancelling.delete(sessionId)
    }
    return {
      version: mobileWorkerProtocolVersion,
      type: 'session-cancelled',
      sessionId,
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
