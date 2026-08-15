import type { ReportOpenMode } from './types'

function getWindowsOpenCommand(reportPath: string): string[] | null {
  const command = Bun.which('cmd.exe') ?? Bun.which('cmd')
  if (!command) return null
  return [command, '/c', 'start', '', reportPath]
}

export function getReportOpenCommand(
  reportPath: string,
  platform = process.platform,
): string[] | null {
  if (platform === 'darwin') {
    const command = Bun.which('open')
    return command ? [command, reportPath] : null
  }

  if (platform === 'linux') {
    const command = Bun.which('xdg-open')
    return command ? [command, reportPath] : null
  }

  if (platform === 'win32') {
    return getWindowsOpenCommand(reportPath)
  }

  return null
}

export function shouldOpenReport(options: {
  mode?: ReportOpenMode
  env?: NodeJS.ProcessEnv
  isTTY?: boolean
  platform?: NodeJS.Platform
  reportPath: string
}): boolean {
  const {
    mode = 'auto',
    env = process.env,
    isTTY = process.stdout.isTTY ?? false,
    platform = process.platform,
    reportPath,
  } = options

  const command = getReportOpenCommand(reportPath, platform)
  if (!command) return false

  if (mode === 'never') return false
  if (mode === 'always') return true

  return !env.CI && isTTY
}

export function openReport(reportPath: string, platform = process.platform): boolean {
  const command = getReportOpenCommand(reportPath, platform)
  if (!command) return false

  Bun.spawn(command, {
    stdout: 'ignore',
    stderr: 'ignore',
    stdin: 'ignore',
  })

  return true
}
