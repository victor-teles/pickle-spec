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
  executionTargetProfile?: ExecutionTargetProfile
}

export interface ResolvedRunConfiguration extends ExecutionPolicy {
  adapter: ExecutionTargetAdapter
  executionTargetProfile: ExecutionTargetProfile
  concurrency: number
}

function positiveInteger(value: number | undefined, field: string): void {
  if (value !== undefined && (!Number.isInteger(value) || value < 1)) {
    throw new Error(`${field} must be an integer greater than or equal to 1`)
  }
}

export function resolveRunConfiguration(
  configuration: RunConfiguration,
  extensions: RunExtensions,
): ResolvedRunConfiguration {
  if (configuration.schemaVersion !== 1) {
    throw new Error(`Unsupported configuration schemaVersion: ${configuration.schemaVersion}`)
  }
  const executionTargetProfile = extensions.executionTargetProfile
    ?? configuration.executionTargetProfile
  if (!executionTargetProfile.id?.trim()) {
    throw new Error('executionTargetProfile.id must not be empty')
  }
  positiveInteger(configuration.concurrency, 'concurrency')
  positiveInteger(configuration.execution?.scenarioTimeoutMs, 'execution.scenarioTimeoutMs')
  positiveInteger(configuration.execution?.stepTimeoutMs, 'execution.stepTimeoutMs')
  const retries = configuration.execution?.infrastructureRetries
  if (retries !== undefined && (!Number.isInteger(retries) || retries < 0)) {
    throw new Error('execution.infrastructureRetries must be a non-negative integer')
  }

  return {
    adapter: extensions.adapter,
    executionTargetProfile,
    concurrency: configuration.concurrency ?? 1,
    retry: { infrastructureErrors: retries ?? 0 },
    timeout: {
      scenarioMs: configuration.execution?.scenarioTimeoutMs,
      stepMs: configuration.execution?.stepTimeoutMs,
    },
  }
}
