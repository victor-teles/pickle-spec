import type { MobileExecutionCachePayload } from '../execution-cache/mobile-execution-cache'
import type {
  MobilePlatform,
  MobileTarget,
  WorkerScenarioExecution,
  WorkerSessionCompletion,
} from '../worker/worker-protocol'
import {
  type AgentDeviceClientFactory,
  agentDeviceCapabilitiesSchema,
  agentDeviceReplayPlanStep,
  defaultAgentDeviceClientFactory,
  isAgentDeviceReplayDivergence,
  mobileDevicesSchema,
} from './agent-device-client'
import {
  finishScenarioEvidence,
  startScenarioEvidence,
} from './agent-device-evidence'
import { executePrivateAgentDeviceReplay } from './agent-device-replay'
import {
  createGatewaySession,
  deviceSelection,
  type GatewaySession,
  initializeGatewaySession,
  mobilePlatformPolicies,
  normalizedCapabilities,
  type OpenGatewaySessionInput,
} from './agent-device-session'

export type {
  AgentDeviceClientFactory,
  AgentDeviceClientPort,
} from './agent-device-client'
export type { OpenGatewaySessionInput } from './agent-device-session'

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

function passedScenarioExecution(
  session: GatewaySession,
): WorkerScenarioExecution {
  return {
    stepExecutions: session.compiled.descriptions.map((description) => ({
      state: 'passed',
      resolvedActions: [{ description }],
    })),
  }
}

function divergentScenarioExecution(
  session: GatewaySession,
  error: unknown,
): WorkerScenarioExecution {
  const failedStep = replayScenarioStepIndex(error, session.compiled.payload)
  return {
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
}

function attachFinishedEvidence(
  session: GatewaySession,
  finished: Awaited<ReturnType<typeof finishScenarioEvidence>>,
): void {
  const finalStep = session.execution?.stepExecutions.at(-1)
  if (!finalStep) return
  if (finished.artifacts.length > 0) finalStep.artifacts = finished.artifacts
  const availability = [
    ...session.evidenceAvailability,
    ...finished.availability,
  ]
  if (availability.length === 0) return
  const byKind = new Map(availability.map((item) => [item.kind, item]))
  finalStep.evidenceAvailability = session.requestedArtifacts.flatMap(
    (kind) => {
      const item = byKind.get(kind)
      return item ? [item] : []
    },
  )
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
    if (this.sessions.has(input.sessionId)) {
      throw new Error(`Mobile logical session "${input.sessionId}" is open`)
    }
    const session = createGatewaySession(input, this.createClient)
    this.sessions.set(input.sessionId, session)
    const assertOwned = () => {
      if (this.sessions.get(input.sessionId) !== session) {
        throw new DOMException('Aborted', 'AbortError')
      }
    }

    try {
      const targetId = await initializeGatewaySession(
        input,
        session,
        assertOwned,
      )
      return { targetId }
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
      session.execution = passedScenarioExecution(session)
    } catch (error) {
      if (!isAgentDeviceReplayDivergence(error)) throw error
      session.execution = divergentScenarioExecution(session, error)
    } finally {
      const finishedEvidence = await finishScenarioEvidence(
        session,
        activeEvidence,
      )
      attachFinishedEvidence(session, finishedEvidence)
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
