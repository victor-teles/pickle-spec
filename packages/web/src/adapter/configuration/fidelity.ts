import type { FidelityPolicy } from '@pickle-spec/runner'
import type { WebAdapterOptions } from './web-options'

export type { FidelityPolicy }
export const blockedResourceTypes = ['image', 'media', 'font'] as const
export type BlockedResourceType = (typeof blockedResourceTypes)[number]

export interface ResolvedFidelity extends FidelityPolicy {
  blockResources: readonly BlockedResourceType[]
  disableAnimations: boolean
}

const defaultFastBlockedResources: BlockedResourceType[] = [
  'image',
  'media',
  'font',
]

export function resolveFidelityPolicy(
  options: WebAdapterOptions,
): ResolvedFidelity {
  const profile = options.profile ?? 'default'
  if (profile === 'default') {
    return {
      profile: 'default',
      tradeOffs: [],
      blockResources: [],
      disableAnimations: false,
    }
  }

  const blockResources =
    options.fidelity?.blockResources ?? defaultFastBlockedResources
  const disableAnimations = options.fidelity?.disableAnimations ?? true
  const tradeOffs: string[] = []
  for (const resource of blockResources) {
    tradeOffs.push(`block-${resource}`)
  }
  if (disableAnimations) tradeOffs.push('disable-animations')

  return {
    profile: 'fast',
    tradeOffs,
    blockResources,
    disableAnimations,
  }
}
