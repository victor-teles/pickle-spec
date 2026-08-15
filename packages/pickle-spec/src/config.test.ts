import { test, expect, describe, afterEach } from 'bun:test'
import { defineConfig, getModelApiKeyEnvVar, loadConfig, normalizeConfig, validateConfig } from './config'
import { resolve } from 'path'
import { tmpdir } from 'os'
import { join } from 'path'
import { mkdtempSync } from 'fs'

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
    expect(config.browser!.modelName).toBe('anthropic/claude-sonnet-4-6')
    expect(config.browser!.headless).toBe(true)
    expect(config.report!.open).toBe('auto')
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

  test('auto-derives url from port when url is not provided', async () => {
    const tmpPath = join(tmpdir(), `pickle-test-auto-url-${Date.now()}.ts`)
    await Bun.write(
      tmpPath,
      `export default {
        server: { command: 'bun run dev', port: 5000 },
      }`,
    )

    try {
      const config = await loadConfig(tmpPath)
      expect(config.server).toBeDefined()
      expect(config.server!.command).toBe('bun run dev')
      expect(config.server!.port).toBe(5000)
      expect(config.server!.url).toBe('http://localhost:5000')
    } finally {
      await Bun.file(tmpPath).exists() && (await Bun.$`rm ${tmpPath}`)
    }
  })

  test('accepts url-only server config', async () => {
    const tmpPath = join(tmpdir(), `pickle-test-url-only-${Date.now()}.ts`)
    await Bun.write(
      tmpPath,
      `export default {
        server: { url: 'https://staging.example.com' },
      }`,
    )

    try {
      const config = await loadConfig(tmpPath)
      expect(config.server).toBeDefined()
      expect(config.server!.url).toBe('https://staging.example.com')
      expect(config.server!.command).toBeUndefined()
      expect(config.server!.port).toBeUndefined()
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
      expect(config.browser!.modelName).toBe('anthropic/claude-sonnet-4-6')
    } finally {
      await Bun.file(tmpPath).exists() && (await Bun.$`rm ${tmpPath}`)
    }
  })

  test('loads .env file from config directory', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pickle-env-'))
    const envKey = `PICKLE_TEST_VAR_${Date.now()}`
    const configPath = join(tmpDir, 'pickle.config.ts')
    const envPath = join(tmpDir, '.env')

    await Bun.write(envPath, `${envKey}=hello_from_env\n`)
    await Bun.write(configPath, `export default {}`)

    try {
      delete process.env[envKey]
      await loadConfig(configPath)
      expect(process.env[envKey]).toBe('hello_from_env')
    } finally {
      delete process.env[envKey]
      await Bun.$`rm -rf ${tmpDir}`
    }
  })

  test('loads language from config', async () => {
    const tmpPath = join(tmpdir(), `pickle-test-lang-${Date.now()}.ts`)
    await Bun.write(tmpPath, `export default { language: 'pt' }`)

    try {
      const config = await loadConfig(tmpPath)
      expect(config.language).toBe('pt')
    } finally {
      await Bun.file(tmpPath).exists() && (await Bun.$`rm ${tmpPath}`)
    }
  })

  test('language is undefined when not specified in config', async () => {
    const config = await loadConfig('/nonexistent/path/pickle.config.ts')
    expect(config.language).toBeUndefined()
  })

  test('passes through features string from config', async () => {
    const tmpPath = join(tmpdir(), `pickle-test-features-${Date.now()}.ts`)
    await Bun.write(tmpPath, `export default { features: 'e2e/**/*.feature' }`)

    try {
      const config = await loadConfig(tmpPath)
      expect(config.features).toBe('e2e/**/*.feature')
    } finally {
      await Bun.file(tmpPath).exists() && (await Bun.$`rm ${tmpPath}`)
    }
  })

  test('passes through features array from config', async () => {
    const tmpPath = join(tmpdir(), `pickle-test-features-arr-${Date.now()}.ts`)
    await Bun.write(
      tmpPath,
      `export default { features: ['e2e/**/*.feature', 'smoke/**/*.feature'] }`,
    )

    try {
      const config = await loadConfig(tmpPath)
      expect(config.features).toEqual(['e2e/**/*.feature', 'smoke/**/*.feature'])
    } finally {
      await Bun.file(tmpPath).exists() && (await Bun.$`rm ${tmpPath}`)
    }
  })

  test('features is undefined when not specified in config', async () => {
    const config = await loadConfig('/nonexistent/path/pickle.config.ts')
    expect(config.features).toBeUndefined()
  })

  test('does not override existing env vars when loading .env', async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), 'pickle-env-'))
    const envKey = `PICKLE_TEST_EXISTING_${Date.now()}`
    const configPath = join(tmpDir, 'pickle.config.ts')
    const envPath = join(tmpDir, '.env')

    await Bun.write(envPath, `${envKey}=from_file\n`)
    await Bun.write(configPath, `export default {}`)

    try {
      process.env[envKey] = 'already_set'
      await loadConfig(configPath)
      expect(process.env[envKey]).toBe('already_set')
    } finally {
      delete process.env[envKey]
      await Bun.$`rm -rf ${tmpDir}`
    }
  })

  test('does not validate invalid values before CLI overrides are applied', async () => {
    const tmpPath = join(tmpdir(), `pickle-test-invalid-${Date.now()}.ts`)
    await Bun.write(tmpPath, `export default { concurrency: 0 }`)

    try {
      const config = await loadConfig(tmpPath)
      expect(config.concurrency).toBe(0)
    } finally {
      await Bun.file(tmpPath).exists() && (await Bun.$`rm ${tmpPath}`)
    }
  })
})

