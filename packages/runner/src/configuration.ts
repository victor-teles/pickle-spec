import type {
  ExecutionPolicy,
  ExecutionTargetAdapter,
  ExecutionTargetProfile,
} from './run-scenario'

export interface RunConfiguration {
  schemaVersion: 1
  executionTargetProfile: ExecutionTargetProfile
  concurrency?: number
  execution?: {
    infrastructureRetries?: number
    scenarioTimeoutMs?: number
    stepTimeoutMs?: number
  }
}

export interface RunExtensions {
  adapter: ExecutionTargetAdapter
}

export interface RunExtensionManifest {
  adapterAvailable: boolean
  fallbackAdapterAvailable: boolean
}

export interface ResolvedRunConfiguration extends ExecutionPolicy {
  adapter: ExecutionTargetAdapter
  executionTargetProfile: ExecutionTargetProfile
  concurrency: number
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

function validateExecutionTargetProfile(value: unknown): void {
  const profile = record(value, 'executionTargetProfile')
  knownFields(profile, ['id'], 'executionTargetProfile')
  if (typeof profile.id !== 'string' || !profile.id.trim()) {
    throw new Error('executionTargetProfile.id must not be empty')
  }
}

export function validateRunConfiguration(value: unknown): RunConfiguration {
  const configuration = record(value, 'run configuration')
  knownFields(
    configuration,
    ['schemaVersion', 'executionTargetProfile', 'concurrency', 'execution'],
    'run configuration',
  )
  if (configuration.schemaVersion !== 1) {
    throw new Error(
      `Unsupported configuration schemaVersion: ${String(configuration.schemaVersion)}`,
    )
  }
  validateExecutionTargetProfile(configuration.executionTargetProfile)
  positiveInteger(configuration.concurrency, 'concurrency')
  if (configuration.execution !== undefined) {
    const execution = record(configuration.execution, 'execution')
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
  if (
    typeof extensions.adapter !== 'object' ||
    extensions.adapter === null ||
    typeof extensions.adapter.openSession !== 'function'
  ) {
    throw new Error('extensions.adapter must provide openSession')
  }
  const retries = validatedConfiguration.execution?.infrastructureRetries

  return {
    adapter: extensions.adapter,
    executionTargetProfile: validatedConfiguration.executionTargetProfile,
    concurrency: validatedConfiguration.concurrency ?? 1,
    retry: { infrastructureErrors: retries ?? 0 },
    timeout: {
      scenarioMs: validatedConfiguration.execution?.scenarioTimeoutMs,
      stepMs: validatedConfiguration.execution?.stepTimeoutMs,
    },
  }
}
