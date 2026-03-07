import pc from 'picocolors'
import ora, { type Ora } from 'ora'
import type { StepResult, RunResult } from './types'
import type { LogLine } from '@browserbasehq/stagehand'

// --- Spinner ---

let spinner: Ora | null = null

export function reportStepStart(keyword: string, text: string): void {
  if (spinner) spinner.stop()
  spinner = ora({ text: `${keyword}${text}`, indent: 4 }).start()
}

function stopSpinner(): void {
  if (!spinner) return
  spinner.stop()
  spinner = null
}

// --- Parallel progress spinner ---

let parallelSpinner: Ora | null = null

export function startParallelProgress(total: number): { update(completed: number): void; stop(): void } {
  parallelSpinner = ora({ text: `Running scenarios (0/${total} completed)`, indent: 2 }).start()
  return {
    update(completed: number) {
      if (parallelSpinner) {
        parallelSpinner.text = `Running scenarios (${completed}/${total} completed)`
      }
    },
    stop() {
      if (parallelSpinner) {
        parallelSpinner.stop()
        parallelSpinner = null
      }
    },
  }
}

// --- Core reporters ---

export function reportFeatureStart(featureName: string, filePath: string): void {
  console.log('')
  console.log(pc.bold(pc.underline(`Feature: ${featureName}`)))
  console.log(pc.dim(`  ${filePath}`))
}

export function reportScenarioStart(scenarioName: string): void {
  console.log('')
  console.log(pc.bold(`  Scenario: ${scenarioName}`))
}

export function reportScenarioIgnored(scenarioName: string): void {
  console.log('')
  console.log(pc.yellow(`  ⊘ Scenario: ${scenarioName} ${pc.dim('(ignored)')}`))
}

export function reportStepResult(
  keyword: string,
  text: string,
  result: StepResult,
): void {
  stopSpinner()
  const duration = pc.dim(`(${result.durationMs}ms)`)

  switch (result.status) {
    case 'passed':
      console.log(pc.green(`    ✔ ${keyword}${text} ${duration}`))
      break
    case 'failed':
      console.log(pc.red(`    ✖ ${keyword}${text} ${duration}`))
      if (result.error) {
        console.log(pc.red(`      ${result.error}`))
      }
      if (result.screenshotPath) {
        console.log(pc.dim(`      Screenshot: ${result.screenshotPath}`))
      }
      break
    case 'skipped':
      console.log(pc.yellow(`    ⊘ ${keyword}${text} ${pc.dim('(skipped)')}`))
      break
  }
}

export function reportSummary(result: RunResult): void {
  console.log('')
  console.log(pc.bold('─'.repeat(60)))
  console.log('')

  const total = result.passed + result.failed + result.skipped

  if (result.failed === 0) {
    console.log(pc.green(pc.bold(`  All ${result.passed} scenario(s) passed`)))
  } else {
    console.log(pc.bold(`  Results: ${total} scenario(s)`))
    if (result.passed > 0) console.log(pc.green(`    ${result.passed} passed`))
    if (result.failed > 0) console.log(pc.red(`    ${result.failed} failed`))
    if (result.skipped > 0) console.log(pc.yellow(`    ${result.skipped} skipped`))
  }

  console.log(pc.dim(`\n  Total time: ${(result.totalDurationMs / 1000).toFixed(1)}s`))
  if (result.artifactsDir) {
    console.log(pc.dim(`  Artifacts: ${result.artifactsDir}`))
  }
  console.log('')
}

export function reportServerStarting(command: string): void {
  console.log(pc.dim(`Starting server: ${command}`))
}

export function reportServerReady(url: string): void {
  console.log(pc.green(`Server ready at ${url}`))
}

export function reportError(message: string): void {
  console.error(pc.red(pc.bold(`Error: ${message}`)))
}

let cancelledReported = false

export function reportCancelled(): void {
  if (cancelledReported) return
  cancelledReported = true
  stopSpinner()
  console.log('')
  console.log(pc.yellow(pc.bold('  Run cancelled by user (Ctrl+C)')))
  console.log(pc.dim('  Press Ctrl+C again to force exit'))
}

// --- Log suppression ---

