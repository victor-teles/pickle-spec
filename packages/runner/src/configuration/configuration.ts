import {
  optionalPositiveInteger,
  parseConfiguration,
  strictObject,
} from '@pickle-spec/configuration'
import { z } from 'zod'
import type {
  ExecutionPolicy,
  ExecutionTargetAdapter,
  ExecutionTargetProfile,
} from '../execution/run-scenario'
import type { RunTarget } from '../execution/run-scenarios'

export interface ExecutionSettings {
  infrastructureRetries?: number
  functionalRetries?: number
  scenarioTimeoutMs?: number
  stepTimeoutMs?: number
}

export interface RunConfiguration {
  schemaVersion: 1
  executionTargetProfile?: ExecutionTargetProfile
  executionTargetProfiles?: ExecutionTargetProfile[]
  applicationRevision?: string
  concurrency?: number
  execution?: ExecutionSettings
}

export interface RunExtensions {
  adapter?: ExecutionTargetAdapter
  adapters?: Record<string, ExecutionTargetAdapter>
}

export interface RunExtensionManifest {
  adapterAvailable: boolean
  fallbackAdapterAvailable: boolean
}

export interface ResolvedRunConfiguration extends ExecutionPolicy {
  adapter: ExecutionTargetAdapter
  executionTargetProfile: ExecutionTargetProfile
  targets: RunTarget[]
  concurrency: number
  applicationRevision?: string
}

function nonemptyString(field: string) {
  return z
    .string({ error: `${field} must not be empty` })
    .refine((value) => value.trim().length > 0, {
      error: `${field} must not be empty`,
    })
}

function optionalNonNegativeInteger(field: string) {
  return z
    .number({ error: `${field} must be a non-negative integer` })
    .int({ error: `${field} must be a non-negative integer` })
    .min(0, { error: `${field} must be a non-negative integer` })
    .optional()
}

function capabilitiesSchema(field: string) {
  return z
    .array(
      z.string().refine((item) => item.trim().length > 0, {
        error: `${field} must not contain an empty capability`,
      }),
      { error: `${field} must contain at least one capability` },
    )
    .min(1, { error: `${field} must contain at least one capability` })
}

function executionTargetProfileSchema(field: string) {
  return strictObject(field, {
    id: nonemptyString(`${field}.id`),
    adapter: nonemptyString(`${field}.adapter`).optional(),
    capabilities: capabilitiesSchema(`${field}.capabilities`).optional(),
  })
}

export const executionSettingsSchema = strictObject('execution', {
  infrastructureRetries: optionalNonNegativeInteger(
    'execution.infrastructureRetries',
  ),
  functionalRetries: optionalNonNegativeInteger('execution.functionalRetries'),
  scenarioTimeoutMs: optionalPositiveInteger('execution.scenarioTimeoutMs'),
  stepTimeoutMs: optionalPositiveInteger('execution.stepTimeoutMs'),
})

export const runConfigurationSchema = strictObject('run configuration', {
  schemaVersion: z.number(),
  executionTargetProfile: executionTargetProfileSchema(
    'executionTargetProfile',
  ).optional(),
  executionTargetProfiles: z
    .array(executionTargetProfileSchema('executionTargetProfiles'), {
      error:
        'executionTargetProfiles must contain at least one execution target profile',
    })
    .min(1, {
      error:
        'executionTargetProfiles must contain at least one execution target profile',
    })
    .optional(),
  applicationRevision: nonemptyString('applicationRevision').optional(),
  concurrency: optionalPositiveInteger('concurrency'),
  execution: executionSettingsSchema.optional(),
})
  .refine(
    (configuration) =>
      configuration.executionTargetProfile !== undefined ||
      configuration.executionTargetProfiles !== undefined,
    {
      error: 'executionTargetProfile or executionTargetProfiles is required',
    },
  )
  .superRefine((configuration, context) => {
    if (configuration.schemaVersion === 1) return
    context.addIssue({
      code: 'custom',
      message: `Unsupported configuration schemaVersion: ${String(configuration.schemaVersion)}`,
    })
  })
  .transform((configuration) => ({
    ...configuration,
    schemaVersion: 1 as const,
  }))

export function validateRunConfiguration(value: unknown): RunConfiguration {
  return parseConfiguration(
    runConfigurationSchema,
    value,
    'Invalid run configuration',
  )
}

function configuredProfiles(
  configuration: RunConfiguration,
): ExecutionTargetProfile[] {
  if (configuration.executionTargetProfiles?.length) {
    return configuration.executionTargetProfiles
  }
  if (configuration.executionTargetProfile) {
    return [configuration.executionTargetProfile]
  }
  throw new Error(
    'executionTargetProfile or executionTargetProfiles is required',
  )
}

function isAdapter(
  value: ExecutionTargetAdapter | undefined,
): value is ExecutionTargetAdapter {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof value.openSession === 'function'
  )
}

function adapterForProfile(
  profile: ExecutionTargetProfile,
  extensions: RunExtensions,
): ExecutionTargetAdapter {
  const resolved = profile.adapter
    ? (extensions.adapters?.[profile.id] ??
      extensions.adapters?.[profile.adapter])
    : extensions.adapter
  if (!isAdapter(resolved)) {
    throw new Error(
      `Execution target profile "${profile.id}" requires adapter ` +
        `"${profile.adapter ?? 'custom'}". Import it from pickle.extensions.ts.`,
    )
  }
  return resolved
}

function assertProfileCapabilities(
  profile: ExecutionTargetProfile,
  adapter: ExecutionTargetAdapter,
): void {
  const adapterCapabilities = adapter.capabilities
  if (!profile.capabilities || !adapterCapabilities) return
  const available = new Set(adapterCapabilities)
  const missing = profile.capabilities.filter(
    (capability) => !available.has(capability),
  )
  if (missing.length > 0) {
    throw new Error(
      `Execution target profile "${profile.id}" declares capabilities the adapter does not provide: ${missing.join(', ')}`,
    )
  }
}

export function validateProjectRunConfiguration(
  configuration: unknown,
  extensions: RunExtensionManifest,
): RunConfiguration {
  const validatedConfiguration = validateRunConfiguration(configuration)
  if (!extensions.adapterAvailable && !extensions.fallbackAdapterAvailable) {
    throw new Error(
      'No execution target is configured. ' +
        'Configure web.baseUrl or export an adapter from pickle.extensions.ts.',
    )
  }
  return validatedConfiguration
}

export function resolveRunConfiguration(
  configuration: RunConfiguration,
  extensions: RunExtensions,
): ResolvedRunConfiguration {
  const profiles = configuredProfiles(configuration)
  const targets = profiles.map((executionTargetProfile) => {
    const adapter = adapterForProfile(executionTargetProfile, extensions)
    assertProfileCapabilities(executionTargetProfile, adapter)
    return { executionTargetProfile, adapter }
  })
  const first = targets[0]
  if (!first) {
    throw new Error(
      'executionTargetProfile or executionTargetProfiles is required',
    )
  }
  const infrastructureRetries = configuration.execution?.infrastructureRetries
  const functionalRetries = configuration.execution?.functionalRetries

  return {
    adapter: first.adapter,
    executionTargetProfile: first.executionTargetProfile,
    targets,
    concurrency: configuration.concurrency ?? 1,
    retry: {
      infrastructureErrors: infrastructureRetries ?? 1,
      functionalFailures: functionalRetries ?? 0,
    },
    timeout: {
      scenarioMs: configuration.execution?.scenarioTimeoutMs,
      stepMs: configuration.execution?.stepTimeoutMs,
    },
    applicationRevision: configuration.applicationRevision,
  }
}
