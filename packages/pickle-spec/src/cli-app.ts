import { Command, InvalidArgumentError } from 'commander'
import { unlink } from 'node:fs/promises'
import pc from 'picocolors'
import { loadConfig, normalizeConfig } from './config'
import { parseFeatureFiles } from './parser'
import { runFeatures, cancelRun } from './runner'
import { reportSummary, reportError, reportCancelled } from './reporter'
import { generateHtmlReport } from './html-report'
import { detectPackageManager, getRunCommand, getAddCommand } from './package-manager'
import { openReport, shouldOpenReport } from './report-opening'
import { writeStructuredOutputs } from './output'
import { applyFilters, applyShard } from './selection'
import type { PickleSpecConfig, ReportOpenMode, ScreenshotMode, ShardConfig } from './types'

export interface RunCommandOptions {
  config?: string
  headed?: boolean
  verbose?: boolean
  tag?: string
  scenario?: string
  shard?: string
  json?: string
  junit?: string
  retries?: number
  scenarioTimeout?: number
  stepTimeout?: number
  reuseServer?: boolean
  language?: string
  screenshot?: string
  concurrency?: number
  reportOpenMode?: ReportOpenMode
}

interface CliRuntime {
  argv: string[]
  env: NodeJS.ProcessEnv
  isTTY: boolean
  platform: NodeJS.Platform
}

interface RunCommandDependencies {
  cancelRun: typeof cancelRun
  generateHtmlReport: typeof generateHtmlReport
  loadConfig: typeof loadConfig
  normalizeConfig: typeof normalizeConfig
  openReport: typeof openReport
  parseFeatureFiles: typeof parseFeatureFiles
  reportCancelled: typeof reportCancelled
  reportError: typeof reportError
  reportSummary: typeof reportSummary
  runFeatures: typeof runFeatures
  shouldOpenReport: typeof shouldOpenReport
  writeStructuredOutputs: typeof writeStructuredOutputs
  runtime: CliRuntime
}

interface InitCommandDependencies {
  detectPackageManager: typeof detectPackageManager
  getAddCommand: typeof getAddCommand
  getRunCommand: typeof getRunCommand
  log: (...args: unknown[]) => void
  reportError: typeof reportError
  spawn: typeof Bun.spawn
}

const DEFAULT_RUNTIME: CliRuntime = {
  argv: process.argv,
  env: process.env,
  isTTY: process.stdout.isTTY ?? false,
  platform: process.platform,
}

const DEFAULT_RUN_DEPS: RunCommandDependencies = {
  cancelRun,
  generateHtmlReport,
  loadConfig,
  normalizeConfig,
  openReport,
  parseFeatureFiles,
  reportCancelled,
  reportError,
  reportSummary,
  runFeatures,
  shouldOpenReport,
  writeStructuredOutputs,
  runtime: DEFAULT_RUNTIME,
}

const DEFAULT_INIT_DEPS: InitCommandDependencies = {
  detectPackageManager,
  getAddCommand,
  getRunCommand,
  log: console.log,
  reportError,
  spawn: Bun.spawn,
}

export function resolveReportOpenModeFromArgv(argv: string[]): ReportOpenMode | undefined {
  let mode: ReportOpenMode | undefined

  for (const arg of argv) {
    if (arg === '--open-report') mode = 'always'
    if (arg === '--no-open-report') mode = 'never'
  }

  return mode
}

function parseIntegerOption(value: string): number {
  if (!/^[+-]?\d+$/.test(value)) {
    throw new InvalidArgumentError(`"${value}" is not a valid integer`)
  }

  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed)) {
    throw new InvalidArgumentError(`"${value}" is not a valid integer`)
  }

  return parsed
}

