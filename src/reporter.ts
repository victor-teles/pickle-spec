import pc from 'picocolors'
import type { StepResult, RunResult } from './types'
import type { LogLine } from '@browserbasehq/stagehand'

export function reportFeatureStart(featureName: string, filePath: string): void {
  console.log('')
  console.log(pc.bold(pc.underline(`Feature: ${featureName}`)))
  console.log(pc.dim(`  ${filePath}`))
}

export function reportScenarioStart(scenarioName: string): void {
  console.log('')
  console.log(pc.bold(`  Scenario: ${scenarioName}`))
}

export function reportStepResult(
  keyword: string,
  text: string,
  result: StepResult,
): void {
  const duration = pc.dim(`(${result.durationMs}ms)`)

  switch (result.status) {
    case 'passed':
      console.log(pc.green(`    ${keyword}${text} ${duration}`))
      break
    case 'failed':
      console.log(pc.red(`    ${keyword}${text} ${duration}`))
      if (result.error) {
        console.log(pc.red(`      ${result.error}`))
      }
      if (result.screenshotPath) {
        console.log(pc.dim(`      Screenshot: ${result.screenshotPath}`))
      }
      break
    case 'skipped':
      console.log(pc.yellow(`    ${keyword}${text} ${pc.dim('(skipped)')}`))
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

const SUPPRESSED_LOG_PATTERNS = [
  /Using agent in default DOM mode/i,
  /will default to.*hybrid/i,
]

export function reportVerboseLog(line: LogLine): void {
  const msg = line.message
  if (!msg) return
  if (SUPPRESSED_LOG_PATTERNS.some(p => p.test(msg))) return

  const category = line.category ? `[${line.category}] ` : ''
  console.log(pc.dim(`      ${category}${msg}`))
}

export function reportVerbose(message: string): void {
  console.log(pc.cyan(`      ${message}`))
}
