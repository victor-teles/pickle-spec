import type { PickleSpecConfig, ServerConfig } from './types'
import { resolve, dirname, join } from 'path'
import dotenv from 'dotenv'

/** Identity function that provides type inference for pickle.config.ts files */
export function defineConfig(config: PickleSpecConfig): PickleSpecConfig {
  return config
}

function resolveServerConfig(server: ServerConfig): ServerConfig {
  const url = server.url ?? (server.port ? `http://localhost:${server.port}` : undefined)
  return { ...server, url }
}

const DEFAULT_CONFIG: PickleSpecConfig = {
  browser: {
    env: 'LOCAL',
    modelName: 'claude-4-6-sonnet-latest',
    headless: true,
  },
}


/**
 * Load pickle.config.ts from the given path (or default location).
 * Uses dynamic import() which Bun handles natively for .ts files.
 */
export async function loadConfig(configPath?: string): Promise<PickleSpecConfig> {
  const resolvedPath = resolve(configPath ?? 'pickle.config.ts')
  const configDir = dirname(resolvedPath)

  dotenv.config({ path: join(configDir, '.env') })

  const file = Bun.file(resolvedPath)
  if (!(await file.exists())) {
    return DEFAULT_CONFIG
  }

  const mod = await import(resolvedPath)
  const userConfig = mod.default ?? mod

  // Support legacy 'stagehand' key as alias for 'browser'
  const browserConfig = userConfig.browser ?? userConfig.stagehand

  return {
    language: userConfig.language,
    features: userConfig.features,
    server: userConfig.server ? resolveServerConfig(userConfig.server) : undefined,
    browser: {
      ...DEFAULT_CONFIG.browser,
      ...browserConfig,
    },
    screenshots: userConfig.screenshots,
    concurrency: userConfig.concurrency ?? 3,
    verbose: userConfig.verbose ?? false,
  }
}
