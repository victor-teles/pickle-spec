import { Chalk, type ChalkInstance } from 'chalk'
import ora from 'ora'
import type { ProjectEnvironmentReport } from './project-environment'

export interface DoctorProgress {
  start(label: string): void
  update(label: string): void
  stop(): void
}

interface DoctorProgressOptions {
  color: boolean
  enabled: boolean
  stream?: NodeJS.WritableStream
}

export interface DoctorReportOptions {
  color: boolean
  verbose: boolean
}

type DoctorCheck =
  | {
      kind: 'passed'
      title: string
      detail: string
      profileIds?: readonly string[]
    }
  | {
      kind: 'failed'
      title: string
      detail: string
      advice: readonly string[]
      profileIds: readonly string[]
    }
  | {
      kind: 'skipped'
      title: string
      detail: string
    }

const diagnosticTitles: Readonly<Record<string, string>> = {
  'web.local-browser': 'Local browser',
  'web.browserbase': 'Browserbase configuration',
  'web.cdp': 'CDP configuration',
  'mobile.android-emulator': 'Android Emulator',
  'mobile.ios-simulator': 'iOS Simulator',
}

function checkWord(count: number): string {
  return count === 1 ? 'check' : 'checks'
}

function issueWord(count: number): string {
  return count === 1 ? 'issue' : 'issues'
}

function profileLabel(profileIds: readonly string[]): string {
  const label = profileIds.length === 1 ? 'profile' : 'profiles'
  return `[${label}: ${profileIds.join(', ')}]`
}

function diagnosticTitle(id: string): string {
  return diagnosticTitles[id] ?? id
}

function doctorChecks(report: ProjectEnvironmentReport): DoctorCheck[] {
  const checks: DoctorCheck[] = [
    {
      kind: 'passed',
      title: 'Project files',
      detail: 'Configuration, extensions, and Specifications are valid.',
    },
  ]
  for (const item of report.diagnostics) {
    const title = diagnosticTitle(item.diagnostic.id)
    if (item.diagnostic.kind === 'ready') {
      checks.push({
        kind: 'passed',
        title,
        detail: item.diagnostic.message,
        profileIds: item.profileIds,
      })
    } else {
      checks.push({
        kind: 'failed',
        title,
        detail: item.diagnostic.message,
        advice: item.diagnostic.remediation.map(({ summary }) => summary),
        profileIds: item.profileIds,
      })
    }
  }
  for (const profileId of report.uncheckedProfileIds) {
    checks.push({
      kind: 'skipped',
      title: `Profile "${profileId}"`,
      detail:
        'Automatic environment checks are not available for this profile.',
    })
  }
  return checks
}

function summaryLines(
  checks: readonly DoctorCheck[],
  options: DoctorReportOptions,
): string[] {
  const passed = checks.filter(({ kind }) => kind === 'passed').length
  const failed = checks.filter(({ kind }) => kind === 'failed').length
  const skipped = checks.filter(({ kind }) => kind === 'skipped').length
  const checked = passed + failed
  const lines = [
    failed > 0
      ? `${passed}/${checked} ${checkWord(checked)} passed. ${failed} ${checkWord(failed)} failed. Possible ${issueWord(failed)} detected:`
      : `${passed}/${checked} ${checkWord(checked)} passed. No issues detected.`,
  ]
  if (skipped > 0) {
    lines.push(
      `${skipped} automatic ${checkWord(skipped)} skipped because no probe is available.`,
    )
  }
  if (!options.verbose && passed > 0) {
    lines.push('Use the --verbose flag to see details about passed checks.')
  }
  return lines
}

function checkLines(
  check: DoctorCheck,
  options: DoctorReportOptions,
  chalk: ChalkInstance,
): string[] {
  if (check.kind === 'passed') {
    if (!options.verbose) return []
    const profiles = check.profileIds
      ? ` ${profileLabel(check.profileIds)}`
      : ''
    return [
      `${chalk.green('✔')} ${check.title}${profiles}`,
      `  ${check.detail}`,
    ]
  }
  if (check.kind === 'skipped') {
    return [`${chalk.yellow('○')} ${check.title}`, `  ${check.detail}`]
  }
  const lines = [
    `${chalk.red('✖')} ${check.title} ${profileLabel(check.profileIds)}`,
    `  ${check.detail}`,
    chalk.yellow('Advice:'),
  ]
  for (const advice of check.advice) lines.push(`  ${advice}`)
  return lines
}

export function formatDoctorReport(
  report: ProjectEnvironmentReport,
  options: DoctorReportOptions = { color: false, verbose: false },
): string[] {
  const checks = doctorChecks(report)
  const chalk = new Chalk({ level: options.color ? 1 : 0 })
  const details = checks.flatMap((check) => checkLines(check, options, chalk))
  return [
    ...summaryLines(checks, options),
    ...(details.length ? ['', ...details] : []),
  ]
}

export function createDoctorProgress(
  options: DoctorProgressOptions,
): DoctorProgress {
  const spinner = ora({
    color: options.color ? 'cyan' : false,
    discardStdin: false,
    isEnabled: options.enabled,
    isSilent: !options.enabled,
    stream: options.stream ?? process.stderr,
  })

  return {
    start(label) {
      spinner.start(label)
    },
    update(label) {
      spinner.text = label
    },
    stop() {
      spinner.stop()
    },
  }
}
