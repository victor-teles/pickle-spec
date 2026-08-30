import { createColors } from 'picocolors'
import type { ProjectEnvironmentReport } from './project-environment'

type Colors = ReturnType<typeof createColors>

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
  colors: Colors,
): string[] {
  if (check.kind === 'passed') {
    if (!options.verbose) return []
    const profiles = check.profileIds
      ? ` ${profileLabel(check.profileIds)}`
      : ''
    return [
      `${colors.green('✔')} ${check.title}${profiles}`,
      `  ${check.detail}`,
    ]
  }
  if (check.kind === 'skipped') {
    return [`${colors.yellow('○')} ${check.title}`, `  ${check.detail}`]
  }
  const lines = [
    `${colors.red('✖')} ${check.title} ${profileLabel(check.profileIds)}`,
    `  ${check.detail}`,
    colors.yellow('Advice:'),
  ]
  for (const advice of check.advice) lines.push(`  ${advice}`)
  return lines
}

export function formatDoctorReport(
  report: ProjectEnvironmentReport,
  options: DoctorReportOptions = { color: false, verbose: false },
): string[] {
  const checks = doctorChecks(report)
  const colors = createColors(options.color)
  const details = checks.flatMap((check) => checkLines(check, options, colors))
  return [
    ...summaryLines(checks, options),
    ...(details.length ? ['', ...details] : []),
  ]
}