function applyRunOverrides(config: PickleSpecConfig, opts: RunCommandOptions): PickleSpecConfig {
  const nextConfig: PickleSpecConfig = {
    ...config,
    browser: config.browser ? { ...config.browser } : undefined,
    screenshots: config.screenshots ? { ...config.screenshots } : undefined,
    report: config.report ? { ...config.report } : undefined,
    output: config.output ? {
      json: config.output.json === false ? false : config.output.json ? { ...config.output.json } : undefined,
      junit: config.output.junit === false ? false : config.output.junit ? { ...config.output.junit } : undefined,
    } : undefined,
    filter: config.filter ? { ...config.filter } : undefined,
    shard: config.shard ? { ...config.shard } : undefined,
    execution: config.execution ? { ...config.execution } : undefined,
    server: config.server ? { ...config.server } : undefined,
  }

  if (opts.headed && nextConfig.browser) {
    nextConfig.browser.headless = false
  }

  if (opts.screenshot !== undefined) {
    nextConfig.screenshots = {
      ...nextConfig.screenshots,
      mode: opts.screenshot as ScreenshotMode,
    }
  }

  if (opts.concurrency !== undefined) {
    nextConfig.concurrency = opts.concurrency
  }

  if (opts.reportOpenMode) {
    nextConfig.report = {
      ...nextConfig.report,
      open: opts.reportOpenMode,
    }
  }

  if (opts.json) {
    nextConfig.output = {
      ...nextConfig.output,
      json: {
        path: opts.json,
      },
    }
  }

  if (opts.junit) {
    nextConfig.output = {
      ...nextConfig.output,
      junit: {
        path: opts.junit,
      },
    }
  }

  if (opts.scenario) {
    nextConfig.filter = {
      ...nextConfig.filter,
      scenarioName: opts.scenario,
    }
  }

  if (opts.tag) {
    nextConfig.filter = {
      ...nextConfig.filter,
      tagExpression: opts.tag,
    }
  }

  if (opts.shard) {
    nextConfig.shard = parseShardArg(opts.shard)
  }

  if (opts.retries !== undefined) {
    nextConfig.execution = {
      ...nextConfig.execution,
      retries: opts.retries,
      retryOn: 'infrastructure',
    }
  }

  if (opts.scenarioTimeout !== undefined) {
    nextConfig.execution = {
      ...nextConfig.execution,
      scenarioTimeoutMs: opts.scenarioTimeout,
    }
  }

  if (opts.stepTimeout !== undefined) {
    nextConfig.execution = {
      ...nextConfig.execution,
      stepTimeoutMs: opts.stepTimeout,
    }
  }

  if (opts.reuseServer && nextConfig.server) {
    nextConfig.server.reuseExisting = true
  }

  return nextConfig
}

function parseShardArg(value: string): ShardConfig {
  const match = value.match(/^(\d+)\/(\d+)$/)
  if (!match) {
    throw new Error('Invalid shard value. Expected format "<index>/<total>", for example "1/3"')
  }

  return {
    index: parseInt(match[1]!, 10),
    total: parseInt(match[2]!, 10),
  }
}

export async function runCommandAction(
  glob: string | undefined,
  opts: RunCommandOptions,
  deps: RunCommandDependencies = DEFAULT_RUN_DEPS,
): Promise<number> {
  const onSigint = () => {
    deps.reportCancelled()
    deps.cancelRun()
  }
  process.on('SIGINT', onSigint)

  try {
    const loadedConfig = await deps.loadConfig(opts.config)
    const config = deps.normalizeConfig(applyRunOverrides(loadedConfig, opts))
    const language = opts.language ?? config.language
    const featurePatterns = glob ?? config.features ?? 'features/**/*.feature'
    const features = await deps.parseFeatureFiles(featurePatterns, language)
    const filteredFeatures = applyFilters(features, config.filter)
    const featuresToRun = applyShard(filteredFeatures, config.shard)

    if (featuresToRun.length === 0) {
      deps.reportError('No scenarios found matching the current filters')
      return 1
    }

    const result = await deps.runFeatures(featuresToRun, config, {
      verbose: opts.verbose ?? config.verbose ?? false,
    })
    result.selection = {
      scenarioName: config.filter?.scenarioName,
      tagExpression: config.filter?.tagExpression,
      shard: config.shard,
    }

    const reportPath = await deps.generateHtmlReport(result)
    result.reportPath = reportPath
    await deps.writeStructuredOutputs(result, config)
    deps.reportSummary(result)

    if (deps.shouldOpenReport({
      mode: config.report?.open,
      env: deps.runtime.env,
      isTTY: deps.runtime.isTTY,
      platform: deps.runtime.platform,
      reportPath,
    })) {
      deps.openReport(reportPath, deps.runtime.platform)
    }

    return result.failed > 0 || result.cancelled ? 1 : 0
  } catch (err) {
    deps.reportError(err instanceof Error ? err.message : String(err))
    return 1
  } finally {
    process.off('SIGINT', onSigint)
  }
}

