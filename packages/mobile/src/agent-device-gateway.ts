import {
  type AgentDeviceClientFactory,
  type AgentDeviceDevice,
  agentDeviceCapabilitiesSchema,
  agentDeviceLogPathSchema,
  defaultAgentDeviceClientFactory,
  type MobileSelection,
  mobileAppStateSchema,
  mobileDevicesSchema,
} from './agent-device-client'
import {
  type AgentDeviceStepSession,
  type ExecuteAgentDeviceStepInput,
  executeAgentDeviceStep,
} from './agent-device-step'
import type {
  MobileApplication,
  MobileArtifactKind,
  MobilePlatform,
  MobileTarget,
  MobileTextRedaction,
  WorkerStepExecution,
} from './worker-protocol'

export type {
  AgentDeviceClientFactory,
  AgentDeviceClientPort,
} from './agent-device-client'

export interface OpenGatewaySessionInput {
  sessionId: string
  platform?: MobilePlatform
  targetId?: string
  application: MobileApplication
  artifactDirectory?: string
  artifacts?: readonly MobileArtifactKind[]
  redactions?: readonly MobileTextRedaction[]
  requiredCapabilities?: readonly string[]
}

interface GatewaySession {
  artifactDirectory?: string
  artifacts: ReadonlySet<MobileArtifactKind>
  client: AgentDeviceStepSession['client']
  deviceLogPath?: string
  logsStarted: boolean
  redactions: readonly MobileTextRedaction[]
  selection?: MobileSelection
}

interface MobilePlatformPolicy {
  applicationName: string
  targetCapability: string
  targetKind: AgentDeviceDevice['kind']
  targetName: string
}

const mobilePlatformPolicies: Record<MobilePlatform, MobilePlatformPolicy> = {
  android: {
    applicationName: 'Android application',
    targetCapability: 'android-emulator',
    targetKind: 'emulator',
    targetName: 'Android Emulator',
  },
  ios: {
    applicationName: 'iOS application',
    targetCapability: 'ios-simulator',
    targetKind: 'simulator',
    targetName: 'iOS Simulator',
  },
}

const artifactCommands: Record<MobileArtifactKind, string> = {
  screenshot: 'screenshot',
  'device-log': 'logs',
  recording: 'record',
  trace: 'trace',
}

const binaryArtifacts = new Set<MobileArtifactKind>([
  'screenshot',
  'recording',
  'trace',
])

function validateArtifactRedactions(input: OpenGatewaySessionInput): void {
  if (!input.redactions?.length) return
  const unsupported = (input.artifacts ?? ['screenshot']).filter((artifact) =>
    binaryArtifacts.has(artifact),
  )
  if (unsupported.length > 0) {
    throw new Error(
      `Binary mobile evidence cannot apply text redactions: ${unsupported.join(', ')}`,
    )
  }
}

function normalizedCapabilities(
  platform: MobilePlatform,
  commands: readonly string[],
): string[] {
  const capabilities = [
    platform,
    mobilePlatformPolicies[platform].targetCapability,
  ]
  if (commands.includes('screenshot')) capabilities.push('screenshots')
  if (commands.includes('logs')) capabilities.push('device-logs')
  if (commands.includes('record')) capabilities.push('recordings')
  if (commands.includes('trace')) capabilities.push('traces')
  return capabilities
}

function deviceSelection(device: AgentDeviceDevice): MobileSelection {
  return device.platform === 'ios'
    ? { platform: 'ios', udid: device.ios.udid }
    : { platform: 'android', serial: device.android.serial }
}

export class AgentDeviceGateway {
  private readonly createClient: AgentDeviceClientFactory
  private readonly sessions = new Map<string, GatewaySession>()

  constructor(
    createClient: AgentDeviceClientFactory = defaultAgentDeviceClientFactory,
  ) {
    this.createClient = createClient
  }

