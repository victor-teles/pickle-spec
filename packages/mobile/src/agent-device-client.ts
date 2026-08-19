import { createAgentDeviceClient, isAgentDeviceError } from 'agent-device'
import { z } from 'zod'

export interface AgentDeviceClientConfig {
  session: string
  lockPolicy: 'reject'
  lockPlatform: 'android'
}

export interface AndroidSelection {
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

interface WaitOptions extends AndroidSelection {
  text: string
}

interface FindOptions extends AndroidSelection {
  query: string
  action: 'click'
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
    wait(options: WaitOptions): Promise<unknown>
  }
  interactions: {
    find(options: FindOptions): Promise<unknown>
  }
  capture: {
    screenshot(options: { path?: string }): Promise<unknown>
  }
  sessions: {
    close(): Promise<unknown>
  }
}

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

export const androidDevicesSchema = z.array(androidDeviceSchema)

export const agentDeviceCapabilitiesSchema = z.strictObject({
  device: androidDeviceSchema,
  availableCommands: z.array(z.string()),
})

export const androidAppStateSchema = z.strictObject({
  platform: z.literal('android'),
  package: z.string(),
  activity: z.string(),
})

const functionalFailureCodes = new Set([
  'AMBIGUOUS_MATCH',
  'COMMAND_FAILED',
  'REPLAY_DIVERGENCE',
])

export function isFunctionalAgentDeviceFailure(error: unknown): boolean {
  return isAgentDeviceError(error) && functionalFailureCodes.has(error.code)
}

export const defaultAgentDeviceClientFactory: AgentDeviceClientFactory = (
  config,
) => createAgentDeviceClient(config)
