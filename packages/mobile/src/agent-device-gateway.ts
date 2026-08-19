import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createAgentDeviceClient, isAgentDeviceError } from 'agent-device'
import { z } from 'zod'
import type {
  AndroidApplication,
  AndroidTarget,
  MobileStep,
  WorkerResolvedAction,
  WorkerStepExecution,
} from './worker-protocol'

interface AgentDeviceClientConfig {
  session: string
  lockPolicy: 'reject'
  lockPlatform: 'android'
}

interface AndroidSelection {
  platform: 'android'
  serial: string
}

interface AppDeployOptions extends AndroidSelection {
  app: string
  appPath: string
}

interface AppOpenOptions extends AndroidSelection {
  app: string
}

interface ScreenshotOptions {
  path?: string
}

export interface AgentDeviceClientPort {
  devices: {
    list(options: { platform: 'android' }): Promise<unknown>
    capabilities(options: AndroidSelection): Promise<unknown>
  }
  apps: {
    reinstall(options: AppDeployOptions): Promise<unknown>
    open(options: AppOpenOptions): Promise<unknown>
  }
  command: {
    appState(options: AndroidSelection): Promise<unknown>
    wait(options: AndroidSelection & { text: string }): Promise<unknown>
  }
  interactions: {
    find(
      options: AndroidSelection & {
        query: string
        action: 'click'
      },
    ): Promise<unknown>
  }
  capture: {
    screenshot(options: ScreenshotOptions): Promise<unknown>
  }
  sessions: {
    close(): Promise<unknown>
  }
}

export type AgentDeviceClientFactory = (
  config: AgentDeviceClientConfig,
) => AgentDeviceClientPort

export interface OpenGatewaySessionInput {
  sessionId: string
  targetId?: string
  application: AndroidApplication
  artifactDirectory?: string
}

export interface ExecuteGatewayStepInput {
  sessionId: string
  stepIndex: number
  step: MobileStep
  plannedActions?: readonly WorkerResolvedAction[]
}

interface GatewaySession {
  application: AndroidApplication
  artifactDirectory?: string
  client: AgentDeviceClientPort
  serial: string
}

const androidDeviceSchema = z.strictObject({
  platform: z.literal('android'),
  target: z.literal('mobile'),
  kind: z.enum(['emulator', 'device']),
  id: z.string().min(1),
  name: z.string().min(1),
  booted: z.boolean().optional(),
  identifiers: z.record(z.string(), z.unknown()),
  android: z.strictObject({ serial: z.string().min(1) }),
})

const capabilitiesSchema = z.strictObject({
  device: androidDeviceSchema,
  availableCommands: z.array(z.string()),
})

const androidAppStateSchema = z.strictObject({
  platform: z.literal('android'),
  package: z.string(),
  activity: z.string(),
})

const replayActionSchema = z.strictObject({
  kind: z.literal('find'),
  query: z.string().min(1),
  action: z.enum(['click', 'wait']),
})

const screenshotResultSchema = z.object({ path: z.string().min(1) })

const defaultClientFactory: AgentDeviceClientFactory = (config) =>
  createAgentDeviceClient(config)

