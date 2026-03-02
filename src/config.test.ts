import { test, expect, describe } from 'bun:test'
import { defineConfig, loadConfig } from './config'
import { resolve } from 'path'
import { tmpdir } from 'os'
import { join } from 'path'

describe('defineConfig', () => {
  test('returns the same config object', () => {
    const config = {
      server: { command: 'bun run dev', port: 3000, url: 'http://localhost:3000' },
      stagehand: { env: 'LOCAL' as const, modelName: 'gpt-4o' },
    }
    expect(defineConfig(config)).toEqual(config)
  })

  test('works with empty config', () => {
    const config = {}
    expect(defineConfig(config)).toEqual({})
  })
})

describe('loadConfig', () => {
  test('returns defaults when config file does not exist', async () => {
    const config = await loadConfig('/nonexistent/path/pickle.config.ts')
    expect(config.browser).toBeDefined()
    expect(config.browser!.env).toBe('LOCAL')
    expect(config.browser!.modelName).toBe('claude-4-6-sonnet-latest')
    expect(config.browser!.headless).toBe(true)
    expect(config.server).toBeUndefined()
  })

  test('loads and merges a config file', async () => {
    const tmpPath = join(tmpdir(), `pickle-test-${Date.now()}.ts`)
    await Bun.write(
      tmpPath,
      `export default { stagehand: { modelName: 'gpt-4o', env: 'BROWSERBASE' as const } }`,
    )

    try {
      const config = await loadConfig(tmpPath)
      expect(config.browser!.modelName).toBe('gpt-4o')
      expect(config.browser!.env).toBe('BROWSERBASE')
      // Defaults should be merged in
      expect(config.browser!.headless).toBe(true)
    } finally {
      await Bun.file(tmpPath).exists() && (await Bun.$`rm ${tmpPath}`)
    }
  })

  test('passes through server config when provided', async () => {
    const tmpPath = join(tmpdir(), `pickle-test-server-${Date.now()}.ts`)
    await Bun.write(
      tmpPath,
      `export default {
        server: { command: 'bun run dev', port: 4000, url: 'http://localhost:4000' },
      }`,
    )

    try {
      const config = await loadConfig(tmpPath)
      expect(config.server).toBeDefined()
      expect(config.server!.command).toBe('bun run dev')
      expect(config.server!.port).toBe(4000)
      expect(config.server!.url).toBe('http://localhost:4000')
    } finally {
      await Bun.file(tmpPath).exists() && (await Bun.$`rm ${tmpPath}`)
    }
  })

  test('user stagehand config overrides defaults', async () => {
    const tmpPath = join(tmpdir(), `pickle-test-override-${Date.now()}.ts`)
    await Bun.write(
      tmpPath,
      `export default { stagehand: { headless: false } }`,
    )

    try {
      const config = await loadConfig(tmpPath)
      expect(config.browser!.headless).toBe(false)
      // Other defaults still present
      expect(config.browser!.env).toBe('LOCAL')
      expect(config.browser!.modelName).toBe('claude-4-6-sonnet-latest')
    } finally {
      await Bun.file(tmpPath).exists() && (await Bun.$`rm ${tmpPath}`)
    }
  })
})