const SUPPRESSED_LOG_PATTERNS = [
  /Using agent in default DOM mode/i,
  /will default to.*hybrid/i,
  /AI SDK Warning/,
  /\[Stagehand\]/,
  /\[v3-piercer\]/,
  /OUT OF SYNC/,
  /DEPRECATED/,
]

export function suppressThirdPartyLogs(): () => void {
  const origWarn = console.warn
  const origError = console.error
  const origLog = console.log

  const shouldSuppress = (args: unknown[]) => {
    const msg = typeof args[0] === 'string' ? args[0] : ''
    return SUPPRESSED_LOG_PATTERNS.some(p => p.test(msg))
  }

  console.warn = (...args: unknown[]) => {
    if (!shouldSuppress(args)) origWarn.apply(console, args)
  }
  console.error = (...args: unknown[]) => {
    if (!shouldSuppress(args)) origError.apply(console, args)
  }
  console.log = (...args: unknown[]) => {
    if (!shouldSuppress(args)) origLog.apply(console, args)
  }

  return () => {
    console.warn = origWarn
    console.error = origError
    console.log = origLog
  }
}

// --- Verbose logging ---

export function reportVerboseLog(line: LogLine): void {
  const msg = line.message
  if (!msg) return
  if (SUPPRESSED_LOG_PATTERNS.some(p => p.test(msg))) return

  reportVerbose(`[${line.category ?? 'stagehand'}] ${msg}`)
}

export function reportVerbose(message: string): void {
  if (spinner) {
    spinner.clear()
    console.log(pc.dim(`      ${message}`))
    spinner.render()
  } else {
    console.log(pc.dim(`      ${message}`))
  }
}

// --- Reporter Context (for parallel execution) ---

export interface ReporterContext {
  stepStart(keyword: string, text: string): void
  stepResult(keyword: string, text: string, result: StepResult): void
  scenarioStart(scenarioName: string): void
  scenarioIgnored(scenarioName: string): void
  verbose(message: string): void
  verboseLog(line: LogLine): void
  flush(): void
}

export function createDirectReporter(): ReporterContext {
  return {
    stepStart: reportStepStart,
    stepResult: reportStepResult,
    scenarioStart: reportScenarioStart,
    scenarioIgnored: reportScenarioIgnored,
    verbose: reportVerbose,
    verboseLog: reportVerboseLog,
    flush() {},
  }
}

export function createBufferedReporter(): ReporterContext {
  const lines: string[] = []

  function formatStepResult(keyword: string, text: string, result: StepResult): string[] {
    const duration = pc.dim(`(${result.durationMs}ms)`)
    const out: string[] = []
    switch (result.status) {
      case 'passed':
        out.push(pc.green(`    ✔ ${keyword}${text} ${duration}`))
        break
      case 'failed':
        out.push(pc.red(`    ✖ ${keyword}${text} ${duration}`))
        if (result.error) out.push(pc.red(`      ${result.error}`))
        if (result.screenshotPath) out.push(pc.dim(`      Screenshot: ${result.screenshotPath}`))
        break
      case 'skipped':
        out.push(pc.yellow(`    ⊘ ${keyword}${text} ${pc.dim('(skipped)')}`))
        break
    }
    return out
  }

  return {
    stepStart() {},
    stepResult(keyword, text, result) {
      lines.push(...formatStepResult(keyword, text, result))
    },
    scenarioStart(scenarioName) {
      lines.push('')
      lines.push(pc.bold(`  Scenario: ${scenarioName}`))
    },
    scenarioIgnored(scenarioName) {
      lines.push('')
      lines.push(pc.yellow(`  ⊘ Scenario: ${scenarioName} ${pc.dim('(ignored)')}`))
    },
    verbose(message) {
      lines.push(pc.dim(`      ${message}`))
    },
    verboseLog(line) {
      const msg = line.message
      if (!msg) return
      if (SUPPRESSED_LOG_PATTERNS.some(p => p.test(msg))) return
      lines.push(pc.dim(`      [${line.category ?? 'stagehand'}] ${msg}`))
    },
    flush() {
      for (const line of lines) console.log(line)
    },
  }
}
