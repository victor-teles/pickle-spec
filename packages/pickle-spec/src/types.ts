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
  /** Reuse an already-running server instead of spawning command when healthy */
  reuseExisting?: boolean
  /** Optional path used for readiness checks instead of the base URL */
  readinessPath?: string
  /** Poll interval in ms for readiness checks. Default: 500 */
  pollIntervalMs?: number
}

export interface BrowserConfig {
  /** 'LOCAL' or 'BROWSERBASE' */
  env?: 'LOCAL' | 'BROWSERBASE'
  /** Model name with provider prefix (e.g., 'anthropic/claude-sonnet-4-6', 'openai/gpt-4o') */
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
  /** Verbose logging level mapped to Stagehand logging.level */
  verbose?: 0 | 1 | 2
  /** DOM settle timeout in ms. Default: 3000 */
  domSettleTimeout?: number
  /** Act operation timeout in ms. Default: 15000 */
  actTimeoutMs?: number
  /** Observe operation timeout in ms. Default: 10000 */
  observeTimeout?: number
  /** Navigation timeout in ms for page.goto(). Default: 15000 */
  navigationTimeout?: number
  /**
   * Enable Stagehand server-side caching (Browserbase only).
   * Takes precedence over deprecated `cacheDir`.
   */
  cache?: boolean
  /**
   * @deprecated Local disk cache is gone in Stagehand v4.
   * `false` disables caching; any string enables Browserbase server-side cache.
   */
  cacheDir?: string | false
  /** Re-infer an action when a cached selector fails. Default: true */
  selfHeal?: boolean
  /** Remove heavy DOM elements (video, iframe) and disable animations after navigation. Default: true */
  domSimplification?: boolean
}

export interface PickleSpecConfig {
  /** Default Gherkin dialect (e.g., 'en', 'pt', 'ja'). Default: 'en' */
  language?: string
  /** Glob pattern(s) for feature files  */
  features?: string | string[]
  server?: ServerConfig
  browser?: BrowserConfig
  screenshots?: ScreenshotConfig
  report?: ReportConfig
  output?: OutputConfig
  filter?: FilterConfig
  shard?: ShardConfig
  execution?: ExecutionConfig
  /** Max parallel scenarios per feature. Default: 3 (parallel) */
  concurrency?: number
  /** Enable verbose logging (Stagehand logs + third-party logs). Default: false */
  verbose?: boolean
}

// --- Screenshot Config ---

export type ScreenshotMode = 'off' | 'on-failure' | 'on-step'

export interface ScreenshotConfig {
  /** When to capture screenshots. Default: 'off' */
  mode?: ScreenshotMode
  /** Output directory for screenshots. Default: './.pickle/artifacts' */
  outputDir?: string
  /** Image format. Default: 'png' */
  format?: 'png' | 'jpeg'
  /** Capture full scrollable page instead of viewport. Default: false */
  fullPage?: boolean
}

export type ReportOpenMode = 'auto' | 'always' | 'never'

export interface ReportConfig {
  /** When to open the generated HTML report. Default: 'auto' */
  open?: ReportOpenMode
}

export interface OutputTargetConfig {
  path?: string
}

export interface OutputConfig {
  json?: OutputTargetConfig | false
  junit?: OutputTargetConfig | false
}

export interface FilterConfig {
  scenarioName?: string
  tagExpression?: string
}

export interface ShardConfig {
  index: number
  total: number
}

export type RetryOn = 'infrastructure'

export interface ExecutionConfig {
  retries?: number
  retryOn?: RetryOn
  scenarioTimeoutMs?: number
  stepTimeoutMs?: number
}

// --- Execution Result Types ---

export type StepStatus = 'passed' | 'failed' | 'skipped'
export type FailureKind = 'assertion' | 'infrastructure' | 'cancellation'

export interface StepResult {
  step: PickleStep
  status: StepStatus
  durationMs: number
  error?: string
  failureKind?: FailureKind
  screenshotPath?: string
  traceFramePaths?: string[]
}

export type ScenarioStatus = 'passed' | 'failed' | 'skipped'

export interface ScenarioResult {
  pickle: Pickle
  status: ScenarioStatus
  steps: StepResult[]
  durationMs: number
  error?: string
  failureKind?: FailureKind
  attempts?: number
  flaky?: boolean
  attemptResults?: ScenarioAttemptResult[]
}

export interface ScenarioAttemptResult {
  status: ScenarioStatus
  durationMs: number
  error?: string
  failureKind?: FailureKind
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
  cancelled?: boolean
  artifactsDir?: string
  reportPath?: string
  selection?: RunSelectionMetadata
  server?: RunServerMetadata
}

export interface RunSelectionMetadata {
  scenarioName?: string
  tagExpression?: string
  shard?: ShardConfig
}

export interface RunServerMetadata {
  mode?: 'spawned' | 'reused'
  url?: string
}