  async discoverTargets(
    platform: MobilePlatform = 'android',
  ): Promise<MobileTarget[]> {
    const policy = mobilePlatformPolicies[platform]
    const client = this.createClient({
      session: 'pickle-mobile-discovery',
      lockPolicy: 'reject',
      lockPlatform: platform,
    })
    try {
      const devices = mobileDevicesSchema.parse(
        await client.devices.list({ platform }),
      )
      const compatibleTargets = devices.filter(
        (device) =>
          device.platform === platform && device.kind === policy.targetKind,
      )
      return await Promise.all(
        compatibleTargets.map(async (device) => {
          const result = agentDeviceCapabilitiesSchema.parse(
            await client.devices.capabilities(deviceSelection(device)),
          )
          return {
            id: device.id,
            name: device.name,
            state: device.booted ? ('booted' as const) : ('offline' as const),
            capabilities: normalizedCapabilities(
              platform,
              result.availableCommands,
            ),
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
    validateArtifactRedactions(input)
    if (this.sessions.has(input.sessionId)) {
      throw new Error(`Mobile logical session "${input.sessionId}" is open`)
    }
    const platform = input.platform ?? 'android'
    const policy = mobilePlatformPolicies[platform]
    const client = this.createClient({
      session: input.sessionId,
      lockPolicy: 'reject',
      lockPlatform: platform,
    })
    const requestedArtifacts =
      input.artifacts ?? (input.artifactDirectory ? ['screenshot'] : [])
    const session: GatewaySession = {
      artifactDirectory: input.artifactDirectory,
      artifacts: new Set(requestedArtifacts),
      client,
      logsStarted: false,
      redactions: input.redactions ?? [],
    }
    this.sessions.set(input.sessionId, session)
    const ensureSessionOwned = () => {
      if (this.sessions.get(input.sessionId) !== session) {
        throw new DOMException('Aborted', 'AbortError')
      }
    }

    try {
      const devices = mobileDevicesSchema.parse(
        await client.devices.list({ platform }),
      )
      ensureSessionOwned()
      const target = devices.find(
        (device) =>
          device.platform === platform &&
          device.kind === policy.targetKind &&
          device.booted === true &&
          (input.targetId === undefined || device.id === input.targetId),
      )
      if (!target) {
        throw new Error(
          input.targetId
            ? `Booted ${policy.targetName} target "${input.targetId}" was not found`
            : `No booted ${policy.targetName} target was found`,
        )
      }

      const selection = deviceSelection(target)
      session.selection = selection
      if (requestedArtifacts.length > 0 || input.requiredCapabilities?.length) {
        const capabilityResult = agentDeviceCapabilitiesSchema.parse(
          await client.devices.capabilities(selection),
        )
        ensureSessionOwned()
        const unsupportedArtifacts = requestedArtifacts.filter(
          (artifact) =>
            !capabilityResult.availableCommands.includes(
              artifactCommands[artifact],
            ),
        )
        if (unsupportedArtifacts.length > 0) {
          throw new Error(
            `${policy.targetName} does not support requested evidence: ${unsupportedArtifacts.join(', ')}`,
          )
        }
        const targetCapabilities = normalizedCapabilities(
          platform,
          capabilityResult.availableCommands,
        )
        const unsupportedRequirements = (
          input.requiredCapabilities ?? []
        ).filter((capability) => !targetCapabilities.includes(capability))
        if (unsupportedRequirements.length > 0) {
          throw new Error(
            `${policy.targetName} does not satisfy required capabilities: ${unsupportedRequirements.join(', ')}`,
          )
        }
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
      const state = mobileAppStateSchema.parse(
        await client.command.appState(selection),
      )
      ensureSessionOwned()
      const runningApplicationId =
        state.platform === 'ios' ? state.appBundleId : state.package
      if (
        state.platform !== platform ||
        runningApplicationId !== input.application.id
      ) {
        throw new Error(
          `${policy.applicationName} reset verification failed: expected ${input.application.id}, found ${runningApplicationId ?? 'unknown'}`,
        )
      }
      if (session.artifactDirectory && session.artifacts.has('device-log')) {
        await client.observability.logs({ action: 'start' })
        session.logsStarted = true
        ensureSessionOwned()
        const log = agentDeviceLogPathSchema.parse(
          await client.observability.logs({ action: 'path' }),
        )
        session.deviceLogPath = log.path
        ensureSessionOwned()
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
    if (!session.selection) {
      throw new Error(
        `Mobile logical session "${input.sessionId}" has no execution target`,
      )
    }
    return executeAgentDeviceStep(input, {
      artifactDirectory: session.artifactDirectory,
      artifacts: session.artifacts,
      client: session.client,
      deviceLogPath: session.deviceLogPath,
      redactions: session.redactions,
      selection: session.selection,
    })
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    let logError: unknown
    if (session.logsStarted) {
      try {
        await session.client.observability.logs({ action: 'stop' })
        session.logsStarted = false
      } catch (error) {
        logError = error
      }
    }
    try {
      await session.client.sessions.close()
    } catch (error) {
      if (logError) {
        throw new AggregateError(
          [logError, error],
          'Failed to close mobile evidence and session',
        )
      }
      throw error
    }
    if (this.sessions.get(sessionId) === session) {
      this.sessions.delete(sessionId)
    }
    if (logError) throw logError
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
