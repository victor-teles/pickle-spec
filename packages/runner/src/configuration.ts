import type {
  ExecutionPolicy,
  ExecutionTargetAdapter,
  ExecutionTargetProfile,
} from './run-scenario'
import type { RunTarget } from './run-scenarios'

export interface RunConfiguration {
  schemaVersion: 1
  executionTargetProfile?: ExecutionTargetProfile
  executionTargetProfiles?: ExecutionTargetProfile[]
  applicationRevision?: string
  concurrency?: number
  execution?: {
    infrastructureRetries?: number
    scenarioTimeoutMs?: number
    stepTimeoutMs?: number
  }
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

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function knownFields(
  value: Record<string, unknown>,
  fields: readonly string[],
  parent: string,
): void {
  for (const field of Object.keys(value)) {
    if (!fields.includes(field))
      throw new Error(`${parent}.${field} is not supported`)
  }
}

function positiveInteger(value: unknown, field: string): void {
  if (
    value !== undefined &&
    (!Number.isInteger(value) || (value as number) < 1)
  ) {
    throw new Error(`${field} must be an integer greater than or equal to 1`)
  }
}

function validateCapabilities(
  value: unknown,
  field: string,
): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must contain at least one capability`)
  }
  if (!value.every((item) => typeof item === 'string' && item.trim())) {
    throw new Error(`${field} must not contain an empty capability`)
  }
  return value
}

function validateExecutionTargetProfile(
  value: unknown,
  field = 'executionTargetProfile',
): ExecutionTargetProfile {
  const profile = record(value, field)
  knownFields(profile, ['id', 'adapter', 'capabilities'], field)
  if (typeof profile.id !== 'string' || !profile.id.trim()) {
    throw new Error(`${field}.id must not be empty`)
  }
  if (
    profile.adapter !== undefined &&
    (typeof profile.adapter !== 'string' || !profile.adapter.trim())
  ) {
    throw new Error(`${field}.adapter must not be empty`)
  }
  if (profile.capabilities !== undefined) {
    profile.capabilities = validateCapabilities(
      profile.capabilities,
      `${field}.capabilities`,
    )
  }
  return profile as unknown as ExecutionTargetProfile
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

function validateExecution(value: unknown): RunConfiguration['execution'] {
  const execution = record(value, 'execution')
  knownFields(
    execution,
    ['infrastructureRetries', 'scenarioTimeoutMs', 'stepTimeoutMs'],
    'execution',
  )
  positiveInteger(execution.scenarioTimeoutMs, 'execution.scenarioTimeoutMs')
  positiveInteger(execution.stepTimeoutMs, 'execution.stepTimeoutMs')
  const retries = execution.infrastructureRetries
  if (
    retries !== undefined &&
    (!Number.isInteger(retries) || (retries as number) < 0)
  ) {
    throw new Error(
      'execution.infrastructureRetries must be a non-negative integer',
    )
  }
  return execution
}

export function validateRunConfiguration(value: unknown): RunConfiguration {
  const configuration = record(value, 'run configuration')
  knownFields(
    configuration,
    [
      'schemaVersion',
      'executionTargetProfile',
      'executionTargetProfiles',
      'applicationRevision',
      'concurrency',
      'execution',
    ],
    'run configuration',
  )
  if (configuration.schemaVersion !== 1) {
    throw new Error(
      `Unsupported configuration schemaVersion: ${String(configuration.schemaVersion)}`,
    )
  }
  if (configuration.executionTargetProfile !== undefined) {
    configuration.executionTargetProfile = validateExecutionTargetProfile(
      configuration.executionTargetProfile,
    )
  }
  if (configuration.executionTargetProfiles !== undefined) {
    if (
      !Array.isArray(configuration.executionTargetProfiles) ||
      configuration.executionTargetProfiles.length === 0
    ) {
      throw new Error(
        'executionTargetProfiles must contain at least one execution target profile',
      )
    }
    configuration.executionTargetProfiles =
      configuration.executionTargetProfiles.map((profile, index) =>
        validateExecutionTargetProfile(
          profile,
          `executionTargetProfiles[${index}]`,
        ),
      )
  }
  if (
    configuration.executionTargetProfile === undefined &&
    configuration.executionTargetProfiles === undefined
  ) {
    throw new Error(
      'executionTargetProfile or executionTargetProfiles is required',
    )
  }
  if (
    configuration.applicationRevision !== undefined &&
    (typeof configuration.applicationRevision !== 'string' ||
      !configuration.applicationRevision.trim())
  ) {
    throw new Error('applicationRevision must not be empty')
  }
  positiveInteger(configuration.concurrency, 'concurrency')
  if (configuration.execution !== undefined) {
    configuration.execution = validateExecution(configuration.execution)
  }
  return configuration as unknown as RunConfiguration
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
  const validatedConfiguration = validateRunConfiguration(configuration)
  const profiles = configuredProfiles(validatedConfiguration)
  const targets = profiles.map((executionTargetProfile) => {
    const adapter = adapterForProfile(executionTargetProfile, extensions)
    assertProfileCapabilities(executionTargetProfile, adapter)
    return { executionTargetProfile, adapter }
  })
  const first = targets[0]!
  const retries = validatedConfiguration.execution?.infrastructureRetries

  return {
    adapter: first.adapter,
    executionTargetProfile: first.executionTargetProfile,
    targets,
    concurrency: validatedConfiguration.concurrency ?? 1,
    retry: { infrastructureErrors: retries ?? 0 },
    timeout: {
      scenarioMs: validatedConfiguration.execution?.scenarioTimeoutMs,
      stepMs: validatedConfiguration.execution?.stepTimeoutMs,
    },
    ...(validatedConfiguration.applicationRevision
      ? { applicationRevision: validatedConfiguration.applicationRevision }
      : {}),
  }
}
