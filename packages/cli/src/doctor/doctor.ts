import type { DoctorCommandInput } from '../command-inputs'
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

export async function runDoctorCommand(
  input: DoctorCommandInput,
  dependencies: DoctorDependencies = defaultDependencies,
): Promise<number> {
  let report: ProjectEnvironmentReport
  dependencies.progress.start('Checking project files')
  try {
    await dependencies.check({
      cwd: dependencies.cwd,
      configPath: input.configPath,
      extensionsPath: input.extensionsPath,
    })
    const config = await dependencies.load(input.configPath, dependencies.cwd)
    dependencies.progress.update('Checking configured environments')
    report = await dependencies.diagnose(config)
  } finally {
    dependencies.progress.stop()
  }
  for (const line of formatDoctorReport(report, {
    color: dependencies.color,
    verbose: input.verbose,
  })) {
    dependencies.report(line)
  }
  return report.ready ? 0 : 2
}

export { formatDoctorReport } from './doctor-output'
