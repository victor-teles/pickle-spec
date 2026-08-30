import { listMobileApplications } from '@pickle-spec/mobile'
import type { AppsCommandInput } from '../command-inputs'
import { terminalReporterCapabilities } from '../run/run-reporter'
import {
  createTerminalProgress,
  type TerminalProgress,
} from '../terminal/progress'

interface AppsDependencies {
  list: typeof listMobileApplications
  progress: Pick<TerminalProgress, 'start' | 'stop'>
  report(applicationId: string): void
}

const progressTerminalCapabilities = terminalReporterCapabilities(
  process.stderr.isTTY,
  process.stderr.columns,
  process.env.NO_COLOR,
  process.env.TERM,
)

const defaultDependencies: AppsDependencies = {
  list: listMobileApplications,
  progress: createTerminalProgress({
    color: progressTerminalCapabilities.color ?? false,
    enabled:
      (progressTerminalCapabilities.interactive ?? false) &&
      (process.stderr.columns ?? 0) > 0,
  }),
  report: console.log,
}

export async function runAppsCommand(
  input: AppsCommandInput,
  dependencies: AppsDependencies = defaultDependencies,
): Promise<number> {
  const platformLabel = input.platform === 'ios' ? 'iOS' : 'Android'
  let applicationIds: string[]
  dependencies.progress.start(`Listing ${platformLabel} apps`)
  try {
    applicationIds = await dependencies.list({
      platform: input.platform,
      scope: input.all ? 'all' : 'user-installed',
    })
  } finally {
    dependencies.progress.stop()
  }
  for (const applicationId of applicationIds) {
    dependencies.report(applicationId)
  }
  return 0
}
