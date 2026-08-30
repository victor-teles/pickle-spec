import { loadConfig, type PickleConfig } from '../configuration/config'
import { checkProject } from '../configuration/project'
import { terminalReporterCapabilities } from '../run/run-reporter'
import {
  createTerminalProgress,
  type TerminalProgress,
} from '../terminal/progress'
import { formatDoctorReport } from './doctor-output'
import {
  diagnoseProjectEnvironment,
  type ProjectEnvironmentReport,
} from './project-environment'

const usage =
  'Usage: pickle doctor [--config <path>] [--extensions <path>] [--verbose]'

interface DoctorArguments {
  configPath?: string
  extensionsPath?: string
  verbose: boolean
}

interface DoctorDependencies {
  cwd: string
  check(input: {
    cwd: string
    configPath?: string
    extensionsPath?: string
  }): Promise<void>
  load(configPath: string | undefined, cwd: string): Promise<PickleConfig>
  diagnose(config: PickleConfig): Promise<ProjectEnvironmentReport>
  color: boolean
  progress: TerminalProgress
  report(message: string): void
}

const terminalCapabilities = terminalReporterCapabilities(
  process.stdout.isTTY,
  process.stdout.columns,
  process.env.NO_COLOR,
  process.env.TERM,
)
const progressTerminalCapabilities = terminalReporterCapabilities(
  process.stderr.isTTY,
  process.stderr.columns,
  process.env.NO_COLOR,
  process.env.TERM,
)

const defaultDependencies: DoctorDependencies = {
  cwd: process.cwd(),
  check: checkProject,
  load: loadConfig,
  diagnose: diagnoseProjectEnvironment,
  color: terminalCapabilities.color ?? false,
  progress: createTerminalProgress({
    color: progressTerminalCapabilities.color ?? false,
    enabled:
      (progressTerminalCapabilities.interactive ?? false) &&
      (process.stderr.columns ?? 0) > 0,
  }),
  report: console.log,
}

function optionValue(argv: readonly string[], index: number): string {
  const value = argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(usage)
  return value
}

export function parseDoctorArguments(argv: readonly string[]): DoctorArguments {
  if (argv[0] !== 'doctor') throw new Error(usage)
  const args: DoctorArguments = { verbose: false }
  for (let index = 1; index < argv.length; index++) {
    const option = argv[index]
    if (option === '--config') {
      args.configPath = optionValue(argv, index++)
    } else if (option === '--extensions') {
      args.extensionsPath = optionValue(argv, index++)
    } else if (option === '--verbose') {
      args.verbose = true
    } else {
      throw new Error(usage)
    }
  }
  return args
}

export async function runDoctorCommand(
  argv: readonly string[],
  dependencies: DoctorDependencies = defaultDependencies,
): Promise<number> {
  const args = parseDoctorArguments(argv)
  let report: ProjectEnvironmentReport
  dependencies.progress.start('Checking project files')
  try {
    await dependencies.check({
      cwd: dependencies.cwd,
      configPath: args.configPath,
      extensionsPath: args.extensionsPath,
    })
    const config = await dependencies.load(args.configPath, dependencies.cwd)
    dependencies.progress.update('Checking configured environments')
    report = await dependencies.diagnose(config)
  } finally {
    dependencies.progress.stop()
  }
  for (const line of formatDoctorReport(report, {
    color: dependencies.color,
    verbose: args.verbose,
  })) {
    dependencies.report(line)
  }
  return report.ready ? 0 : 2
}

export { formatDoctorReport } from './doctor-output'
