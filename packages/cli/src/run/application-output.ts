import type { ExecutionTargetProfile } from '@pickle-spec/runner'
import type { PickleConfig } from '../configuration/config'
import type { ApplicationOutputStream } from '../server/server'

export type ApplicationOutputOptions = Partial<
  Record<ApplicationOutputStream, boolean>
>

export interface ResolvedApplicationOutput {
  capture: Record<ApplicationOutputStream, boolean>
  profiles: Record<ApplicationOutputStream, string[]>
}

const outputStreams = ['stdout', 'stderr'] as const

export function resolveApplicationOutput(
  config: PickleConfig,
  selectedProfiles: readonly ExecutionTargetProfile[],
  runOptions: ApplicationOutputOptions = {},
): ResolvedApplicationOutput {
  const profiles = {
    stdout: [] as string[],
    stderr: [] as string[],
  }

  for (const profile of selectedProfiles) {
    const configured = config.executionTargetProfiles?.[profile.id]
    for (const stream of outputStreams) {
      const enabled =
        runOptions[stream] ??
        configured?.applicationOutput?.[stream] ??
        config.server?.output?.[stream] ??
        false
      if (enabled) profiles[stream].push(profile.id)
    }
  }

  return {
    capture: {
      stdout: profiles.stdout.length > 0,
      stderr: profiles.stderr.length > 0,
    },
    profiles,
  }
}
