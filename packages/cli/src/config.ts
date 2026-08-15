import type { ExecutionTargetProfile } from '@pickle-spec/runner'
import type { SelectionOptions } from '@pickle-spec/spec'
import type { WebAdapterOptions } from '@pickle-spec/web'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

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

export function defineConfig(config: PickleConfig): PickleConfig {
  return config
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
  for (const candidate of ['pickle.config.jsonc', 'pickle.config.ts']) {
    if (await Bun.file(candidate).exists()) return candidate
  }
  return undefined
}

export async function loadConfig(configPath?: string): Promise<PickleConfig> {
  const selectedPath = configPath ?? await defaultConfigPath()
  if (!selectedPath) return {}
  const absolutePath = resolve(selectedPath)
  if (!(await Bun.file(absolutePath).exists())) {
    throw new Error(`Configuration file not found: ${selectedPath}`)
  }

  const config = selectedPath.endsWith('.jsonc') || selectedPath.endsWith('.json')
    ? JSON.parse(removeJsonComments(await Bun.file(absolutePath).text())) as PickleConfig
    : ((await import(pathToFileURL(absolutePath).href)).default as PickleConfig)

  if (config.concurrency !== undefined && (!Number.isInteger(config.concurrency) || config.concurrency < 1)) {
    throw new Error('concurrency must be an integer greater than or equal to 1')
  }
  if (
    config.execution?.infrastructureRetries !== undefined
    && (!Number.isInteger(config.execution.infrastructureRetries) || config.execution.infrastructureRetries < 0)
  ) {
    throw new Error('execution.infrastructureRetries must be a non-negative integer')
  }
  return config
}
