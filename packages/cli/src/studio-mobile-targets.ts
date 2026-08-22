import {
  createMobileAdapter,
  type MobileAdapterOptions,
  type MobileExecutionTargetAdapter,
} from '@pickle-spec/mobile'
import type { ExecutionTargetAdapter } from '@pickle-spec/runner'
import type { StudioMobileTargetDiscovery } from '@pickle-spec/studio'
import type { PickleConfig } from './config'

export type StudioMobileAdapterFactory = (
  options: MobileAdapterOptions,
) => MobileExecutionTargetAdapter

const defaultMobileAdapterFactory: StudioMobileAdapterFactory = (options) =>
  createMobileAdapter(options)

function discoverableMobileAdapter(
  adapter: ExecutionTargetAdapter | undefined,
  profileId: string,
): MobileExecutionTargetAdapter | undefined {
  if (!adapter) return undefined
  if (
    'discoverTargets' in adapter &&
    typeof adapter.discoverTargets === 'function'
  ) {
    return adapter as MobileExecutionTargetAdapter
  }
  throw new Error(
    `Execution target profile "${profileId}" does not support mobile target discovery`,
  )
}

function errorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

export function configuredMobileAdapter(
  config: PickleConfig,
  profileId: string,
  createAdapter: StudioMobileAdapterFactory = defaultMobileAdapterFactory,
): MobileExecutionTargetAdapter {
  const profile = config.executionTargetProfiles?.[profileId]
  if (profile?.adapter !== 'mobile') {
    throw new Error(`Unknown mobile execution target profile "${profileId}"`)
  }
  if (!profile.mobile) {
    throw new Error(
      `Execution target profile "${profileId}" requires mobile application settings`,
    )
  }
  return createAdapter(profile.mobile)
}

export async function discoverStudioMobileTargets(
  config: PickleConfig,
  createAdapter: StudioMobileAdapterFactory = defaultMobileAdapterFactory,
  extensionAdapters?: Readonly<Record<string, ExecutionTargetAdapter>>,
  profileIds?: readonly string[],
): Promise<StudioMobileTargetDiscovery[]> {
  const discoveries: StudioMobileTargetDiscovery[] = []
  const selectedProfiles = profileIds?.length ? new Set(profileIds) : undefined
  for (const [profileId, profile] of Object.entries(
    config.executionTargetProfiles ?? {},
  )) {
    if (
      profile.adapter !== 'mobile' ||
      !profile.mobile ||
      (selectedProfiles && !selectedProfiles.has(profileId))
    ) {
      continue
    }
    const executionTarget = profile.mobile.executionTarget
    if (!executionTarget) continue
    let adapter: MobileExecutionTargetAdapter | undefined
    let ownsAdapter = false
    try {
      adapter = discoverableMobileAdapter(
        extensionAdapters?.[profileId] ?? extensionAdapters?.[profile.adapter],
        profileId,
      )
      if (!adapter) {
        adapter = configuredMobileAdapter(config, profileId, createAdapter)
        ownsAdapter = true
      }
      discoveries.push({
        profileId,
        executionTarget,
        targets: (await adapter.discoverTargets()).map((target) => ({
          id: target.id,
          name: target.name,
          state: target.state,
          capabilities: [...target.capabilities],
        })),
      })
    } catch (reason) {
      discoveries.push({
        profileId,
        executionTarget,
        targets: [],
        error: errorMessage(reason),
      })
    } finally {
      if (ownsAdapter) {
        try {
          await adapter?.dispose?.()
        } catch (reason) {
          const current = discoveries.at(-1)
          if (current?.profileId === profileId) {
            discoveries[discoveries.length - 1] = {
              ...current,
              error: errorMessage(reason),
            }
          }
        }
      }
    }
  }
  return discoveries
}

export function validateStudioMobileTargetCapabilities(
  config: PickleConfig,
  discoveries: readonly StudioMobileTargetDiscovery[],
  profileIds?: readonly string[],
): void {
  const selectedProfiles = new Set(
    profileIds?.length
      ? profileIds
      : Object.keys(config.executionTargetProfiles ?? {}),
  )
  for (const [profileId, profile] of Object.entries(
    config.executionTargetProfiles ?? {},
  )) {
    if (profile.adapter !== 'mobile' || !selectedProfiles.has(profileId)) {
      continue
    }
    const discovery = discoveries.find((item) => item.profileId === profileId)
    if (!discovery) {
      throw new Error(
        `Execution target profile "${profileId}" was not discovered before the test run`,
      )
    }
    if (discovery.error) throw new Error(discovery.error)
    const target = discovery.targets.find(
      (item) =>
        item.state === 'booted' &&
        (profile.mobile?.targetId === undefined ||
          item.id === profile.mobile.targetId),
    )
    if (!target) {
      const targetDescription = profile.mobile?.targetId
        ? `Booted mobile target "${profile.mobile.targetId}" was not found`
        : 'No booted mobile target was found'
      throw new Error(
        `${targetDescription} for execution target profile "${profileId}"`,
      )
    }
    const available = new Set(target.capabilities)
    const missing = (profile.capabilities ?? []).filter(
      (capability) => !available.has(capability),
    )
    if (missing.length > 0) {
      throw new Error(
        `Selected target "${target.name}" for execution target profile "${profileId}" lacks configured capabilities: ${missing.join(', ')}`,
      )
    }
  }
}
