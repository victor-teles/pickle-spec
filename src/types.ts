import type { Pickle, PickleStep } from '@cucumber/messages'

export interface ServerConfig {
  /** Shell command to start the dev server (e.g., 'bun run dev') */
  command: string
  /** Port the server listens on */
  port: number
  /** Full base URL for navigation (e.g., 'http://localhost:3000') */
  url: string
  /** Timeout in ms to wait for server readiness. Default: 30000 */
  startupTimeout?: number
}

export interface StagehandConfig {
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
}

export interface PickleSpecConfig {
  server?: ServerConfig
  stagehand?: StagehandConfig
}

// --- Execution Result Types ---

export type StepStatus = 'passed' | 'failed' | 'skipped'

export interface StepResult {
  step: PickleStep
  status: StepStatus
  durationMs: number
  error?: string
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
}
