import type { StudioApi } from '../../lib/studio-api'
import type { StudioMobileProfile } from '../../server/contracts'

export type StudioSuite = {
  name: string
  paths?: string | readonly string[]
  tagExpression?: string
  states?: readonly string[]
  scenarioName?: string
}

export type StudioProfile = {
  id: string
  adapter: string
  capabilities?: readonly string[]
  mobile?: StudioMobileProfile
}

export type StudioCredential = {
  name: string
  present: boolean
}

export type ConfigurableProject = {
  suiteDetails?: readonly StudioSuite[]
  profileDetails?: readonly StudioProfile[]
  secrets?: readonly StudioCredential[]
}

export type SettingsProps<T extends ConfigurableProject> = {
  project: T
  api: StudioApi
  onProject: (project: T) => void
  onError: (message: string | undefined) => void
}
