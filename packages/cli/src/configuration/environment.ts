import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseEnv } from 'node:util'

// Explicit shell variables take precedence over project environment files.
export function loadEnvironment(cwd = process.cwd()): void {
  const values: Record<string, string> = {}
  const files = [
    '.env',
    ...(process.env.NODE_ENV ? [`.env.${process.env.NODE_ENV}`] : []),
    '.env.local',
  ]
  for (const file of files) {
    try {
      Object.assign(values, parseEnv(readFileSync(join(cwd, file), 'utf8')))
    } catch (error) {
      if (
        !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
      )
        throw error
    }
  }
  for (const [name, value] of Object.entries(values)) {
    process.env[name] ??= value
  }
}