function normalizedCapabilities(commands: readonly string[]): string[] {
  const capabilities = ['android', 'android-emulator']
  if (commands.includes('screenshot')) capabilities.push('screenshots')
  if (commands.includes('logs')) capabilities.push('device-logs')
  return capabilities
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function isFunctionalFailure(error: unknown): boolean {
  return (
    isAgentDeviceError(error) &&
    ['AMBIGUOUS_MATCH', 'COMMAND_FAILED', 'REPLAY_DIVERGENCE'].includes(
      error.code,
    )
  )
}

export class AgentDeviceGateway {
  private readonly createClient: AgentDeviceClientFactory
  private readonly sessions = new Map<string, GatewaySession>()

  constructor(createClient: AgentDeviceClientFactory = defaultClientFactory) {
    this.createClient = createClient
  }

  async discoverTargets(): Promise<AndroidTarget[]> {
    const client = this.createClient({
      session: 'pickle-mobile-discovery',
      lockPolicy: 'reject',
      lockPlatform: 'android',
    })
    try {
      const devices = z
        .array(androidDeviceSchema)
        .parse(await client.devices.list({ platform: 'android' }))
      const emulators = devices.filter((device) => device.kind === 'emulator')
      return await Promise.all(
        emulators.map(async (device) => {
          const result = capabilitiesSchema.parse(
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
    const session = {
      application: input.application,
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
      const devices = z
        .array(androidDeviceSchema)
        .parse(await client.devices.list({ platform: 'android' }))
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
    input: ExecuteGatewayStepInput,
  ): Promise<WorkerStepExecution> {
    const session = this.sessions.get(input.sessionId)
    if (!session) {
      throw new Error(`Mobile logical session "${input.sessionId}" is not open`)
    }

    const selection = {
      platform: 'android' as const,
      serial: session.serial,
    }
    const execute = async (
      action: z.infer<typeof replayActionSchema>,
    ): Promise<void> => {
      if (action.action === 'wait') {
        await session.client.command.wait({
          ...selection,
          text: action.query,
        })
        return
      }
      await session.client.interactions.find({
        ...selection,
        query: action.query,
        action: 'click',
      })
    }
    const adaptiveAction = (): z.infer<typeof replayActionSchema> => ({
      kind: 'find',
      query: input.step.text,
      action: input.step.type === 'outcome' ? 'wait' : 'click',
    })
    const adaptiveDescription = () =>
      input.step.type === 'outcome'
        ? `Verify: ${input.step.text}`
        : `Tap: ${input.step.text}`

    let execution: WorkerStepExecution
    try {
      if (
        input.plannedActions !== undefined &&
        input.plannedActions.length > 0
      ) {
        try {
          const replayActions = input.plannedActions.map((action) => ({
            resolved: action,
            replay: replayActionSchema.parse(action.replay),
          }))
          for (const action of replayActions) await execute(action.replay)
          execution = {
            state: 'passed',
            resolvedActions: replayActions.map((action) => action.resolved),
          }
        } catch (error) {
          if (!isFunctionalFailure(error)) throw error
          const action = adaptiveAction()
          await execute(action)
          execution = {
            state: 'passed-with-adaptation',
            resolvedActions: [
              {
                description: adaptiveDescription(),
                replay: action,
              },
            ],
          }
        }
      } else {
        const action = adaptiveAction()
        await execute(action)
        execution = {
          state:
            input.plannedActions === undefined
              ? 'passed'
              : 'passed-with-adaptation',
          resolvedActions: [
            {
              description: adaptiveDescription(),
              replay: action,
            },
          ],
        }
      }
    } catch (error) {
      execution = {
        state: isFunctionalFailure(error) ? 'failed' : 'infrastructure-error',
        resolvedActions: [],
        message: errorMessage(error),
      }
    }

    try {
      const artifact = await this.captureScreenshot(input, session)
      return artifact ? { ...execution, artifacts: [artifact] } : execution
    } catch (error) {
      return {
        ...execution,
        state: 'infrastructure-error',
        message: `Screenshot capture failed: ${errorMessage(error)}`,
      }
    }
  }

  private async captureScreenshot(
    input: ExecuteGatewayStepInput,
    session: GatewaySession,
  ): Promise<
    | {
        kind: 'screenshot'
        path: string
        mediaType: 'image/png'
      }
    | undefined
  > {
    if (!session.artifactDirectory) return
    const directory = join(session.artifactDirectory, input.sessionId)
    await mkdir(directory, { recursive: true })
    const path = join(
      directory,
      `step-${String(input.stepIndex + 1).padStart(2, '0')}.png`,
    )
    const screenshot = screenshotResultSchema.parse(
      await session.client.capture.screenshot({ path }),
    )
    return {
      kind: 'screenshot',
      path: screenshot.path,
      mediaType: 'image/png',
    }
  }

  async closeSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return
    await session.client.sessions.close()
    if (this.sessions.get(sessionId) === session) {
      this.sessions.delete(sessionId)
    }
  }

  async cancelSession(sessionId: string): Promise<void> {
    await this.closeSession(sessionId)
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
