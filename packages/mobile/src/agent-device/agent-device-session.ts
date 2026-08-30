import {
  createMobileExecutionCache,
  type MobileExecutionCachePayload,
  mobileReplayVariableName,
} from '../execution-cache/mobile-execution-cache.ts'
import type {
  MobileApplication,
  MobileArtifactKind,
  MobilePlatform,
  MobileTextRedaction,
  MobileWorkerScenario,
  WorkerScenarioExecution,
} from '../worker/worker-protocol.ts'
import {
  type AgentDeviceClientFactory,
  type AgentDeviceClientPort,
  type AgentDeviceDevice,
  agentDeviceCapabilitiesSchema,
  agentDeviceLogPathSchema,
  type MobileSelection,
  mobileAppStateSchema,
  mobileDevicesSchema,
} from './agent-device-client.ts'
import type { MobileEvidenceAvailability } from './agent-device-evidence.ts'
import type { MobileViewportController } from './agent-device-viewport.ts'
import {
  type CompiledMobileScenario,
  compileMobileScenario,
} from './mobile-ad-script.ts'

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

export interface GatewaySession {
  artifactDirectory?: string
  artifacts: ReadonlySet<MobileArtifactKind>
  client: AgentDeviceClientPort
  compiled: CompiledMobileScenario
  deviceLogPath?: string
  execution?: WorkerScenarioExecution
  evidenceAvailability: MobileEvidenceAvailability[]
  logsStarted: boolean
  mode: 'adaptive' | 'replay'
  redactions: readonly MobileTextRedaction[]
  requestedArtifacts: readonly MobileArtifactKind[]
  selection?: MobileSelection
  viewport?: MobileViewportController
}

export interface MobilePlatformPolicy {
  applicationName: string
  targetCapability: string
  targetKind: AgentDeviceDevice['kind']
  targetName: string
}

export const mobilePlatformPolicies: Record<
  MobilePlatform,
  MobilePlatformPolicy
