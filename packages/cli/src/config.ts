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

export interface PickleConfig {
  schemaVersion: 1
  language?: string
  specifications?: string | string[]
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

export function runConfigurationFrom(config: PickleConfig): RunConfiguration {
  return {
    schemaVersion: config.schemaVersion,
    executionTargetProfile: config.executionTargetProfile ?? {
      id: config.web ? 'web' : 'custom',
    },
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

function validateConfig(value: unknown): PickleConfig {
  const config = record(value, 'configuration')
  knownFields(
    config,
    [
      'schemaVersion',
      'language',
      'specifications',
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
