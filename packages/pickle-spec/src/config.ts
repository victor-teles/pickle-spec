import type {
  ExecutionConfig,
  FilterConfig,
  OutputConfig,
  PickleSpecConfig,
  ReportOpenMode,
  ServerConfig,
  ShardConfig,
  ScreenshotMode,
} from './types'
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
    modelName: 'anthropic/claude-sonnet-4-6',
    headless: true,
  },
  report: {
    open: 'auto',
  },
  execution: {
    retryOn: 'infrastructure',
  },
}

const VALID_SCREENSHOT_MODES = new Set<ScreenshotMode>(['off', 'on-failure', 'on-step'])
const VALID_SCREENSHOT_FORMATS = new Set(['png', 'jpeg'])
const VALID_REPORT_OPEN_MODES = new Set<ReportOpenMode>(['auto', 'always', 'never'])
const VALID_BROWSER_ENVS = new Set(['LOCAL', 'BROWSERBASE'])

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function getConfigValue(value: string | undefined, envKey: string): string | undefined {
  return value ?? process.env[envKey]
}

function normalizeOutput(output?: OutputConfig): OutputConfig | undefined {
  if (!output) return undefined
  return {
    json: output.json === false ? false : output.json ? { ...output.json } : undefined,
    junit: output.junit === false ? false : output.junit ? { ...output.junit } : undefined,
  }
}

function normalizeFilter(filter?: FilterConfig): FilterConfig | undefined {
  if (!filter) return undefined
  return { ...filter }
}

function normalizeShard(shard?: ShardConfig): ShardConfig | undefined {
  if (!shard) return undefined
  return { ...shard }
}

function normalizeExecution(execution?: ExecutionConfig): ExecutionConfig | undefined {
  return {
    ...DEFAULT_CONFIG.execution,
    ...execution,
  }
}

export function getModelApiKeyEnvVar(modelName?: string): string | undefined {
  if (!modelName) return undefined

  const normalized = modelName.toLowerCase()

  if (normalized.includes('claude') || normalized.includes('anthropic')) {
    return 'ANTHROPIC_API_KEY'
  }

  if (
    normalized.includes('openai/')
    || normalized.startsWith('gpt')
    || /(^|[/:_-])(o1|o3|o4)\b/.test(normalized)
  ) {
    return 'OPENAI_API_KEY'
  }

  if (normalized.includes('gemini') || normalized.includes('google/')) {
    return 'GOOGLE_GENERATIVE_AI_API_KEY'
  }

  if (normalized.includes('groq')) {
    return 'GROQ_API_KEY'
  }

  if (normalized.includes('mistral')) {
    return 'MISTRAL_API_KEY'
  }

  if (normalized.includes('deepseek')) {
    return 'DEEPSEEK_API_KEY'
  }

  if (normalized.includes('grok') || normalized.includes('xai')) {
    return 'XAI_API_KEY'
  }

  return undefined
}

export function normalizeConfig(
  config: PickleSpecConfig,
  options: { validate?: boolean } = {},
): PickleSpecConfig {
  const normalized: PickleSpecConfig = {
    language: config.language,
    features: config.features,
    server: config.server ? resolveServerConfig(config.server) : undefined,
    browser: {
      ...DEFAULT_CONFIG.browser,
      ...config.browser,
    },
    screenshots: config.screenshots ? { ...config.screenshots } : undefined,
    report: {
      ...DEFAULT_CONFIG.report,
      ...config.report,
    },
    output: normalizeOutput(config.output),
    filter: normalizeFilter(config.filter),
    shard: normalizeShard(config.shard),
    execution: normalizeExecution(config.execution),
    concurrency: config.concurrency ?? 3,
    verbose: config.verbose ?? false,
  }

  if (options.validate !== false) {
    validateConfig(normalized)
  }

  return normalized
}

