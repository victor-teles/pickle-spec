import {
  listMobileApplications,
  type MobilePlatform,
} from '@pickle-spec/mobile'
import { requiredValue } from '../required-value'
import { terminalReporterCapabilities } from '../run/run-reporter'
import {
  createTerminalProgress,
  type TerminalProgress,
} from '../terminal/progress'

interface AppsArguments {
  platform: MobilePlatform
  all: boolean
}

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

function valueAfter(argv: string[], index: number): string {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) {
    throw new Error(`${argv[index]} requires a value`)
  }
  return value
}

function mobilePlatform(value: string): MobilePlatform {
  if (value === 'android' || value === 'ios') return value
  throw new Error('--platform requires android or ios')
}

function parseAppsArguments(argv: string[]): AppsArguments {
  let platform: MobilePlatform | undefined
  let all = false
  for (let index = 1; index < argv.length; index++) {
    const flag = requiredValue(argv[index])
    if (flag === '--platform') {
      platform = mobilePlatform(valueAfter(argv, index++))
    } else if (flag === '--all') all = true
    else throw new Error(`Unknown option: ${flag}`)
  }
  if (!platform) {
    throw new Error('Usage: pickle apps --platform android|ios [--all]')
  }
  return { platform, all }
}

export async function runAppsCommand(
  argv: string[],
  dependencies: AppsDependencies = defaultDependencies,
): Promise<number> {
  const args = parseAppsArguments(argv)
  const platformLabel = args.platform === 'ios' ? 'iOS' : 'Android'
  let applicationIds: string[]
  dependencies.progress.start(`Listing ${platformLabel} apps`)
  try {
    applicationIds = await dependencies.list({
      platform: args.platform,
      scope: args.all ? 'all' : 'user-installed',
    })
  } finally {
    dependencies.progress.stop()
  }
  for (const applicationId of applicationIds) {
    dependencies.report(applicationId)
  }
  return 0
}
