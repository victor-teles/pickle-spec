import { resolve } from 'node:path'
import {
  type ExecutionTargetProfile,
  type RunConfiguration,
  validateRunConfiguration,
} from '@pickle-spec/runner'
import {
  type SelectionOptions,
  validateSelectionOptions,
} from '@pickle-spec/spec'
import {
  validateWebAdapterOptions,
  type WebAdapterOptions,
} from '@pickle-spec/web'

export interface ServerConfig {
  command?: string
  url?: string
  port?: number
  startupTimeoutMs?: number
  pollIntervalMs?: number
  readinessPath?: string
  reuseExisting?: boolean
}

export interface ProjectExecutionTargetProfile {
  adapter: string
  capabilities?: readonly string[]
  web?: WebAdapterOptions
}

export interface PickleConfig {
  schemaVersion: 1
  language?: string
  specifications?: string | string[]
  suites?: Record<string, SelectionOptions>
  executionTargetProfiles?: Record<string, ProjectExecutionTargetProfile>
  executionTargetProfile?: ExecutionTargetProfile
  web?: WebAdapterOptions
  selection?: SelectionOptions
  execution?: {
    infrastructureRetries?: number
    scenarioTimeoutMs?: number
    stepTimeoutMs?: number
  }
  concurrency?: number
  server?: ServerConfig
}

function selectedExecutionTargetProfiles(
  config: PickleConfig,
  profileIds?: readonly string[],
): ExecutionTargetProfile[] {
  if (config.executionTargetProfiles) {
    const ids = profileIds?.length
      ? profileIds
      : Object.keys(config.executionTargetProfiles)
    return ids.map((id) => {
      const profile = config.executionTargetProfiles?.[id]
      if (!profile) {
        throw new Error(`Unknown execution target profile "${id}"`)
      }
      return {
        id,
        adapter: profile.adapter,
        ...(profile.capabilities ? { capabilities: profile.capabilities } : {}),
      }
    })
  }
  if (profileIds?.length) {
    throw new Error(`Unknown execution target profile "${profileIds[0]}"`)
  }
  return [
    {
      id: config.executionTargetProfile?.id ?? (config.web ? 'web' : 'custom'),
      ...(config.executionTargetProfile?.adapter
        ? { adapter: config.executionTargetProfile.adapter }
        : {}),
      ...(config.executionTargetProfile?.capabilities
        ? { capabilities: config.executionTargetProfile.capabilities }
        : {}),
    },
  ]
}

