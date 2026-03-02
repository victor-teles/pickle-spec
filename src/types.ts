import type { Pickle, PickleStep } from '@cucumber/messages'

export interface ServerConfig {
  /** Shell command to start the dev server (e.g., 'bun run dev') */
  command?: string
  /** Port the server listens on */
  port?: number
  /** Full base URL for navigation (e.g., 'http://localhost:3000'). Auto-derived from port if omitted. */
  url?: string
  /** Timeout in ms to wait for server readiness. Default: 30000 */
  startupTimeout?: number
}

export interface BrowserConfig {
  /** 'LOCAL' or 'BROWSERBASE' */
  env?: 'LOCAL' | 'BROWSERBASE'
  /** Model name (e.g., 'claude-4-6-sonnet-latest', 'gpt-4o') */
  modelName?: string
  /** Model client options (apiKey, baseURL, etc.) */
  modelClientOptions?: {
    apiKey?: string
    baseURL?: string
  }
  /** Run browser in headless mode. Default: true */
  headless?: boolean
  /** Browserbase API key (when env is 'BROWSERBASE') */
  apiKey?: string
  /** Browserbase project ID */
  projectId?: string
  /** Verbose logging level */
  verbose?: 0 | 1 | 2
  /** DOM settle timeout in ms. Default: 3000 */
  domSettleTimeout?: number
  /** Act operation timeout in ms */
  actTimeoutMs?: number
}

export interface PickleSpecConfig {
  /** Default Gherkin dialect (e.g., 'en', 'pt', 'ja'). Default: 'en' */
  language?: string
  /** Glob pattern(s) for feature files  */
  features?: string | string[]
  server?: ServerConfig
  browser?: BrowserConfig
  screenshots?: ScreenshotConfig
}

// --- Screenshot Config ---

export type ScreenshotMode = 'off' | 'on-failure' | 'on-step'

export interface ScreenshotConfig {
  /** When to capture screenshots. Default: 'off' */
  mode?: ScreenshotMode
  /** Output directory for screenshots. Default: './pickle-artifacts' */
  outputDir?: string
  /** Image format. Default: 'png' */
  format?: 'png' | 'jpeg'
  /** Capture full scrollable page instead of viewport. Default: false */
  fullPage?: boolean
}

// --- Execution Result Types ---

export type StepStatus = 'passed' | 'failed' | 'skipped'

export interface StepResult {
  step: PickleStep
  status: StepStatus
  durationMs: number
  error?: string
  screenshotPath?: string
}

export type ScenarioStatus = 'passed' | 'failed' | 'skipped'

export interface ScenarioResult {
  pickle: Pickle
  status: ScenarioStatus
  steps: StepResult[]
  durationMs: number
}

export interface FeatureResult {
  featureFile: string
  featureName: string
  scenarios: ScenarioResult[]
  durationMs: number
}

export interface RunResult {
  features: FeatureResult[]
  totalDurationMs: number
  passed: number
  failed: number
  skipped: number
  artifactsDir?: string
}
