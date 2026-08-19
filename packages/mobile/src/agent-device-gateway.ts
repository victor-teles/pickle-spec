import {
  type AgentDeviceClientFactory,
  agentDeviceCapabilitiesSchema,
  androidAppStateSchema,
  androidDevicesSchema,
  defaultAgentDeviceClientFactory,
} from './agent-device-client'
import {
  type AgentDeviceStepSession,
  type ExecuteAgentDeviceStepInput,
  executeAgentDeviceStep,
} from './agent-device-step'
import type {
  AndroidApplication,
  AndroidTarget,
  WorkerStepExecution,
} from './worker-protocol'

export type {
  AgentDeviceClientFactory,
  AgentDeviceClientPort,
} from './agent-device-client'

export interface OpenGatewaySessionInput {
  sessionId: string
  targetId?: string
  application: AndroidApplication
  artifactDirectory?: string
}

function normalizedCapabilities(commands: readonly string[]): string[] {
  const capabilities = ['android', 'android-emulator']
  if (commands.includes('screenshot')) capabilities.push('screenshots')
  if (commands.includes('logs')) capabilities.push('device-logs')
  return capabilities
}

export class AgentDeviceGateway {
  private readonly createClient: AgentDeviceClientFactory
  private readonly sessions = new Map<string, AgentDeviceStepSession>()

  constructor(
    createClient: AgentDeviceClientFactory = defaultAgentDeviceClientFactory,
  ) {
    this.createClient = createClient
  }

  async discoverTargets(): Promise<AndroidTarget[]> {
    const client = this.createClient({
      session: 'pickle-mobile-discovery',
      lockPolicy: 'reject',
      lockPlatform: 'android',
    })
    try {
      const devices = androidDevicesSchema.parse(
        await client.devices.list({ platform: 'android' }),
      )
      const emulators = devices.filter((device) => device.kind === 'emulator')
      return await Promise.all(
        emulators.map(async (device) => {
          const result = agentDeviceCapabilitiesSchema.parse(
            await client.devices.capabilities({
              platform: 'android',
              serial: device.android.serial,
            }),
          )
          return {
            id: device.id,
            name: device.name,
            state: device.booted ? ('booted' as const) : ('offline' as const),
            capabilities: normalizedCapabilities(result.availableCommands),
          }
        }),
      )
    } finally {
      await client.sessions.close()
    }
  }

  async openSession(
    input: OpenGatewaySessionInput,
  ): Promise<{ targetId: string }> {
    if (this.sessions.has(input.sessionId)) {
      throw new Error(`Mobile logical session "${input.sessionId}" is open`)
    }
    const client = this.createClient({
      session: input.sessionId,
      lockPolicy: 'reject',
      lockPlatform: 'android',
    })
    const session: AgentDeviceStepSession = {
      artifactDirectory: input.artifactDirectory,
      client,
      serial: '',
    }
    this.sessions.set(input.sessionId, session)
    const ensureSessionOwned = () => {
      if (this.sessions.get(input.sessionId) !== session) {
        throw new DOMException('Aborted', 'AbortError')
      }
    }

    try {
      const devices = androidDevicesSchema.parse(
        await client.devices.list({ platform: 'android' }),
      )
      ensureSessionOwned()
      const target = devices.find(
        (device) =>
          device.kind === 'emulator' &&
          device.booted === true &&
          (input.targetId === undefined || device.id === input.targetId),
      )
      if (!target) {
        throw new Error(
          input.targetId
            ? `Booted Android Emulator target "${input.targetId}" was not found`
            : 'No booted Android Emulator target was found',
        )
      }

      session.serial = target.android.serial
      const selection = {
        platform: 'android' as const,
        serial: session.serial,
      }
      await client.apps.reinstall({
        ...selection,
        app: input.application.id,
        appPath: input.application.binaryPath,
      })
      ensureSessionOwned()
      await client.apps.open({
        ...selection,
        app: input.application.id,
      })
      ensureSessionOwned()
      const state = androidAppStateSchema.parse(
        await client.command.appState(selection),
      )
      ensureSessionOwned()
      if (state.package !== input.application.id) {
        throw new Error(
          `Android application reset verification failed: expected ${input.application.id}, found ${state.package}`,
        )
      }
      return { targetId: target.id }
    } catch (error) {
      await this.closeSession(input.sessionId).catch(() => {})
      throw error
    }
  }

  async executeStep(
    input: ExecuteAgentDeviceStepInput,
  ): Promise<WorkerStepExecution> {
    const session = this.sessions.get(input.sessionId)
    if (!session) {
      throw new Error(`Mobile logical session "${input.sessionId}" is not open`)
    }
    return executeAgentDeviceStep(input, session)
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    await session.client.sessions.close()
    if (this.sessions.get(sessionId) === session) {
      this.sessions.delete(sessionId)
    }
  }

  cancelSession(sessionId: string): Promise<void> {
    return this.closeSession(sessionId)
  }

  async dispose(): Promise<void> {
    const results = await Promise.allSettled(
      [...this.sessions.keys()].map((sessionId) =>
        this.closeSession(sessionId),
      ),
    )
    const errors = results
      .filter((result) => result.status === 'rejected')
      .map((result) => result.reason)
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Failed to close mobile sessions')
    }
  }
}