export function runConfigurationFrom(
  config: PickleConfig,
  profileIds?: readonly string[],
): RunConfiguration {
  const executionTargetProfiles = selectedExecutionTargetProfiles(
    config,
    profileIds,
  )
  return {
    schemaVersion: config.schemaVersion,
    executionTargetProfile: executionTargetProfiles[0],
    executionTargetProfiles,
    concurrency: config.concurrency,
    execution: config.execution,
  }
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

function optionalString(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${field} must be a string`)
  }
}

function optionalPositiveInteger(value: unknown, field: string): void {
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

function validateSuites(value: unknown): Record<string, SelectionOptions> {
  const suites = record(value, 'suites')
  const result: Record<string, SelectionOptions> = {}
  for (const [name, query] of Object.entries(suites)) {
    if (!name.trim()) throw new Error('suites keys must not be empty')
    const options = validateSelectionOptions(query)
    if (options.shard) {
      throw new Error(`suites.${name}.shard is not supported`)
    }
    result[name] = options
  }
  return result
}

function validateProjectProfiles(
  value: unknown,
): Record<string, ProjectExecutionTargetProfile> {
  const profiles = record(value, 'executionTargetProfiles')
  const ids = Object.keys(profiles)
  if (ids.length === 0) {
    throw new Error(
      'executionTargetProfiles must contain at least one execution target profile',
    )
  }
  const result: Record<string, ProjectExecutionTargetProfile> = {}
  for (const id of ids) {
    if (!id.trim()) {
      throw new Error('executionTargetProfiles keys must not be empty')
    }
    const field = `executionTargetProfiles.${id}`
    const profile = record(profiles[id], field)
    knownFields(profile, ['adapter', 'capabilities', 'web'], field)
    if (typeof profile.adapter !== 'string' || !profile.adapter.trim()) {
      throw new Error(`${field}.adapter must not be empty`)
    }
    if (profile.capabilities !== undefined) {
      profile.capabilities = validateCapabilities(
        profile.capabilities,
        `${field}.capabilities`,
      )
    }
    if (profile.web !== undefined) {
      profile.web = validateWebAdapterOptions(profile.web)
    }
    result[id] = profile as unknown as ProjectExecutionTargetProfile
  }
  return result
}

function validateConfig(value: unknown): PickleConfig {
  const config = record(value, 'configuration')
  knownFields(
    config,
    [
      'schemaVersion',
      'language',
      'specifications',
      'suites',
      'executionTargetProfiles',
      'executionTargetProfile',
      'web',
      'selection',
      'execution',
      'concurrency',
      'server',
    ],
    'configuration',
  )
  optionalString(config.language, 'language')
  if (
    typeof config.specifications === 'string' &&
    !config.specifications.trim()
  ) {
    throw new Error('specifications paths must not be empty')
  }
  if (
    Array.isArray(config.specifications) &&
    config.specifications.length === 0
  ) {
    throw new Error('specifications must contain at least one path')
  }
  if (
    config.specifications !== undefined &&
    typeof config.specifications !== 'string' &&
    !(
      Array.isArray(config.specifications) &&
      config.specifications.every(
        (item) => typeof item === 'string' && item.trim(),
      )
    )
  ) {
    throw new Error('specifications must be a string or an array of strings')
  }
  if (config.web !== undefined) {
    validateWebAdapterOptions(config.web)
  }
  if (config.server !== undefined) {
    const server = record(config.server, 'server')
    knownFields(
      server,
      [
        'command',
        'url',
        'port',
        'startupTimeoutMs',
        'pollIntervalMs',
        'readinessPath',
        'reuseExisting',
      ],
      'server',
    )
    optionalString(server.command, 'server.command')
    optionalString(server.url, 'server.url')
    optionalString(server.readinessPath, 'server.readinessPath')
    optionalPositiveInteger(server.port, 'server.port')
    optionalPositiveInteger(server.startupTimeoutMs, 'server.startupTimeoutMs')
    optionalPositiveInteger(server.pollIntervalMs, 'server.pollIntervalMs')
    if (
      server.reuseExisting !== undefined &&
      typeof server.reuseExisting !== 'boolean'
    ) {
      throw new Error('server.reuseExisting must be a boolean')
    }
    if (server.command && !server.url && !server.port) {
      throw new Error('server.command requires server.url or server.port')
    }
    if (server.url !== undefined) {
      try {
        new URL(server.url as string)
      } catch {
        throw new Error('server.url must be a valid URL')
      }
    }
    if (typeof server.port === 'number' && server.port > 65_535) {
      throw new Error('server.port must be less than or equal to 65535')
    }
  }
  if (config.selection !== undefined) validateSelectionOptions(config.selection)
  if (config.suites !== undefined) config.suites = validateSuites(config.suites)
  if (config.executionTargetProfiles !== undefined) {
    config.executionTargetProfiles = validateProjectProfiles(
      config.executionTargetProfiles,
    )
  }
  const validatedConfig = config as unknown as PickleConfig
  validateRunConfiguration(runConfigurationFrom(validatedConfig))
  return validatedConfig
}

function removeJsonComments(source: string): string {
  let result = ''
  let inString = false
  let escaped = false

  for (let index = 0; index < source.length; index++) {
    const character = source[index]!
    const next = source[index + 1]
    if (inString) {
      result += character
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
      continue
    }
    if (character === '"') {
      inString = true
      result += character
      continue
    }
    if (character === '/' && next === '/') {
      while (index < source.length && source[index] !== '\n') index++
      result += '\n'
      continue
    }
    if (character === '/' && next === '*') {
      index += 2
      while (
        index < source.length &&
        !(source[index] === '*' && source[index + 1] === '/')
      )
        index++
      index++
      continue
    }
    result += character
  }

  return result
}

async function defaultConfigPath(): Promise<string | undefined> {
  return (await Bun.file('pickle.config.jsonc').exists())
    ? 'pickle.config.jsonc'
    : undefined
}

export async function loadConfig(configPath?: string): Promise<PickleConfig> {
  const selectedPath = configPath ?? (await defaultConfigPath())
  if (!selectedPath) return { schemaVersion: 1 }
  if (!selectedPath.endsWith('.jsonc') && !selectedPath.endsWith('.json')) {
    throw new Error('Configuration must use pickle.config.jsonc')
  }
  const absolutePath = resolve(selectedPath)
  if (!(await Bun.file(absolutePath).exists())) {
    throw new Error(`Configuration file not found: ${selectedPath}`)
  }

  try {
    return validateConfig(
      JSON.parse(removeJsonComments(await Bun.file(absolutePath).text())),
    )
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `Invalid configuration ${selectedPath}: ${reason}. Correct the value and run pickle check again.`,
    )
  }
}
