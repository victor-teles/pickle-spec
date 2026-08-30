import type {
  ExecutionTargetAdapter,
  ExecutionTargetProfile,
  RunExtensions,
} from '@pickle-spec/runner'
import { resolveRunConfiguration } from '@pickle-spec/runner'
import {
  createWebAdapter,
  resolveWebArtifactCapture,
  type WebAdapterOptions,
} from '@pickle-spec/web'
import {
  hasBuiltInExecutionTarget,
  type PickleConfig,
  runConfigurationFrom,
} from '../../configuration/config'
import type { Extensions } from '../../extensions/extensions'
import { configuredMobileAdapter } from '../../studio/studio-mobile-targets'
import { loadExtensions } from './inputs'
import type { ProjectLiveViewportUpdate, ProjectRunOptions } from './types'

export type ResolvedProjectRunConfiguration = ReturnType<
  typeof resolveRunConfiguration
>

interface ProjectRunTargetContext {
  config: PickleConfig
  args: ProjectRunOptions
  extensions: Extensions
  onLiveViewport?: (update: ProjectLiveViewportUpdate) => void
}

interface ResolveProjectRunConfigurationInput {
  config: PickleConfig
  args: ProjectRunOptions
  applicationRevision: string | undefined
  profileIds: string[] | undefined
  root: string
  onLiveViewport?: (update: ProjectLiveViewportUpdate) => void
}

function configuredWebOptions(
  config: PickleConfig,
  args: ProjectRunOptions,
  profileId?: string,
): WebAdapterOptions | undefined {
  const profileWeb = profileId
    ? config.executionTargetProfiles?.[profileId]?.web
    : undefined
  const web = profileWeb ?? config.web
  if (!web) return undefined
  const profile = args.fast ? 'fast' : web.profile
  const headless = args.headed ? false : web.browser?.headless
  return {
    ...web,
    profile,
    browser: {
      ...web.browser,
      headless,
    },
    screenshots: {
      ...web.screenshots,
      mode: resolveWebArtifactCapture({
        screenshotMode: args.screenshotMode ?? web.screenshots?.mode,
        artifactsCapture: config.artifacts?.capture,
      }).screenshots,
    },
  }
}

function configuredAdapter(
  context: ProjectRunTargetContext,
  web: WebAdapterOptions | undefined,
): ExecutionTargetAdapter {
  if (context.extensions.adapter) return context.extensions.adapter
  if (!web) {
    throw new Error(
      'Configure web.baseUrl or export an adapter from pickle.extensions.ts',
    )
  }
  return createWebAdapter(web, context.extensions.webAutomationFactory, {
    onLiveViewport: context.onLiveViewport,
  })
}

function configuredAdapterForProfile(
  context: ProjectRunTargetContext,
  adapters: Record<string, ExecutionTargetAdapter>,
  profile: ExecutionTargetProfile,
): ExecutionTargetAdapter | undefined {
  const { args, config, extensions, onLiveViewport } = context
  if (adapters[profile.id]) return
  if (!hasBuiltInExecutionTarget(config, profile.id)) return
  if (profile.adapter === 'mobile') {
    if (adapters.mobile) return
    return configuredMobileAdapter(config, profile.id, undefined, {
      onLiveViewport,
    })
  }
  if (profile.adapter !== 'web') return
  if (adapters.web) return adapters.web
  const web = configuredWebOptions(config, args, profile.id)
  if (!web) {
    throw new Error(
      'Configure web.baseUrl or export an adapter from pickle.extensions.ts',
    )
  }
  return createWebAdapter(web, extensions.webAutomationFactory, {
    onLiveViewport,
  })
}

function configuredRunExtensions(
  context: ProjectRunTargetContext,
  profiles: readonly ExecutionTargetProfile[],
): RunExtensions {
  const { args, config, extensions } = context
  const adapters: Record<string, ExecutionTargetAdapter> = {
    ...extensions.adapters,
  }
  if (extensions.adapter) adapters.custom ??= extensions.adapter

  for (const profile of profiles) {
    const adapter = configuredAdapterForProfile(context, adapters, profile)
    if (adapter) adapters[profile.id] = adapter
  }

  return {
    adapter: profiles.some((profile) => profile.adapter)
      ? extensions.adapter
      : configuredAdapter(context, configuredWebOptions(config, args)),
    adapters,
  }
}

export async function resolveProjectRunConfiguration(
  input: ResolveProjectRunConfigurationInput,
): Promise<ResolvedProjectRunConfiguration> {
  const { applicationRevision, args, config, profileIds, root } = input
  const extensions = await loadExtensions(args.extensionsPath, root)
  const runConfiguration = {
    ...runConfigurationFrom(config, profileIds),
    concurrency: args.concurrency ?? config.concurrency,
    applicationRevision,
    execution: {
      infrastructureRetries:
        args.retries ?? config.execution?.infrastructureRetries,
      functionalRetries: config.execution?.functionalRetries,
      stepTimeoutMs: args.stepTimeoutMs ?? config.execution?.stepTimeoutMs,
      scenarioTimeoutMs:
        args.scenarioTimeoutMs ?? config.execution?.scenarioTimeoutMs,
    },
  }
  return resolveRunConfiguration(
    runConfiguration,
    configuredRunExtensions(
      {
        config,
        args,
        extensions,
        onLiveViewport: input.onLiveViewport,
      },
      runConfiguration.executionTargetProfiles ?? [],
    ),
  )
}

export async function disposeProjectRunTargets(
  targets: ResolvedProjectRunConfiguration['targets'],
): Promise<void> {
  const seen = new Set<ExecutionTargetAdapter>()
  for (const target of targets) {
    if (seen.has(target.adapter)) continue
    seen.add(target.adapter)
    await target.adapter.dispose?.()
  }
}
