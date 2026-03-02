import type { PickleSpecConfig } from './types'
import { resolve } from 'path'

/** Identity function that provides type inference for pickle.config.ts files */
export function defineConfig(config: PickleSpecConfig): PickleSpecConfig {
  return config
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

  const file = Bun.file(resolvedPath)
  if (!(await file.exists())) {
    return DEFAULT_CONFIG
  }

  const mod = await import(resolvedPath)
  const userConfig: PickleSpecConfig = mod.default ?? mod

  return {
    server: userConfig.server ? { ...userConfig.server } : undefined,
    browser: {
      ...DEFAULT_CONFIG.browser,
      ...userConfig.browser,
    },
  }
}