describe('normalizeConfig', () => {
  test('validates invalid concurrency', () => {
    expect(() => normalizeConfig({ concurrency: 0 })).toThrow(
      'concurrency must be an integer greater than or equal to 1',
    )
  })

  test('validates screenshot mode', () => {
    expect(() => normalizeConfig({
      screenshots: {
        mode: 'sometimes' as any,
      },
    })).toThrow('screenshots.mode must be one of')
  })

  test('validates screenshot format', () => {
    expect(() => normalizeConfig({
      screenshots: {
        format: 'gif' as any,
      },
    })).toThrow('screenshots.format must be one of')
  })

  test('validates browserbase credentials', () => {
    const originalApiKey = process.env.BROWSERBASE_API_KEY
    const originalProjectId = process.env.BROWSERBASE_PROJECT_ID
    delete process.env.BROWSERBASE_API_KEY
    delete process.env.BROWSERBASE_PROJECT_ID

    try {
      expect(() => normalizeConfig({
        browser: {
          env: 'BROWSERBASE',
        },
      })).toThrow('BROWSERBASE_API_KEY')
    } finally {
      if (originalApiKey === undefined) delete process.env.BROWSERBASE_API_KEY
      else process.env.BROWSERBASE_API_KEY = originalApiKey

      if (originalProjectId === undefined) delete process.env.BROWSERBASE_PROJECT_ID
      else process.env.BROWSERBASE_PROJECT_ID = originalProjectId
    }
  })

  test('validates server command requires url or port', () => {
    expect(() => normalizeConfig({
      server: {
        command: 'bun run dev',
      },
    })).toThrow('server.command requires server.url or server.port')
  })

  test('allows unknown model providers without preflight API key validation', () => {
    expect(() => normalizeConfig({
      browser: {
        modelName: 'custom-provider/model-1',
      },
    })).not.toThrow()
  })

  test('accepts explicit modelClientOptions apiKey', () => {
    expect(() => normalizeConfig({
      browser: {
        modelName: 'gpt-4o',
        modelClientOptions: {
          apiKey: 'test-key',
        },
      },
    })).not.toThrow()
  })

  test('validates execution retries and timeouts', () => {
    expect(() => normalizeConfig({
      execution: {
        retries: -1,
      },
    })).toThrow('execution.retries')

    expect(() => normalizeConfig({
      execution: {
        scenarioTimeoutMs: 0,
      },
    })).toThrow('execution.scenarioTimeoutMs')

    expect(() => normalizeConfig({
      execution: {
        stepTimeoutMs: 0,
      },
    })).toThrow('execution.stepTimeoutMs')
  })

  test('validates shard coordinates and output paths', () => {
    expect(() => normalizeConfig({
      shard: {
        index: 2,
        total: 1,
      },
    })).toThrow('shard.index')

    expect(() => normalizeConfig({
      output: {
        json: {
          path: '',
        },
      },
    })).toThrow('output.json.path')
  })
})

describe('validateConfig', () => {
  test('requires provider env var for known models', () => {
    const original = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    try {
      expect(() => validateConfig({
        browser: {
          env: 'LOCAL',
          modelName: 'anthropic/claude-sonnet-4-6',
        },
        concurrency: 1,
        report: {
          open: 'auto',
        },
      })).toThrow('ANTHROPIC_API_KEY')
    } finally {
      if (original !== undefined) process.env.ANTHROPIC_API_KEY = original
    }
  })
})

describe('getModelApiKeyEnvVar', () => {
  test('maps known providers to env vars', () => {
    expect(getModelApiKeyEnvVar('anthropic/claude-sonnet-4-6')).toBe('ANTHROPIC_API_KEY')
    expect(getModelApiKeyEnvVar('claude-4-6-sonnet-latest')).toBe('ANTHROPIC_API_KEY')
    expect(getModelApiKeyEnvVar('gpt-4o')).toBe('OPENAI_API_KEY')
    expect(getModelApiKeyEnvVar('openai/gpt-5.2')).toBe('OPENAI_API_KEY')
    expect(getModelApiKeyEnvVar('gemini-2.0-flash')).toBe('GOOGLE_GENERATIVE_AI_API_KEY')
    expect(getModelApiKeyEnvVar('groq/llama')).toBe('GROQ_API_KEY')
    expect(getModelApiKeyEnvVar('mistral-large-latest')).toBe('MISTRAL_API_KEY')
    expect(getModelApiKeyEnvVar('deepseek-chat')).toBe('DEEPSEEK_API_KEY')
    expect(getModelApiKeyEnvVar('grok-2')).toBe('XAI_API_KEY')
  })

  test('returns undefined for unknown models', () => {
    expect(getModelApiKeyEnvVar('custom-provider/model-1')).toBeUndefined()
  })
})
