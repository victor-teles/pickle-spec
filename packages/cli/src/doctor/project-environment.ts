import {
  type DiagnoseMobileEnvironmentInput,
  diagnoseMobileEnvironment,
  type MobileEnvironmentAdapterFactory,
} from '@pickle-spec/mobile'
import type { EnvironmentDiagnostic } from '@pickle-spec/runner'
import {
  diagnoseWebEnvironment,
  type WebAdapterOptions,
  webEnvironmentProbeKey,
} from '@pickle-spec/web'
import type {
  PickleConfig,
  ProjectExecutionTargetProfile,
} from '../configuration/config'

type ProfileIdList = [string, ...string[]]

type UncheckedProfile = {
  kind: 'unchecked'
  profileId: string
}

export type EnvironmentProbe =
  | {
      key: string
      kind: 'web'
      profileIds: ProfileIdList
      options: WebAdapterOptions
    }
  | {
      key: string
      kind: 'mobile'
      profileIds: ProfileIdList
      input: DiagnoseMobileEnvironmentInput
    }

export interface ProjectEnvironmentPlan {
  probes: readonly EnvironmentProbe[]
  uncheckedProfileIds: readonly string[]
}

export interface ProfileEnvironmentDiagnostic {
  profileIds: readonly string[]
  diagnostic: EnvironmentDiagnostic
}

export interface ProjectEnvironmentReport {
  ready: boolean
  diagnostics: readonly ProfileEnvironmentDiagnostic[]
  uncheckedProfileIds: readonly string[]
}

export interface ProjectEnvironmentProbeFunctions {
  web: typeof diagnoseWebEnvironment
  mobile: typeof diagnoseMobileEnvironment
}

export interface DiagnoseProjectEnvironmentOptions {
  profileIds?: readonly string[]
  probes?: ProjectEnvironmentProbeFunctions
  mobileAdapterFactory?: (
    profileId: string,
  ) => MobileEnvironmentAdapterFactory | undefined
}

const defaultProbeFunctions: ProjectEnvironmentProbeFunctions = {
  web: diagnoseWebEnvironment,
  mobile: diagnoseMobileEnvironment,
}

interface ConfiguredProfile {
  id: string
  profile: ProjectExecutionTargetProfile
}

function configuredProfiles(config: PickleConfig): ConfiguredProfile[] {
  if (config.executionTargetProfiles) {
    return Object.entries(config.executionTargetProfiles).map(
      ([id, profile]) => ({ id, profile }),
    )
  }
  const configured = config.executionTargetProfile
  const adapter = configured?.adapter ?? (config.web ? 'web' : 'custom')
  return [
    {
      id: configured?.id ?? (config.web ? 'web' : 'custom'),
      profile: { adapter },
    },
  ]
}

function selectedProfiles(
  config: PickleConfig,
  profileIds?: readonly string[],
): ConfiguredProfile[] {
  const profiles = configuredProfiles(config)
  if (!profileIds?.length) return profiles
  const selected = new Set(profileIds)
  return profiles.filter(({ id }) => selected.has(id))
}

function webProbe(
  config: PickleConfig,
  profileId: string,
  profile: ProjectExecutionTargetProfile,
): EnvironmentProbe | undefined {
  const options = profile.web ?? config.web
  if (!options) return
  return {
    key: `web:${webEnvironmentProbeKey(options)}`,
    kind: 'web',
    profileIds: [profileId],
    options,
  }
}

function mobileProbe(
  profileId: string,
  profile: ProjectExecutionTargetProfile,
): EnvironmentProbe | undefined {
  if (!profile.mobile) return
  const requiredCapabilities = [...(profile.capabilities ?? [])].sort()
  const { executionTarget, nodePath, targetId } = profile.mobile
  return {
    key: `mobile:${profileId}:${executionTarget}:${nodePath ?? ''}:${targetId ?? ''}:${requiredCapabilities.join(',')}`,
    kind: 'mobile',
    profileIds: [profileId],
    input: { options: profile.mobile, requiredCapabilities },
  }
}

function addProbe(
  probes: Map<string, EnvironmentProbe>,
  probe: EnvironmentProbe,
): void {
  const existing = probes.get(probe.key)
  if (!existing) {
    probes.set(probe.key, probe)
    return
  }
  existing.profileIds.push(...probe.profileIds)
}

function planProfile(
  config: PickleConfig,
  configured: ConfiguredProfile,
): EnvironmentProbe | UncheckedProfile | undefined {
  const { id, profile } = configured
  if (profile.adapter === 'web') {
    return webProbe(config, id, profile) ?? { kind: 'unchecked', profileId: id }
  }
  if (profile.adapter === 'mobile') {
    return mobileProbe(id, profile) ?? { kind: 'unchecked', profileId: id }
  }
  return { kind: 'unchecked', profileId: id }
}

export function planProjectEnvironment(
  config: PickleConfig,
  profileIds?: readonly string[],
): ProjectEnvironmentPlan {
  const probes = new Map<string, EnvironmentProbe>()
  const uncheckedProfileIds: string[] = []
  for (const configured of selectedProfiles(config, profileIds)) {
    const item = planProfile(config, configured)
    if (!item) continue
    if (item.kind === 'unchecked') uncheckedProfileIds.push(item.profileId)
    else addProbe(probes, item)
  }
  return { probes: [...probes.values()], uncheckedProfileIds }
}

async function runProbe(
  probe: EnvironmentProbe,
  functions: ProjectEnvironmentProbeFunctions,
  options: DiagnoseProjectEnvironmentOptions,
): Promise<ProfileEnvironmentDiagnostic> {
  const diagnostic =
    probe.kind === 'web'
      ? await functions.web(probe.options)
      : await functions.mobile(
          probe.input,
          options.mobileAdapterFactory?.(probe.profileIds[0]),
        )
  return { profileIds: probe.profileIds, diagnostic }
}

export async function diagnoseProjectEnvironment(
  config: PickleConfig,
  options: DiagnoseProjectEnvironmentOptions = {},
): Promise<ProjectEnvironmentReport> {
  const plan = planProjectEnvironment(config, options.profileIds)
  const functions = options.probes ?? defaultProbeFunctions
  const diagnostics = await Promise.all(
    plan.probes.map((probe) => runProbe(probe, functions, options)),
  )
  return {
    ready: diagnostics.every(({ diagnostic }) => diagnostic.kind === 'ready'),
    diagnostics,
    uncheckedProfileIds: plan.uncheckedProfileIds,
  }
}