> = {
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

export function normalizedCapabilities(
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

export function deviceSelection(device: AgentDeviceDevice): MobileSelection {
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

function replayScenario(
  input: OpenGatewaySessionInput,
  platform: MobilePlatform,
): CompiledMobileScenario | undefined {
  if (!input.executionCache) return undefined
  const payload = createMobileExecutionCache({
    platform,
    executionTarget: platform === 'ios' ? 'ios-simulator' : 'android-emulator',
    applicationId: input.application.id,
    targetId: input.targetId,
  }).parse(
    input.executionCache.adapterPayload,
    input.executionCache.requiredVariables,
  )
  if (!payload) throw new Error('Mobile Replay cache payload is invalid')
  return {
    payload,
    requiredVariables: [...input.executionCache.requiredVariables],
    runtimeEnv: runtimeEnvironment(
      input.executionCache.requiredVariables,
      input.scenario,
    ),
    descriptions: input.scenario.templateSteps.map(
      (step) => `Replay: ${step.text}`,
    ),
  }
}

export function createGatewaySession(
  input: OpenGatewaySessionInput,
  createClient: AgentDeviceClientFactory,
): GatewaySession {
  validateArtifactRedactions(input)
  const platform = input.platform ?? 'android'
  const requestedArtifacts =
    input.artifacts ?? (input.artifactDirectory ? ['screenshot'] : [])
  const replay = replayScenario(input, platform)
  return {
    artifactDirectory: input.artifactDirectory,
    artifacts: new Set(requestedArtifacts),
    client: createClient({
      session: input.sessionId,
      lockPolicy: 'reject',
      lockPlatform: platform,
    }),
    compiled:
      replay ??
      compileMobileScenario({
        platform,
        scenario: input.scenario,
      }),
    logsStarted: false,
    mode: input.mode,
    redactions: evidenceRedactions(input),
    requestedArtifacts,
    evidenceAvailability: [],
  }
}

function matchesTarget(
  device: AgentDeviceDevice,
  platform: MobilePlatform,
  policy: MobilePlatformPolicy,
  targetId: string | undefined,
): boolean {
  return (
    device.platform === platform &&
    device.kind === policy.targetKind &&
    device.booted === true &&
    (targetId === undefined || device.id === targetId)
  )
}

async function findTarget(
  input: OpenGatewaySessionInput,
  session: GatewaySession,
  platform: MobilePlatform,
  policy: MobilePlatformPolicy,
  assertOwned: () => void,
): Promise<AgentDeviceDevice> {
  const devices = mobileDevicesSchema.parse(
    await session.client.devices.list({ platform }),
  )
  assertOwned()
  const target = devices.find((device) =>
    matchesTarget(device, platform, policy, input.targetId),
  )
  if (target) return target
  throw new Error(
    input.targetId
      ? `Booted ${policy.targetName} target "${input.targetId}" was not found`
      : `No booted ${policy.targetName} target was found`,
  )
}

async function configureCapabilities(
  input: OpenGatewaySessionInput,
  session: GatewaySession,
  platform: MobilePlatform,
  policy: MobilePlatformPolicy,
  assertOwned: () => void,
): Promise<void> {
  const sessionState = session
  const needsCapabilities =
    sessionState.requestedArtifacts.length > 0 ||
    input.requiredCapabilities?.length
  if (!needsCapabilities || !sessionState.selection) return

  const result = agentDeviceCapabilitiesSchema.parse(
    await sessionState.client.devices.capabilities(sessionState.selection),
  )
  assertOwned()
  const unsupportedArtifacts = sessionState.requestedArtifacts.filter(
    (artifact) =>
      !result.availableCommands.includes(artifactCommands[artifact]),
  )
  const unsupportedArtifactKinds = new Set(unsupportedArtifacts)
  sessionState.artifacts = new Set(
    sessionState.requestedArtifacts.filter(
      (artifact) => !unsupportedArtifactKinds.has(artifact),
    ),
  )
  sessionState.evidenceAvailability = unsupportedArtifacts.map((kind) => ({
    kind,
    state: 'not-supported',
    message: `${policy.targetName} does not support ${kind} evidence`,
  }))

  const availableCapabilities = normalizedCapabilities(
    platform,
    result.availableCommands,
  )
  const unsupportedRequirements = (input.requiredCapabilities ?? []).filter(
    (capability) => !availableCapabilities.includes(capability),
  )
  if (unsupportedRequirements.length > 0) {
    throw new Error(
      `${policy.targetName} does not satisfy required capabilities: ${unsupportedRequirements.join(', ')}`,
    )
  }
}

async function resetApplication(
  input: OpenGatewaySessionInput,
  session: GatewaySession,
  platform: MobilePlatform,
  policy: MobilePlatformPolicy,
  assertOwned: () => void,
): Promise<void> {
  const selection = session.selection
  if (!selection) throw new Error('Mobile execution target was not selected')

  if (input.application.binaryPath) {
    await session.client.apps.reinstall({
      ...selection,
      app: input.application.id,
      appPath: input.application.binaryPath,
    })
    assertOwned()
  }
  await session.client.apps.open({ ...selection, app: input.application.id })
  assertOwned()
  const state = mobileAppStateSchema.parse(
    await session.client.command.appState(selection),
  )
  assertOwned()
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
}

async function startDeviceLogs(
  session: GatewaySession,
  assertOwned: () => void,
): Promise<void> {
  const sessionState = session
  if (
    !sessionState.artifactDirectory ||
    !sessionState.artifacts.has('device-log')
  )
    return
  await sessionState.client.observability.logs({ action: 'start' })
  sessionState.logsStarted = true
  assertOwned()
  const log = agentDeviceLogPathSchema.parse(
    await sessionState.client.observability.logs({ action: 'path' }),
  )
  sessionState.deviceLogPath = log.path
  assertOwned()
}

export async function initializeGatewaySession(
  input: OpenGatewaySessionInput,
  session: GatewaySession,
  assertOwned: () => void,
): Promise<string> {
  const sessionState = session
  const platform = input.platform ?? 'android'
  const policy = mobilePlatformPolicies[platform]
  const target = await findTarget(
    input,
    sessionState,
    platform,
    policy,
    assertOwned,
  )
  sessionState.selection = deviceSelection(target)
  await configureCapabilities(
    input,
    sessionState,
    platform,
    policy,
    assertOwned,
  )
  await resetApplication(input, sessionState, platform, policy, assertOwned)
  await startDeviceLogs(sessionState, assertOwned)
  return target.id
}
