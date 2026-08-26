import { createAgentDeviceClient, isAgentDeviceError } from 'agent-device'
import { z } from 'zod'
import type { MobilePlatform } from '../worker/worker-protocol'

export interface AgentDeviceClientConfig {
  session: string
  lockPolicy: 'reject'
  lockPlatform: MobilePlatform
}

export interface AndroidSelection {
  platform: 'android'
  serial: string
}

export interface IosSelection {
  platform: 'ios'
  udid: string
}

export type MobileSelection = AndroidSelection | IosSelection

type AppDeployOptions = MobileSelection & {
  app: string
  appPath: string
}

type AppOpenOptions = MobileSelection & {
  app: string
}

type WaitOptions = MobileSelection & {
  text: string
}

type FindOptions = MobileSelection & {
  query: string
  action: 'click'
}

type ReplayRunOptions = MobileSelection & {
  path: string
  env?: string[]
}

interface LogsOptions {
  action: 'start' | 'stop' | 'path'
}

interface RecordingOptions {
  action: 'start' | 'stop'
  path?: string
}

export interface AgentDeviceClientPort {
  devices: {
    list(options: { platform: MobilePlatform }): Promise<unknown>
    capabilities(options: MobileSelection): Promise<unknown>
  }
  apps: {
    reinstall(options: AppDeployOptions): Promise<unknown>
    open(options: AppOpenOptions): Promise<unknown>
  }
  command: {
    appState(options: MobileSelection): Promise<unknown>
    wait(options: WaitOptions): Promise<unknown>
  }
  interactions: {
    find(options: FindOptions): Promise<unknown>
  }
  replay: {
    run(options: ReplayRunOptions): Promise<unknown>
  }
  capture: {
    screenshot(options: { path?: string }): Promise<unknown>
  }
  observability: {
    logs(options: LogsOptions): Promise<unknown>
  }
  recording: {
    record(options: RecordingOptions): Promise<unknown>
    trace(options: RecordingOptions): Promise<unknown>
  }
  sessions: {
    close(): Promise<unknown>
  }
  /** Counts semantic Agent Device routes invoked directly by Pickle code. */
  inferenceAudit: {
    count(): number
  }
}

export type UnobservedAgentDeviceClientPort = Omit<
  AgentDeviceClientPort,
  'inferenceAudit'
>

export type AgentDeviceClientFactory = (
  config: AgentDeviceClientConfig,
) => AgentDeviceClientPort

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

const iosDeviceSchema = z.strictObject({
  platform: z.literal('ios'),
  target: z.literal('mobile'),
  kind: z.enum(['simulator', 'device']),
  id: z.string().min(1),
  name: z.string().min(1),
  booted: z.boolean().optional(),
  appleOs: z.enum(['ios', 'ipados']).optional(),
  identifiers: z.record(z.string(), z.unknown()),
  ios: z.strictObject({ udid: z.string().min(1) }),
})

const mobileDeviceSchema = z.discriminatedUnion('platform', [
  androidDeviceSchema,
  iosDeviceSchema,
])

export const mobileDevicesSchema = z.array(mobileDeviceSchema)

export type AgentDeviceDevice = z.infer<typeof mobileDeviceSchema>

export const agentDeviceCapabilitiesSchema = z.strictObject({
  device: mobileDeviceSchema,
  availableCommands: z.array(z.string()),
})

const androidAppStateSchema = z.strictObject({
  platform: z.literal('android'),
  package: z.string(),
  activity: z.string(),
})

export const mobileAppStateSchema = z.discriminatedUnion('platform', [
  androidAppStateSchema,
  z.object({
    platform: z.literal('ios'),
    appName: z.string(),
    appBundleId: z.string().optional(),
    source: z.literal('session'),
    surface: z.string(),
  }),
])

export const agentDeviceLogPathSchema = z.object({
  path: z.string().min(1),
})

const functionalFailureCodes = new Set([
  'AMBIGUOUS_MATCH',
  'ELEMENT_NOT_FOUND',
  'ELEMENT_OFFSCREEN',
  'REPLAY_DIVERGENCE',
])

export function isFunctionalAgentDeviceFailure(error: unknown): boolean {
  return isAgentDeviceError(error) && functionalFailureCodes.has(error.code)
}

export function isAgentDeviceReplayDivergence(error: unknown): boolean {
  return isAgentDeviceError(error) && error.code === 'REPLAY_DIVERGENCE'
}

type ReplayDivergenceDetails = {
  divergence?: {
    step?: {
      index?: unknown
    }
  }
}

export function agentDeviceReplayPlanStep(error: unknown): number | undefined {
  if (!isAgentDeviceError(error) || error.code !== 'REPLAY_DIVERGENCE') {
    return undefined
  }
  const details = error.details as ReplayDivergenceDetails | undefined
  const index = details?.divergence?.step?.index
  return typeof index === 'number' && Number.isInteger(index) && index > 0
    ? index
    : undefined
}

export function observeAgentDeviceInferenceRoutes(
  client: UnobservedAgentDeviceClientPort,
): AgentDeviceClientPort {
  // replay.run stays outside this counter: its official `healed` result is the
  // native proof that Agent Device did not enter its internal repair route.
  let inferenceCount = 0
  return {
    ...client,
    command: {
      ...client.command,
      async wait(options) {
        inferenceCount++
        return client.command.wait(options)
      },
    },
    interactions: {
      ...client.interactions,
      async find(options) {
        inferenceCount++
        return client.interactions.find(options)
      },
    },
    inferenceAudit: {
      count: () => inferenceCount,
    },
  }
}

export const defaultAgentDeviceClientFactory: AgentDeviceClientFactory = (
  config,
) => observeAgentDeviceInferenceRoutes(createAgentDeviceClient(config))
