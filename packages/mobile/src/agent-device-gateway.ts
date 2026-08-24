import {
  type AgentDeviceClientFactory,
  type AgentDeviceDevice,
  agentDeviceCapabilitiesSchema,
  agentDeviceLogPathSchema,
  agentDeviceReplayPlanStep,
  defaultAgentDeviceClientFactory,
  isAgentDeviceReplayDivergence,
  type MobileSelection,
  mobileAppStateSchema,
  mobileDevicesSchema,
} from './agent-device-client'
import {
  finishScenarioEvidence,
  type MobileEvidenceAvailability,
  startScenarioEvidence,
} from './agent-device-evidence'
import { executePrivateAgentDeviceReplay } from './agent-device-replay'
import {
  type CompiledMobileScenario,
  compileMobileScenario,
} from './mobile-ad-script'
import {
  createMobileExecutionCache,
  type MobileExecutionCachePayload,
  mobileReplayVariableName,
} from './mobile-execution-cache'
import type {
  MobileApplication,
  MobileArtifactKind,
  MobilePlatform,
  MobileTarget,
  MobileTextRedaction,
  MobileWorkerScenario,
  WorkerScenarioExecution,
  WorkerSessionCompletion,
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
  mode: 'adaptive' | 'replay'
  scenario: MobileWorkerScenario
  executionCache?: {
    adapterPayload: MobileExecutionCachePayload
    requiredVariables: string[]
  }
}