export function validateConfig(config: PickleSpecConfig): void {
  if (!isPositiveInteger(config.concurrency)) {
    throw new Error('Invalid config: concurrency must be an integer greater than or equal to 1')
  }

  if (config.report?.open && !VALID_REPORT_OPEN_MODES.has(config.report.open)) {
    throw new Error('Invalid config: report.open must be one of "auto", "always", or "never"')
  }

  if (config.screenshots?.mode && !VALID_SCREENSHOT_MODES.has(config.screenshots.mode)) {
    throw new Error('Invalid config: screenshots.mode must be one of "off", "on-failure", or "on-step"')
  }

  if (config.screenshots?.format && !VALID_SCREENSHOT_FORMATS.has(config.screenshots.format)) {
    throw new Error('Invalid config: screenshots.format must be one of "png" or "jpeg"')
  }

  const browserEnv = config.browser?.env
  if (browserEnv && !VALID_BROWSER_ENVS.has(browserEnv)) {
    throw new Error('Invalid config: browser.env must be either "LOCAL" or "BROWSERBASE"')
  }

  if (config.server?.command && !config.server.url) {
    throw new Error('Invalid config: server.command requires server.url or server.port')
  }

  if (config.server?.pollIntervalMs !== undefined && !isPositiveInteger(config.server.pollIntervalMs)) {
    throw new Error('Invalid config: server.pollIntervalMs must be an integer greater than or equal to 1')
  }

  if (config.execution?.retries !== undefined && !isNonNegativeInteger(config.execution.retries)) {
    throw new Error('Invalid config: execution.retries must be an integer greater than or equal to 0')
  }

  if (config.execution?.scenarioTimeoutMs !== undefined && !isPositiveInteger(config.execution.scenarioTimeoutMs)) {
    throw new Error('Invalid config: execution.scenarioTimeoutMs must be an integer greater than or equal to 1')
  }

  if (config.execution?.stepTimeoutMs !== undefined && !isPositiveInteger(config.execution.stepTimeoutMs)) {
    throw new Error('Invalid config: execution.stepTimeoutMs must be an integer greater than or equal to 1')
  }

  if (config.execution?.retryOn && config.execution.retryOn !== 'infrastructure') {
    throw new Error('Invalid config: execution.retryOn must be "infrastructure"')
  }

  if (config.shard) {
    if (!isPositiveInteger(config.shard.index) || !isPositiveInteger(config.shard.total)) {
      throw new Error('Invalid config: shard.index and shard.total must be integers greater than or equal to 1')
    }
    if (config.shard.index > config.shard.total) {
      throw new Error('Invalid config: shard.index must be less than or equal to shard.total')
    }
  }

  if (config.output?.json && config.output.json.path !== undefined && config.output.json.path.length === 0) {
    throw new Error('Invalid config: output.json.path must not be empty')
  }

  if (config.output?.junit && config.output.junit.path !== undefined && config.output.junit.path.length === 0) {
    throw new Error('Invalid config: output.junit.path must not be empty')
  }

  if (browserEnv === 'BROWSERBASE') {
    const browserbaseApiKey = getConfigValue(config.browser?.apiKey, 'BROWSERBASE_API_KEY')
    const browserbaseProjectId = getConfigValue(config.browser?.projectId, 'BROWSERBASE_PROJECT_ID')

    if (!browserbaseApiKey) {
      throw new Error('Invalid config: browser.env "BROWSERBASE" requires BROWSERBASE_API_KEY or browser.apiKey')
    }

    if (!browserbaseProjectId) {
      throw new Error('Invalid config: browser.env "BROWSERBASE" requires BROWSERBASE_PROJECT_ID or browser.projectId')
    }
  }

  if (config.browser?.modelClientOptions?.apiKey) {
    return
  }

  const envVar = getModelApiKeyEnvVar(config.browser?.modelName)
  if (envVar && !process.env[envVar]) {
    throw new Error(
      `Missing API key for model "${config.browser?.modelName}". Set ${envVar} or browser.modelClientOptions.apiKey.`,
    )
  }
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
    return normalizeConfig(DEFAULT_CONFIG, { validate: false })
  }

  const mod = await import(resolvedPath)
  const userConfig = mod.default ?? mod

  // Support legacy 'stagehand' key as alias for 'browser'
  const browserConfig = userConfig.browser ?? userConfig.stagehand

  return normalizeConfig({
    language: userConfig.language,
    features: userConfig.features,
    server: userConfig.server ? resolveServerConfig(userConfig.server) : undefined,
    browser: {
      ...DEFAULT_CONFIG.browser,
      ...browserConfig,
    },
    screenshots: userConfig.screenshots,
    report: userConfig.report,
    output: userConfig.output,
    filter: userConfig.filter,
    shard: userConfig.shard,
    execution: userConfig.execution,
    concurrency: userConfig.concurrency ?? 3,
    verbose: userConfig.verbose ?? false,
  }, { validate: false })
}
