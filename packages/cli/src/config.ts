import type { ExecutionTargetProfile } from '@pickle-spec/runner'
import type { SelectionOptions } from '@pickle-spec/spec'
import type { WebAdapterOptions } from '@pickle-spec/web'
import { resolve } from 'node:path'

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

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function optionalString(value: unknown, field: string): void {
  if (value !== undefined && typeof value !== 'string') {
    throw new Error(`${field} must be a string`)
  }
}

function optionalPositiveInteger(value: unknown, field: string): void {
  if (value !== undefined && (!Number.isInteger(value) || (value as number) < 1)) {
    throw new Error(`${field} must be an integer greater than or equal to 1`)
  }
}

export function validateConfig(value: unknown): PickleConfig {
  const config = record(value, 'configuration')
  if (config.schemaVersion !== 1) {
    throw new Error(`Unsupported configuration schemaVersion: ${String(config.schemaVersion)}`)
  }
  optionalString(config.language, 'language')
  if (
    config.specifications !== undefined
    && typeof config.specifications !== 'string'
    && !(Array.isArray(config.specifications) && config.specifications.every(item => typeof item === 'string'))
  ) {
    throw new Error('specifications must be a string or an array of strings')
  }
  if (config.executionTargetProfile !== undefined) {
    const profile = record(config.executionTargetProfile, 'executionTargetProfile')
    if (typeof profile.id !== 'string' || !profile.id.trim()) {
      throw new Error('executionTargetProfile.id must not be empty')
    }
  }
  if (config.web !== undefined) {
    const web = record(config.web, 'web')
    if (typeof web.baseUrl !== 'string' || !web.baseUrl.trim()) {
      throw new Error('web.baseUrl must not be empty')
    }
  }
  if (config.server !== undefined) {
    const server = record(config.server, 'server')
    optionalString(server.command, 'server.command')
    optionalString(server.url, 'server.url')
    optionalString(server.readinessPath, 'server.readinessPath')
    optionalPositiveInteger(server.port, 'server.port')
    optionalPositiveInteger(server.startupTimeoutMs, 'server.startupTimeoutMs')
    optionalPositiveInteger(server.pollIntervalMs, 'server.pollIntervalMs')
    if (server.reuseExisting !== undefined && typeof server.reuseExisting !== 'boolean') {
      throw new Error('server.reuseExisting must be a boolean')
    }
  }
  if (config.selection !== undefined) record(config.selection, 'selection')
  if (config.execution !== undefined) {
    const execution = record(config.execution, 'execution')
    optionalPositiveInteger(execution.scenarioTimeoutMs, 'execution.scenarioTimeoutMs')
    optionalPositiveInteger(execution.stepTimeoutMs, 'execution.stepTimeoutMs')
    const retries = execution.infrastructureRetries
    if (retries !== undefined && (!Number.isInteger(retries) || (retries as number) < 0)) {
      throw new Error('execution.infrastructureRetries must be a non-negative integer')
    }
  }
  optionalPositiveInteger(config.concurrency, 'concurrency')
  return config as unknown as PickleConfig
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
      while (index < source.length && !(source[index] === '*' && source[index + 1] === '/')) index++
      index++
      continue
    }
    result += character
  }

  return result
}

async function defaultConfigPath(): Promise<string | undefined> {
  return await Bun.file('pickle.config.jsonc').exists() ? 'pickle.config.jsonc' : undefined
}

export async function loadConfig(configPath?: string): Promise<PickleConfig> {
  const selectedPath = configPath ?? await defaultConfigPath()
  if (!selectedPath) return { schemaVersion: 1 }
  if (!selectedPath.endsWith('.jsonc') && !selectedPath.endsWith('.json')) {
    throw new Error('Configuration must use pickle.config.jsonc')
  }
  const absolutePath = resolve(selectedPath)
  if (!(await Bun.file(absolutePath).exists())) {
    throw new Error(`Configuration file not found: ${selectedPath}`)
  }

  try {
    return validateConfig(JSON.parse(removeJsonComments(await Bun.file(absolutePath).text())))
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(`Invalid configuration ${selectedPath}: ${reason}. Correct the value and run pickle check again.`)
  }
}