export async function initCommandAction(
  deps: InitCommandDependencies = DEFAULT_INIT_DEPS,
): Promise<number> {
  const configPath = 'pickle.config.ts'
  const file = Bun.file(configPath)

  if (await file.exists()) {
    deps.reportError(`${configPath} already exists`)
    return 1
  }

  const pm = await deps.detectPackageManager()
  const runCmd = deps.getRunCommand(pm)

  const configContent = `import { defineConfig } from 'pickle-spec'

export default defineConfig({
  server: {
    command: '${runCmd} dev',
    port: 3000,
    url: 'http://localhost:3000',
  },
  browser: {
    env: 'LOCAL',
    modelName: 'anthropic/claude-sonnet-4-6',
    headless: true,
  },
})
`

  await Bun.write(configPath, configContent)
  deps.log(pc.green(`Created ${configPath}`))
  deps.log(pc.dim(`  Detected package manager: ${pm}`))

  deps.log('\nInstalling pickle-spec...')
  const addCmd = deps.getAddCommand(pm)
  let exitCode: number

  try {
    const proc = deps.spawn(addCmd.split(' ').concat('pickle-spec'), {
      stdout: 'inherit',
      stderr: 'inherit',
      cwd: process.cwd(),
    })
    exitCode = await proc.exited
  } catch (error) {
    return reportInstallFailureAndRollback(
      configPath,
      `Failed to install pickle-spec: ${error instanceof Error ? error.message : String(error)}`,
      deps,
    )
  }

  if (exitCode !== 0) {
    return reportInstallFailureAndRollback(
      configPath,
      `Failed to install pickle-spec (exit code ${exitCode})`,
      deps,
    )
  }

  deps.log(pc.green('\nPickle-spec is ready!'))
  return 0
}

async function reportInstallFailureAndRollback(
  configPath: string,
  message: string,
  deps: InitCommandDependencies,
): Promise<number> {
  try {
    await unlink(configPath)
  } catch (error) {
    deps.reportError(
      `${message}. Could not remove ${configPath}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return 1
  }

  deps.reportError(message)
  return 1
}

export function createProgram(version: string): Command {
  const program = new Command()

  program
    .name('pickle-spec')
    .description('Run Gherkin .feature files with AI-powered browser automation')
    .version(version)

  program
    .command('run')
    .description('Run feature files')
    .argument('[glob]', 'Glob pattern for feature files')
    .option('-c, --config <path>', 'Path to pickle.config.ts')
    .option('--headed', 'Show browser window (disable headless)')
    .option('--verbose', 'Enable verbose output')
    .option('-t, --tag <expr>', 'Filter scenarios by tag expression')
    .option('--scenario <text>', 'Filter scenarios by case-insensitive scenario name match')
    .option('--shard <index/total>', 'Run only one shard of the filtered runnable scenarios')
    .option('-l, --language <code>', 'Default Gherkin language (e.g., pt, ja, fr)')
    .option('--screenshot <mode>', 'Screenshot mode: off, on-failure, on-step')
    .option('--json <path>', 'Write machine-readable JSON output to the given path')
    .option('--junit <path>', 'Write JUnit XML output to the given path')
    .option('--retries <n>', 'Retry infrastructure failures this many times', parseIntegerOption)
    .option('--scenario-timeout <ms>', 'Fail a scenario attempt if it exceeds this timeout', parseIntegerOption)
    .option('--step-timeout <ms>', 'Fail a step if it exceeds this timeout', parseIntegerOption)
    .option('--reuse-server', 'Reuse an already-running healthy server when server.url is configured')
    .option('--open-report', 'Always open the generated HTML report')
    .option('--no-open-report', 'Never open the generated HTML report')
    .option('-j, --concurrency <n>', 'Max parallel scenarios per feature', parseIntegerOption)
    .action(async (glob: string | undefined, opts: Omit<RunCommandOptions, 'reportOpenMode'>) => {
      const exitCode = await runCommandAction(glob, {
        ...opts,
        reportOpenMode: resolveReportOpenModeFromArgv(process.argv),
      })
      process.exitCode = exitCode
    })

  program
    .command('init')
    .description('Create a starter pickle.config.ts and install pickle-spec')
    .action(async () => {
      process.exitCode = await initCommandAction()
    })

  return program
}
