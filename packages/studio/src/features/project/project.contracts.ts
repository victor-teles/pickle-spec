import type { StudioRunRequest } from '../runs/run.contracts'

export interface StudioScenario {
  id: string
  name: string
  canRun?: boolean
  readiness?: StudioRunReadiness
}

export interface StudioExternalLink {
  namespace: string
  id: string
}

export interface StudioSpecification {
  id: string
  name: string
  uri: string
  state?: 'draft' | 'active' | 'deprecated'
  tags?: readonly string[]
  links?: readonly StudioExternalLink[]
  canRun?: boolean
  runReasons?: readonly string[]
  scenarios: readonly StudioScenario[]
}

export interface StudioSuite {
  name: string
  paths?: string | readonly string[]
  tagExpression?: string
  states?: readonly ('draft' | 'active' | 'deprecated')[]
  scenarioName?: string
}

export interface StudioProfile {
  id: string
  adapter: string
  capabilities?: readonly string[]
  mobile?: StudioMobileProfile
}

export interface StudioMobileProfile {
  executionTarget: 'android-emulator' | 'ios-simulator'
  application: { id: string; binaryPath?: string }
  targetId?: string
  artifactDirectory?: string
  artifacts?: readonly ('screenshot' | 'trace' | 'recording' | 'device-log')[]
  redactions?: readonly { match: string; replacement?: string }[]
  nodePath?: string
}

export interface StudioMobileTarget {
  id: string
  name: string
  state: 'booted' | 'offline'
  capabilities: readonly string[]
}

export interface StudioMobileTargetDiscovery {
  profileId: string
  executionTarget: 'android-emulator' | 'ios-simulator'
  targets: readonly StudioMobileTarget[]
  error?: string
}

export interface StudioCredential {
  name: string
  present: boolean
}

export type StudioRunReadinessCheckId =
  | 'selection'
  | 'execution-target'
  | 'model-credential'
  | 'environment'

export type StudioRunReadinessCheck =
  | { id: StudioRunReadinessCheckId; status: 'ready' }
  | { id: StudioRunReadinessCheckId; status: 'not-applicable' }
  | {
      id: StudioRunReadinessCheckId
      status: 'blocked'
      reasons: readonly [string, ...string[]]
    }

export interface StudioRunReadiness {
  ready: boolean
  reasons: readonly string[]
  checks?: readonly StudioRunReadinessCheck[]
}

export interface StudioConfigPatch {
  suites?: Record<
    string,
    {
      paths?: string | readonly string[]
      tagExpression?: string
      states?: readonly ('draft' | 'active' | 'deprecated')[]
      scenarioName?: string
    }
  >
  executionTargetProfiles?: Record<
    string,
    {
      adapter: string
      capabilities?: readonly string[]
      mobile?: StudioMobileProfile
    }
  >
  links?: Record<string, string>
  secrets?: Record<string, { keychain: string }>
}

export interface StudioAuthoringModel {
  provider: string
  name: string
}

export interface StudioProject {
  name: string
  root: string
  profiles: readonly string[]
  suites: readonly string[]
  specifications: readonly StudioSpecification[]
  model?: StudioAuthoringModel
  links?: Readonly<Record<string, string>>
  suiteDetails?: readonly StudioSuite[]
  profileDetails?: readonly StudioProfile[]
  secrets?: readonly StudioCredential[]
  readiness?: StudioRunReadiness
}

export interface StudioAuthoringGateway {
  model: StudioAuthoringModel
  propose?: (input: {
    prompt: string
    currentSource?: string
  }) => Promise<{ source: string }>
}

export interface StudioManagementGateway {
  saveConfig(patch: StudioConfigPatch): Promise<StudioProject>
  saveCredential(input: {
    name: string
    secret: string
  }): Promise<StudioProject>
  readiness(request?: StudioRunRequest): Promise<StudioRunReadiness>
  discoverMobileTargets?(): Promise<readonly StudioMobileTargetDiscovery[]>
}