interface GatewaySession {
  artifactDirectory?: string
  artifacts: ReadonlySet<MobileArtifactKind>
  client: import('./agent-device-client').AgentDeviceClientPort
  compiled: CompiledMobileScenario
  deviceLogPath?: string
  execution?: WorkerScenarioExecution
  evidenceAvailability: MobileEvidenceAvailability[]
  logsStarted: boolean
  mode: 'adaptive' | 'replay'
  redactions: readonly MobileTextRedaction[]
  requestedArtifacts: readonly MobileArtifactKind[]
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

function evidenceRedactions(
  input: OpenGatewaySessionInput,
): MobileTextRedaction[] {
  const redactions = [...(input.redactions ?? [])]
  const configuredValues = new Set(
    redactions.map((redaction) => redaction.match),
  )
  for (const binding of input.scenario.runtimeBindings) {
    if (!binding.value || configuredValues.has(binding.value)) continue
    configuredValues.add(binding.value)
    redactions.push({ match: binding.value })
  }
  return redactions
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

function runtimeEnvironment(
  requiredVariables: readonly string[],
  scenario: MobileWorkerScenario,
): string[] {
  const bindings = new Map(
    scenario.runtimeBindings.map((binding) => [binding.name, binding.value]),
  )
  return requiredVariables.map((name) => {
    const value = bindings.get(name)
    if (value === undefined) {
      throw new Error(`Mobile Replay binding "${name}" was not provided`)
    }
    return `${mobileReplayVariableName(name)}=${value}`
  })
}

function replayScenarioStepIndex(
  error: unknown,
  payload: MobileExecutionCachePayload,
): number {
  const planStep = agentDeviceReplayPlanStep(error)
  if (planStep === undefined) return 0
  const stepIndex = payload.stepRanges.findIndex(
    (range) => planStep >= range.from && planStep <= range.to,
  )
  if (stepIndex >= 0) return stepIndex
  if (planStep < (payload.stepRanges[0]?.from ?? Number.POSITIVE_INFINITY)) {
    return 0
  }
  return Math.max(0, payload.stepRanges.length - 1)
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
    const requestedArtifacts =
      input.artifacts ?? (input.artifactDirectory ? ['screenshot'] : [])
    const replayPayload = input.executionCache
      ? createMobileExecutionCache({
          platform,
          executionTarget:
            platform === 'ios' ? 'ios-simulator' : 'android-emulator',
          applicationId: input.application.id,
          targetId: input.targetId,
        }).parse(
          input.executionCache.adapterPayload,
          input.executionCache.requiredVariables,
        )
      : undefined
    if (input.executionCache && !replayPayload) {
      throw new Error('Mobile Replay cache payload is invalid')
    }
    const client = this.createClient({
      session: input.sessionId,
      lockPolicy: 'reject',
      lockPlatform: platform,
    })
    const session: GatewaySession = {
      artifactDirectory: input.artifactDirectory,
      artifacts: new Set(requestedArtifacts),
      client,
      compiled:
        input.executionCache && replayPayload
          ? {
              payload: replayPayload,
              requiredVariables: [...input.executionCache.requiredVariables],
              runtimeEnv: runtimeEnvironment(
                input.executionCache.requiredVariables,
                input.scenario,
              ),
              descriptions: input.scenario.templateSteps.map(
                (step) => `Replay: ${step.text}`,
              ),
            }
          : compileMobileScenario({
              platform,
              applicationId: input.application.id,
              scenario: input.scenario,
            }),
      logsStarted: false,
      mode: input.mode,
      redactions: evidenceRedactions(input),
      requestedArtifacts,
      evidenceAvailability: [],
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
        session.artifacts = new Set(
          requestedArtifacts.filter(
            (artifact) => !unsupportedArtifacts.includes(artifact),
          ),
        )
        session.evidenceAvailability = unsupportedArtifacts.map((kind) => ({
          kind,
          state: 'not-supported',
          message: `${policy.targetName} does not support ${kind} evidence`,
        }))
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

  async executeScenario(sessionId: string): Promise<WorkerScenarioExecution> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Mobile logical session "${sessionId}" is not open`)
    }
    if (!session.selection) {
      throw new Error(
        `Mobile logical session "${sessionId}" has no execution target`,
      )
    }
    if (session.execution) return session.execution
    const activeEvidence = await startScenarioEvidence(sessionId, session)
    try {
      await executePrivateAgentDeviceReplay({
        client: session.client,
        selection: session.selection,
        script: session.compiled.payload.script,
        runtimeEnv: session.compiled.runtimeEnv,
      })
      session.execution = {
        stepExecutions: session.compiled.descriptions.map((description) => ({
          state: 'passed',
          resolvedActions: [{ description }],
        })),
      }
    } catch (error) {
      if (!isAgentDeviceReplayDivergence(error)) throw error
      const failedStep = replayScenarioStepIndex(
        error,
        session.compiled.payload,
      )
      session.execution = {
        stepExecutions: session.compiled.descriptions
          .slice(0, failedStep + 1)
          .map((description, index) =>
            index === failedStep
              ? {
                  state: 'failed' as const,
                  resolvedActions: [{ description }],
                  replayDiverged: true,
                  message: `Agent Device Replay diverged at Scenario step ${failedStep + 1}`,
                }
              : {
                  state: 'passed' as const,
                  resolvedActions: [{ description }],
                },
          ),
        replayDiverged: true,
      }
    } finally {
      const finishedEvidence = await finishScenarioEvidence(
        session,
        activeEvidence,
      )
      const finalStep = session.execution?.stepExecutions.at(-1)
      if (finalStep) {
        if (finishedEvidence.artifacts.length > 0) {
          finalStep.artifacts = finishedEvidence.artifacts
        }
        const availability = [
          ...session.evidenceAvailability,
          ...finishedEvidence.availability,
        ]
        if (availability.length > 0) {
          const byKind = new Map(availability.map((item) => [item.kind, item]))
          finalStep.evidenceAvailability = session.requestedArtifacts.flatMap(
            (kind) => {
              const item = byKind.get(kind)
              return item ? [item] : []
            },
          )
        }
      }
    }
    return session.execution
  }

  async completeSession(sessionId: string): Promise<WorkerSessionCompletion> {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Mobile logical session "${sessionId}" is not open`)
    }
    if (!session.execution) {
      throw new Error(`Mobile logical session "${sessionId}" did not execute`)
    }
    if (session.mode === 'replay') return { inferenceCount: 0 }
    if (
      session.execution.replayDiverged ||
      session.execution.stepExecutions.length !==
        session.compiled.descriptions.length ||
      session.execution.stepExecutions.some(
        (execution) => execution.state !== 'passed',
      )
    ) {
      return { inferenceCount: 0 }
    }
    if (session.compiled.uncacheableReason) {
      return {
        inferenceCount: 0,
        replayRepresentation: {
          cacheable: false,
          reason: session.compiled.uncacheableReason,
        },
      }
    }
    return {
      inferenceCount: 0,
      replayRepresentation: {
        cacheable: true,
        adapterPayload: session.compiled.payload,
        requiredVariables: session.compiled.requiredVariables,
      },
    }
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
