import { resolve } from 'node:path'
import type { TestRunExportRequest } from '@pickle-spec/runner'
import { Command, CommanderError } from 'commander'
import cliPackage from '../package.json' with { type: 'json' }
import type {
  AppsCommandInput,
  CliActions,
  ProjectCommandInput,
  StudioCommandInput,
} from './command-inputs'
import { collect, integer, oneOf } from './command-value-parsers'
import { parseTestRunOutput } from './run/output-arguments'
import { addRunCommand } from './run-command-definition'

export interface CliProgram {
  parse(argv: readonly string[]): Promise<number>
}

export interface CliProgramOutput {
  write(message: string): void
}

interface StudioOptions {
  config?: string
  extensions?: string
  remote?: string
  open: boolean
  port?: number
}

interface ProjectOptions {
  config?: string
  extensions?: string
}

interface MigrateOptions {
  config?: string
  yes?: boolean
}

interface ExportOptions {
  output: TestRunExportRequest[]
  force?: boolean
  allArtifacts?: boolean
}

interface AppsOptions {
  platform: AppsCommandInput['platform']
  all?: boolean
}

interface DoctorOptions extends ProjectOptions {
  verbose?: boolean
}

function exportOutput(
  value: string,
  previous?: TestRunExportRequest[],
): TestRunExportRequest[] {
  const output = parseTestRunOutput(value)
  return collect({ ...output, path: resolve(output.path) }, previous)
}

function projectInput(options: ProjectOptions): ProjectCommandInput {
  return {
    configPath: options.config,
    extensionsPath: options.extensions,
  }
}

function addProjectOptions(command: Command): Command {
  return command
    .option('--config <path>', 'configuration file')
    .option('--extensions <path>', 'extensions file')
}

type SetExit = (code: number) => void

function addStudioCommand(
  program: Command,
  actions: CliActions,
  setExit: SetExit,
): void {
  const studio = addProjectOptions(
    program.command('studio').description('start the local Studio'),
  )
    .option('--remote <host>', 'listen on a remote host')
    .option('--no-open', 'do not open Studio in a browser')
    .option('--port <port>', 'server port', integer('--port', 0))
    .allowExcessArguments(false)
  studio.action(async () => {
    const options = studio.opts<StudioOptions>()
    const input: StudioCommandInput = {
      ...projectInput(options),
      remoteHost: options.remote,
      open: options.open,
      port: options.port,
    }
    setExit(await actions.studio(input))
  })
}

function addProjectCommands(
  program: Command,
  actions: CliActions,
  setExit: SetExit,
): void {
  program
    .command('init')
    .description('initialize a Pickle Spec project')
    .allowExcessArguments(false)
    .action(async () => setExit(await actions.init()))

  const check = addProjectOptions(
    program.command('check').description('validate project files'),
  ).allowExcessArguments(false)
  check.action(async () =>
    setExit(await actions.check(projectInput(check.opts()))),
  )

  const migrate = program
    .command('migrate')
    .description('preview and apply Specification metadata migrations')
    .option('--config <path>', 'configuration file')
    .option('-y, --yes', 'apply changes without prompting')
    .allowExcessArguments(false)
  migrate.action(async () => {
    const options = migrate.opts<MigrateOptions>()
    setExit(
      await actions.migrate({ configPath: options.config, yes: options.yes }),
    )
  })
}

function addArchiveCommands(
  program: Command,
  actions: CliActions,
  setExit: SetExit,
): void {
  program
    .command('compare <baseline-id> <candidate-id>')
    .description('compare two persisted Test runs')
    .allowExcessArguments(false)
    .action(async (baselineId: string, candidateId: string) => {
      setExit(await actions.compare({ baselineId, candidateId }))
    })

  program
    .command('import <archive>')
    .description('import a Test run archive')
    .allowExcessArguments(false)
    .action(async (archivePath: string) => {
      setExit(await actions.importArchive({ archivePath }))
    })

  const exportCommand = program
    .command('export <id>')
    .description('export a persisted Test run')
    .requiredOption('--output <format=path>', 'test run output', exportOutput)
    .option('--force', 'overwrite existing outputs')
    .option('--all-artifacts', 'include every artifact in HTML output')
    .allowExcessArguments(false)
  exportCommand.action(async (runId: string) => {
    const options = exportCommand.opts<ExportOptions>()
    setExit(
      await actions.exportRun({
        runId,
        outputs: options.output,
        allArtifacts: options.allArtifacts ?? false,
        force: options.force ?? false,
      }),
    )
  })
}

function addAppsCommand(
  program: Command,
  actions: CliActions,
  setExit: SetExit,
): void {
  const apps = program
    .command('apps')
    .description('list mobile applications')
    .requiredOption(
      '--platform <platform>',
      'mobile platform',
      oneOf('--platform', ['android', 'ios'] as const),
    )
    .option('--all', 'include system applications')
    .allowExcessArguments(false)
  apps.action(async () => {
    const options = apps.opts<AppsOptions>()
    setExit(
      await actions.apps({
        platform: options.platform,
        all: options.all ?? false,
      }),
    )
  })
}

function addCacheCommand(
  program: Command,
  actions: CliActions,
  setExit: SetExit,
): void {
  const cache = program
    .command('cache <operation>')
    .description('manage the Execution cache')
    .allowExcessArguments(false)
  cache.action(async (value: string) => {
    const operation = oneOf('cache operation', ['inspect', 'clear'] as const)(
      value,
    )
    setExit(await actions.cache({ operation }))
  })
}

function addDoctorCommand(
  program: Command,
  actions: CliActions,
  setExit: SetExit,
): void {
  const doctor = addProjectOptions(
    program.command('doctor').description('diagnose project environments'),
  )
    .option('--verbose', 'show passed checks')
    .allowExcessArguments(false)
  doctor.action(async () => {
    const options = doctor.opts<DoctorOptions>()
    setExit(
      await actions.doctor({
        ...projectInput(options),
        verbose: options.verbose ?? false,
      }),
    )
  })
}

function addCommands(
  program: Command,
  actions: CliActions,
  setExit: SetExit,
): void {
  addRunCommand(program, actions, setExit, addProjectOptions)
  addStudioCommand(program, actions, setExit)
  addProjectCommands(program, actions, setExit)
  addArchiveCommands(program, actions, setExit)
  addAppsCommand(program, actions, setExit)
  addCacheCommand(program, actions, setExit)
  addDoctorCommand(program, actions, setExit)
}

function commandError(error: CommanderError): Error {
  return new Error(error.message.replace(/^error: /, ''))
}

export function createCliProgram(
  actions: CliActions,
  output: CliProgramOutput = {
    write: (message) => process.stdout.write(message),
  },
): CliProgram {
  let exitCode = 0
  const program = new Command()
    .name('pickle')
    .description('Executable Specifications for web and mobile applications')
    .version(cliPackage.version)
    .allowExcessArguments(false)
    .configureOutput({
      writeOut: output.write,
      writeErr: () => {},
    })
    .exitOverride()

  addCommands(program, actions, (code) => {
    exitCode = code
  })

  return {
    async parse(argv) {
      exitCode = 0
      if (argv.length === 0) {
        program.outputHelp()
        return 0
      }
      try {
        await program.parseAsync([...argv], { from: 'user' })
        return exitCode
      } catch (error) {
        if (!(error instanceof CommanderError)) throw error
        if (error.exitCode === 0) return 0
        throw commandError(error)
      }
    },
  }
}
