import type {
  EvidencePersistencePolicy,
  TestRunExportRequest,
} from '@pickle-spec/runner'
import { type SelectionOptions, specificationStates } from '@pickle-spec/spec'
import { screenshotModes } from '@pickle-spec/web'
import { type Command, InvalidArgumentError, Option } from 'commander'
import type { CliActions, RunCommandInput } from './command-inputs'
import { collect, integer, oneOf } from './command-value-parsers'
import type { ApplicationOutputOptions } from './run/application-output'
import { parseTestRunOutput } from './run/output-arguments'
import type { RunReporterName } from './run/run-reporter'

interface RunOptions {
  config?: string
  extensions?: string
  suite?: string
  profile?: string[]
  scenario?: string
  tag?: string
  state?: (typeof specificationStates)[number][]
  shard?: NonNullable<SelectionOptions['shard']>
  retries?: number
  concurrency?: number
  language?: string
  scenarioTimeout?: number
  stepTimeout?: number
  reuseServer?: boolean
  headed?: boolean
  screenshot?: (typeof screenshotModes)[number]
  applicationRevision?: string
  output?: TestRunExportRequest[]
  force?: boolean
  allArtifacts?: boolean
  rerun?: string
  failures?: boolean
  fast?: boolean
  refreshCache?: boolean
  cacheOnly?: boolean
  reporter?: RunReporterName
  applicationOutput?: ApplicationOutputOptions
  evidence?: EvidencePersistencePolicy
}

function collectString(value: string, previous: string[]): string[] {
  return collect(value, previous)
}

function collectSpecificationState(
  value: string,
  previous: (typeof specificationStates)[number][],
): (typeof specificationStates)[number][] {
  return collect(oneOf('--state', specificationStates)(value), previous)
}

function shard(value: string): NonNullable<SelectionOptions['shard']> {
  const match = value.match(/^(\d+)\/(\d+)$/)
  if (!match) {
    throw new InvalidArgumentError('--shard requires <index>/<total>')
  }
  return { index: Number(match[1]), total: Number(match[2]) }
}

function applicationOutput(
  value: string,
  previous?: ApplicationOutputOptions,
): ApplicationOutputOptions {
  if (value === 'stdout') return { ...previous, stdout: true }
  if (value === 'stderr') return { ...previous, stderr: true }
  throw new InvalidArgumentError(
    '--application-output requires stdout or stderr',
  )
}

function runOutput(
  value: string,
  previous?: TestRunExportRequest[],
): TestRunExportRequest[] {
  return collect(parseTestRunOutput(value), previous)
}

function runSelection(options: RunOptions): SelectionOptions {
  const selection: SelectionOptions = {}
  if (options.scenario !== undefined) {
    selection.scenarioName = options.scenario
  }
  if (options.tag !== undefined) selection.tagExpression = options.tag
  if (options.state !== undefined) selection.states = options.state
  if (options.shard !== undefined) selection.shard = options.shard
  return selection
}

function runInput(
  pattern: string | undefined,
  options: RunOptions,
): RunCommandInput {
  return {
    pattern,
    configPath: options.config,
    extensionsPath: options.extensions,
    suite: options.suite,
    profiles: options.profile,
    selection: runSelection(options),
    retries: options.retries,
    concurrency: options.concurrency,
    language: options.language,
    scenarioTimeoutMs: options.scenarioTimeout,
    stepTimeoutMs: options.stepTimeout,
    reuseServer: options.reuseServer,
    headed: options.headed,
    screenshotMode: options.screenshot,
    applicationRevision: options.applicationRevision,
    outputs: options.output,
    force: options.force,
    allArtifacts: options.allArtifacts,
    rerunId: options.rerun,
    failures: options.failures,
    fast: options.fast,
    refreshCache: options.refreshCache,
    cacheOnly: options.cacheOnly,
    reporter: options.reporter,
    applicationOutput: options.applicationOutput,
    evidencePersistence: options.evidence,
  }
}

function addRunSelectionOptions(command: Command): Command {
  return command
    .option('--suite <name>', 'named test suite')
    .option('--profile <profile>', 'execution target profile', collectString)
    .option('--scenario <name>', 'Scenario name query')
    .option('-t, --tag <expression>', 'tag expression')
    .option('--state <state>', 'Specification state', collectSpecificationState)
    .option('--shard <index/total>', 'balanced shard', shard)
}

function addRunExecutionOptions(command: Command): Command {
  return command
    .option('--retries <count>', 'retry count', integer('--retries', 0))
    .option(
      '-j, --concurrency <count>',
      'concurrent Scenarios',
      integer('--concurrency', 1),
    )
    .option('-l, --language <language>', 'Gherkin language')
    .option(
      '--scenario-timeout <ms>',
      'Scenario timeout',
      integer('--scenario-timeout', 1),
    )
    .option('--step-timeout <ms>', 'step timeout', integer('--step-timeout', 1))
    .option('--reuse-server', 'reuse the configured application server')
    .option('--headed', 'show the browser')
    .option(
      '--screenshot <mode>',
      'screenshot capture mode',
      oneOf('--screenshot', screenshotModes),
    )
    .option('--application-revision <revision>', 'application revision')
}

function addRunOutputOptions(command: Command): Command {
  return command
    .option('--output <format=path>', 'test run output', runOutput)
    .option('--force', 'overwrite existing outputs')
    .option('--all-artifacts', 'include every artifact in HTML output')
    .option('--rerun <id>', 'rerun a persisted Test run')
    .option('--failures', 'select failures from the source Test run')
    .option('--fast', 'prefer the fastest execution profile')
    .addOption(
      new Option(
        '--refresh-cache',
        'refresh reusable execution work',
      ).conflicts('cacheOnly'),
    )
    .option('--cache-only', 'require reusable execution work')
    .option(
      '--reporter <name>',
      'terminal reporter',
      oneOf('--reporter', ['default', 'ndjson'] as const),
    )
    .option(
      '--application-output <stream>',
      'capture application output stream',
      applicationOutput,
    )
    .option(
      '--evidence <policy>',
      'evidence persistence policy',
      oneOf('--evidence', ['off', 'on-failure', 'always'] as const),
    )
}

export function addRunCommand(
  program: Command,
  actions: CliActions,
  setExit: (code: number) => void,
  addProjectOptions: (command: Command) => Command,
): void {
  const base = addProjectOptions(
    program
      .command('run [specifications]')
      .description('run selected Specifications'),
  )
  const command = addRunOutputOptions(
    addRunExecutionOptions(addRunSelectionOptions(base)),
  ).allowExcessArguments(false)

  command.action(async (pattern: string | undefined) => {
    setExit(await actions.run(runInput(pattern, command.opts<RunOptions>())))
  })
}
