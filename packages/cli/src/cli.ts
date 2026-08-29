#!/usr/bin/env bun

import { resolve } from 'node:path'
import type { EvidencePersistencePolicy } from '@pickle-spec/runner'
import {
  compareTestRuns,
  importRunArchive,
  openTestRunStore,
  publishTestRunExports,
  type TestRunExportRequest,
} from '@pickle-spec/runner'
import type { SelectionOptions, SpecificationState } from '@pickle-spec/spec'
import type {
  StudioAuthoringModel,
  StudioLiveViewportEvent,
  StudioManagementGateway,
  StudioRunGateway,
} from '@pickle-spec/studio'
import { createCredentialStore, startStudio } from '@pickle-spec/studio'
import {
  defaultModelName,
  screenshotModes,
  type WebAdapterOptions,
  type WebLiveViewportUpdate,
} from '@pickle-spec/web'
import cliPackage from '../package.json' with { type: 'json' }
import {
  defaultSpecificationGlob,
  loadConfig,
  type PickleConfig,
} from './configuration/config'
import {
  checkProject,
  initializeProject,
  migrateProject,
} from './configuration/project'
import { runDoctorCommand } from './doctor/doctor'
import { diagnoseProjectEnvironment } from './doctor/project-environment'
import { runCacheCommand } from './execution-cache/cache'
import { requiredValue } from './required-value'
import type { ApplicationOutputOptions } from './run/application-output'
import {
  loadExtensions,
  loadPersistedRun,
  loadProjectSpecifications,
  startProjectRun,
} from './run/execute-run'
import { parseTestRunOutput } from './run/output-arguments'
import {
  finalizeMaterializedEvidence,
  reportTestRunExportOutcomes,
  testRunExportFailed,
  writeRunOutputs,
} from './run/run-outputs'
import {
  createRunReporter,
  type RunReporterName,
  terminalReporterCapabilities,
} from './run/run-reporter'
import {
  createRunReportingSession,
  type RunReportingSession,
} from './run/run-reporting-session'
import { evaluateTestRunExitStatus } from './run/test-run-exit-status'
import { createStudioExecutionCacheGateway } from './studio/studio-cache'
import { createStudioHistoryGateway } from './studio/studio-history'
import {
  discoverStudioMobileTargets,
  studioMobileEnvironmentAdapterFactory,
  validateStudioMobileTargetCapabilities,
} from './studio/studio-mobile-targets'
import {
  loadStudioProject,
  patchStudioConfig,
  resolveConfigSecrets,
  saveStudioCredential,
  studioRunReadiness,
  studioRunReadinessWithEnvironment,
  studioRunSelection,
} from './studio/studio-project'
import { errorMessage, withRecoveryFailure } from './terminal/command-error'

interface RunArguments {
  pattern?: string
  configPath?: string
  extensionsPath?: string
  suite?: string
  profiles?: string[]
  selection: SelectionOptions
  retries?: number
  concurrency?: number
  language?: string
  scenarioTimeoutMs?: number
  stepTimeoutMs?: number
  reuseServer?: boolean
  headed?: boolean
  screenshotMode?: NonNullable<WebAdapterOptions['screenshots']>['mode']
  applicationRevision?: string
  outputs?: TestRunExportRequest[]
  force?: boolean
  allArtifacts?: boolean
  rerunId?: string
  failures?: boolean
  fast?: boolean
  refreshCache?: boolean
  cacheOnly?: boolean
  reporter?: RunReporterName
  applicationOutput?: ApplicationOutputOptions
  evidencePersistence?: EvidencePersistencePolicy
}

interface StudioArguments {
  configPath?: string
  extensionsPath?: string
  remoteHost?: string
  open: boolean
  port?: number
}

const dayMs = 24 * 60 * 60 * 1000

function integer(value: string, flag: string, minimum: number): number {
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < minimum) {
    throw new Error(
      `${flag} requires an integer greater than or equal to ${minimum}`,
    )
  }
  return parsed
}

function valueAfter(argv: string[], index: number): string {
  const value = argv[index + 1]
  if (!value || value.startsWith('--'))
    throw new Error(`${argv[index]} requires a value`)
  return value
}

function parseShard(value: string): { index: number; total: number } {
  const match = value.match(/^(\d+)\/(\d+)$/)
  if (!match) throw new Error('--shard requires <index>/<total>')
  return { index: Number(match[1]), total: Number(match[2]) }
}

interface ParsedRunOption {
  args: RunArguments
  nextIndex: number
}

function parsedRunOption(
  args: RunArguments,
  nextIndex: number,
  patch: Partial<RunArguments>,
): ParsedRunOption {
  return { args: { ...args, ...patch }, nextIndex }
}

function parsedSelectionOption(
  args: RunArguments,
  nextIndex: number,
  patch: Partial<RunArguments['selection']>,
): ParsedRunOption {
  return parsedRunOption(args, nextIndex, {
    selection: { ...args.selection, ...patch },
  })
}

function parseRunSelectionOption(
  args: RunArguments,
  argv: string[],
  index: number,
): ParsedRunOption | undefined {
  const flag = requiredValue(argv[index])
  switch (flag) {
    case '--suite':
      return parsedRunOption(args, index + 2, {
        suite: valueAfter(argv, index),
      })
    case '--profile':
      return parsedRunOption(args, index + 2, {
        profiles: [...(args.profiles ?? []), valueAfter(argv, index)],
      })
    case '--scenario':
      return parsedSelectionOption(args, index + 2, {
        scenarioName: valueAfter(argv, index),
      })
    case '--tag':
    case '-t':
      return parsedSelectionOption(args, index + 2, {
        tagExpression: valueAfter(argv, index),
      })
    case '--state':
      return parsedSelectionOption(args, index + 2, {
        states: [
          ...(args.selection.states ?? []),
          valueAfter(argv, index) as SpecificationState,
        ],
      })
    case '--shard':
      return parsedSelectionOption(args, index + 2, {
        shard: parseShard(valueAfter(argv, index)),
      })
    default:
      return undefined
  }
}

function parseRunConfigurationOption(
  args: RunArguments,
  argv: string[],
  index: number,
): ParsedRunOption | undefined {
  const flag = requiredValue(argv[index])
  switch (flag) {
    case '--config':
      return parsedRunOption(args, index + 2, {
        configPath: valueAfter(argv, index),
      })
    case '--extensions':
      return parsedRunOption(args, index + 2, {
        extensionsPath: valueAfter(argv, index),
      })
    case '--retries':
      return parsedRunOption(args, index + 2, {
        retries: integer(valueAfter(argv, index), flag, 0),
      })
    case '--concurrency':
    case '-j':
      return parsedRunOption(args, index + 2, {
        concurrency: integer(valueAfter(argv, index), flag, 1),
      })
    case '--language':
    case '-l':
      return parsedRunOption(args, index + 2, {
        language: valueAfter(argv, index),
      })
    case '--scenario-timeout':
      return parsedRunOption(args, index + 2, {
        scenarioTimeoutMs: integer(valueAfter(argv, index), flag, 1),
      })
    case '--step-timeout':
      return parsedRunOption(args, index + 2, {
        stepTimeoutMs: integer(valueAfter(argv, index), flag, 1),
      })
    case '--application-revision':
      return parsedRunOption(args, index + 2, {
        applicationRevision: valueAfter(argv, index),
      })
    default:
      return undefined
  }
}

function parseRunEvidenceOption(
  args: RunArguments,
  argv: string[],
  index: number,
): ParsedRunOption | undefined {
  const flag = requiredValue(argv[index])
  if (flag === '--screenshot') {
    const mode = valueAfter(argv, index)
    if (!screenshotModes.includes(mode as (typeof screenshotModes)[number])) {
      throw new Error('--screenshot requires off, on-failure, or on-step')
    }
    return parsedRunOption(args, index + 2, {
      screenshotMode: mode as RunArguments['screenshotMode'],
    })
  }
  if (flag === '--application-output') {
    const stream = valueAfter(argv, index)
    if (stream !== 'stdout' && stream !== 'stderr') {
      throw new Error('--application-output requires stdout or stderr')
    }
    return parsedRunOption(args, index + 2, {
      applicationOutput: { ...args.applicationOutput, [stream]: true },
    })
  }
  if (flag !== '--evidence') return undefined
  const persistence = valueAfter(argv, index)
  if (
    persistence !== 'off' &&
    persistence !== 'on-failure' &&
    persistence !== 'always'
  ) {
    throw new Error('--evidence requires off, on-failure, or always')
  }
  return parsedRunOption(args, index + 2, {
    evidencePersistence: persistence,
  })
}

function parseRunOutputOption(
  args: RunArguments,
  argv: string[],
  index: number,
): ParsedRunOption | undefined {
  const flag = requiredValue(argv[index])
  switch (flag) {
    case '--output':
      return parsedRunOption(args, index + 2, {
        outputs: [
          ...(args.outputs ?? []),
          parseTestRunOutput(valueAfter(argv, index)),
        ],
      })
    case '--rerun':
      return parsedRunOption(args, index + 2, {
        rerunId: valueAfter(argv, index),
      })
    case '--reporter': {
      const reporter = valueAfter(argv, index)
      if (reporter !== 'default' && reporter !== 'ndjson') {
        throw new Error('--reporter requires default or ndjson')
      }
      return parsedRunOption(args, index + 2, { reporter })
    }
    default:
      return undefined
  }
}

function parseRunBooleanOption(
  args: RunArguments,
  flag: string,
  index: number,
): ParsedRunOption | undefined {
  const fields: Partial<Record<string, keyof RunArguments>> = {
    '--reuse-server': 'reuseServer',
    '--headed': 'headed',
    '--force': 'force',
    '--all-artifacts': 'allArtifacts',
    '--failures': 'failures',
    '--fast': 'fast',
    '--refresh-cache': 'refreshCache',
    '--cache-only': 'cacheOnly',
  }
  const field = fields[flag]
  if (!field) return undefined
  return parsedRunOption(args, index + 1, { [field]: true })
}

function parseRunArguments(argv: string[]): RunArguments {
  if (argv[0] !== 'run')
    throw new Error('Usage: pickle run [specifications] [options]')
  let args: RunArguments = { selection: {} }
  let index = 1
  if (argv[index] && !requiredValue(argv[index]).startsWith('-')) {
    args = { ...args, pattern: argv[index] }
    index++
  }

  while (index < argv.length) {
    const flag = requiredValue(argv[index])
    const parsed =
      parseRunSelectionOption(args, argv, index) ??
      parseRunConfigurationOption(args, argv, index) ??
      parseRunEvidenceOption(args, argv, index) ??
      parseRunOutputOption(args, argv, index) ??
      parseRunBooleanOption(args, flag, index)
    if (!parsed) throw new Error(`Unknown option: ${flag}`)
    args = parsed.args
    index = parsed.nextIndex
  }
  if (args.refreshCache && args.cacheOnly) {
    throw new Error('--refresh-cache cannot be combined with --cache-only')
  }
  return args
}

interface RunCommandState {
  startedRunId?: string
  outputsWritten: boolean
}

interface RunCommandContext {
  args: RunArguments
  config: PickleConfig
  root: string
  controller: AbortController
  reporting: RunReportingSession
  startedAt: number
  state: RunCommandState
}

async function executeRunCommand(context: RunCommandContext): Promise<number> {
  const runState = context.state
  const started = await startProjectRun({
    root: context.root,
    config: context.config,
    options: context.args,
    signal: context.controller.signal,
    onEvent: context.reporting.event,
    onSchedule: context.reporting.prepare,
    onResult: context.reporting.complete,
  })
  runState.startedRunId = started.id
  context.reporting.start()
  const { runs } = await started.done
  const store = openTestRunStore({ root: context.root })
  const outputOutcomes = await writeRunOutputs(
    context.args,
    context.root,
    started.id,
  )
  runState.outputsWritten = true
  reportTestRunExportOutcomes(outputOutcomes, console.error)
  const retention = await store.applyRetention({
    maxAgeMs: context.config.retention?.days
      ? context.config.retention.days * dayMs
      : undefined,
    maxBytes: context.config.retention?.maxBytes,
  })
  if (context.config.retention?.days || context.config.retention?.maxBytes) {
    console.error(
      `RETENTION removed ${retention.removed.length} Test runs (${retention.beforeBytes} → ${retention.afterBytes} bytes)${retention.removed.length > 0 ? `: ${retention.removed.join(', ')}` : ''}`,
    )
  }
  const exitStatus = evaluateTestRunExitStatus(
    runs.map(({ result }) => result),
    { interrupted: context.controller.signal.aborted },
  )
  context.reporting.finish(
    runs,
    performance.now() - context.startedAt,
    exitStatus,
  )
  const reporterFailure = context.reporting.failure()
  if (reporterFailure) throw reporterFailure.error
  return testRunExportFailed(outputOutcomes) ? 2 : exitStatus.exitCode
}

async function recoverMaterializedEvidence(
  context: RunCommandContext,
  commandError: unknown,
  message: string,
  includeEmptyRun = false,
): Promise<unknown> {
  const runState = context.state
  const runId = runState.startedRunId
  if (!runId || runState.outputsWritten) return commandError
  try {
    const outcomes = await finalizeMaterializedEvidence(
      context.args,
      context.root,
      runId,
      includeEmptyRun ? { includeEmptyRun: true } : undefined,
    )
    reportTestRunExportOutcomes(outcomes, console.error)
    runState.outputsWritten = true
    return commandError
  } catch (recoveryError) {
    return withRecoveryFailure(commandError, message, recoveryError)
  }
}

function isInterruptedRun(error: unknown, context: RunCommandContext): boolean {
  return (
    context.controller.signal.aborted &&
    error instanceof Error &&
    error.name === 'AbortError'
  )
}

async function recoverInterruptedRun(
  context: RunCommandContext,
  commandError: unknown,
): Promise<{ commandError: unknown; exitCode?: number }> {
  if (!isInterruptedRun(commandError, context)) return { commandError }
  let recoveredError = await recoverMaterializedEvidence(
    context,
    commandError,
    'Failed to finalize interrupted evidence',
    true,
  )
  const exitStatus = evaluateTestRunExitStatus([], { interrupted: true })
  context.reporting.finish(
    [],
    performance.now() - context.startedAt,
    exitStatus,
  )
  const reporterFailure = context.reporting.failure()
  if (reporterFailure) {
    recoveredError = withRecoveryFailure(
      recoveredError,
      'Failed to render interrupted summary',
      reporterFailure.error,
    )
  } else if (context.state.outputsWritten) {
    return { commandError: recoveredError, exitCode: 130 }
  }
  return { commandError: recoveredError }
}

async function recoverRunCommand(
  context: RunCommandContext,
  error: unknown,
): Promise<number> {
  const interrupted = await recoverInterruptedRun(context, error)
  if (interrupted.exitCode !== undefined) return interrupted.exitCode
  let commandError = await recoverMaterializedEvidence(
    context,
    interrupted.commandError,
    'Failed to finalize materialized evidence',
  )
  const reporterFailure = context.reporting.fail(
    commandError,
    performance.now() - context.startedAt,
  )
  if (reporterFailure) {
    commandError = withRecoveryFailure(
      commandError,
      'Failed to restore reporter output',
      reporterFailure.error,
    )
  }
  throw commandError
}

async function run(argv: string[]): Promise<number> {
  const args = parseRunArguments(argv)
  const config = await loadConfig(args.configPath)
  const root = process.cwd()
  const controller = new AbortController()
  const onSigint = () => controller.abort()
  const reporter = createRunReporter(args.reporter ?? 'default', {
    projectRoot: root,
    version: cliPackage.version,
    ...terminalReporterCapabilities(
      process.stdout.isTTY,
      process.stdout.columns,
      process.env.NO_COLOR,
      process.env.TERM,
    ),
  })
  const reporting = createRunReportingSession(reporter)
  const onResize = reporting.refresh
  const startedAt = performance.now()
  const context: RunCommandContext = {
    args,
    config,
    root,
    controller,
    reporting,
    startedAt,
    state: { outputsWritten: false },
  }
  process.on('SIGINT', onSigint)
  if (process.stdout.isTTY) process.on('SIGWINCH', onResize)
  try {
    return await executeRunCommand(context)
  } catch (error) {
    return recoverRunCommand(context, error)
  } finally {
    process.off('SIGINT', onSigint)
    process.off('SIGWINCH', onResize)
  }
}

function projectOptions(argv: string[]): {
  configPath?: string
  extensionsPath?: string
} {
  const options: { configPath?: string; extensionsPath?: string } = {}
  for (let index = 1; index < argv.length; index++) {
    const flag = requiredValue(argv[index])
    if (flag === '--config') options.configPath = valueAfter(argv, index++)
    else if (flag === '--extensions')
      options.extensionsPath = valueAfter(argv, index++)
    else throw new Error(`Unknown option: ${flag}`)
  }
  return options
}

function migrateOptions(argv: string[]): {
  configPath?: string
  yes?: boolean
} {
  const options: { configPath?: string; yes?: boolean } = {}
  for (let index = 1; index < argv.length; index++) {
    const flag = requiredValue(argv[index])
    if (flag === '--config') options.configPath = valueAfter(argv, index++)
    else if (flag === '--yes' || flag === '-y') options.yes = true
    else throw new Error(`Unknown option: ${flag}`)
  }
  return options
}

async function compare(argv: string[]): Promise<number> {
  if (argv.length !== 3) {
    throw new Error('Usage: pickle compare <baseline-id> <candidate-id>')
  }
  const baseline = await loadPersistedRun(process.cwd(), requiredValue(argv[1]))
  const candidate = await loadPersistedRun(
    process.cwd(),
    requiredValue(argv[2]),
  )
  console.log(
    JSON.stringify(
      compareTestRuns(baseline.manifest, candidate.manifest),
      null,
      2,
    ),
  )
  return 0
}

async function importArchive(argv: string[]): Promise<number> {
  if (argv.length !== 2) throw new Error('Usage: pickle import <archive>')
  const imported = await importRunArchive({
    root: process.cwd(),
    archivePath: resolve(requiredValue(argv[1])),
  })
  console.log(
    JSON.stringify({
      kind: 'imported-run',
      id: imported.manifest.id,
      preservedArchivePath: imported.preservedArchivePath,
    }),
  )
  return 0
}

interface ExportArguments {
  runId: string
  outputs: TestRunExportRequest[]
  allArtifacts: boolean
  force: boolean
}

function exportRunId(argv: string[]): string {
  if (argv[0] !== 'export' || !argv[1]) {
    throw new Error(
      'Usage: pickle export <id> --output format=path [--output format=path] [--force] [--all-artifacts]',
    )
  }
  return argv[1]
}

function parseExportArguments(argv: string[]): ExportArguments {
  const runId = exportRunId(argv)
  const outputs: TestRunExportRequest[] = []
  let allArtifacts = false
  let force = false
  for (let index = 2; index < argv.length; index++) {
    const flag = requiredValue(argv[index])
    if (flag === '--output') {
      const output = parseTestRunOutput(valueAfter(argv, index++))
      outputs.push({ ...output, path: resolve(output.path) })
    } else if (flag === '--force') force = true
    else if (flag === '--all-artifacts') allArtifacts = true
    else throw new Error(`Unknown option: ${flag}`)
  }
  if (outputs.length === 0) {
    throw new Error('pickle export requires at least one --output format=path')
  }
  return { runId, outputs, allArtifacts, force }
}

async function warnForLargeHtmlExports(
  outputs: readonly TestRunExportRequest[],
): Promise<void> {
  const warningThreshold = 10 * 1024 * 1024
  for (const output of outputs) {
    if (output.format !== 'html') continue
    const file = Bun.file(output.path)
    if (!(await file.exists()) || file.size <= warningThreshold) continue
    console.error(
      `Warning: HTML export includes every available test artifact and is larger than 10 MB (${file.size} bytes).`,
    )
  }
}

async function exportRun(argv: string[]): Promise<number> {
  const { runId, outputs, allArtifacts, force } = parseExportArguments(argv)
  const outcomes = await publishTestRunExports({
    root: process.cwd(),
    runId,
    outputs,
    force,
    htmlArtifacts: allArtifacts ? 'all' : 'failures',
  })
  reportTestRunExportOutcomes(outcomes, console.log)

  if (allArtifacts) await warnForLargeHtmlExports(outputs)
  return testRunExportFailed(outcomes) ? 2 : 0
}

function parseStudioArguments(argv: string[]): StudioArguments {
  if (argv[0] !== 'studio') throw new Error('Usage: pickle studio [options]')
  const options: StudioArguments = { open: true }
  for (let index = 1; index < argv.length; index++) {
    const flag = requiredValue(argv[index])
    switch (flag) {
      case '--no-open':
        options.open = false
        break
      case '--port':
        options.port = integer(valueAfter(argv, index++), flag, 0)
        break
      case '--config':
        options.configPath = valueAfter(argv, index++)
        break
      case '--extensions':
        options.extensionsPath = valueAfter(argv, index++)
        break
      case '--remote':
        options.remoteHost = valueAfter(argv, index++)
        break
      default:
        throw new Error(`Unknown option: ${flag}`)
    }
  }
  return options
}

function authoringModel(modelName: string | undefined): StudioAuthoringModel {
  const value = modelName ?? defaultModelName
  const separator = value.indexOf('/')
  if (separator <= 0) return { provider: value, name: value }
  return {
    provider: value.slice(0, separator),
    name: value.slice(separator + 1),
  }
}

interface StudioCommandContext {
  args: StudioArguments
  credentials: ReturnType<typeof createCredentialStore>
  extensions: Awaited<ReturnType<typeof loadExtensions>>
  project: Parameters<typeof loadStudioProject>[0]
  root: string
}

function studioManagementGateway(
  context: StudioCommandContext,
): StudioManagementGateway {
  const { args, extensions, project, root } = context
  return {
    saveConfig: (patch) => patchStudioConfig(project, patch),
    saveCredential: (input) => saveStudioCredential(project, input),
    async discoverMobileTargets() {
      const config = await loadConfig(args.configPath, root)
      return discoverStudioMobileTargets(config, undefined, extensions.adapters)
    },
    async readiness(request) {
      const config = await loadConfig(args.configPath, root)
      const specifications = await loadProjectSpecifications(
        config.specifications ?? defaultSpecificationGlob,
        config.language,
        root,
      )
      const readiness = await studioRunReadiness(
        project,
        request,
        config,
        specifications,
      )
      const environment = await diagnoseProjectEnvironment(config, {
        profileIds: request?.profiles,
        mobileAdapterFactory: (profileId) =>
          studioMobileEnvironmentAdapterFactory(extensions.adapters, profileId),
      })
      return studioRunReadinessWithEnvironment(readiness, environment)
    },
  }
}

async function waitForStudioStop(
  server: Awaited<ReturnType<typeof startStudio>>,
  controller: AbortController,
): Promise<void> {
  await new Promise<void>((finish) => {
    const stop = () => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      controller.abort()
      server.stop()
      finish()
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  })
}

interface StudioRunGatewayInput {
  activeRuns: Map<string, AbortController>
  context: StudioCommandContext
  controller: AbortController
}

function studioLiveViewportEvent(
  update: WebLiveViewportUpdate,
): StudioLiveViewportEvent {
  if (update.kind === 'closed') {
    return { type: 'viewport-closed', target: update.target }
  }
  const { target, ...viewport } = update
  return { type: 'viewport-updated', target, viewport }
}

function studioRunGateway(input: StudioRunGatewayInput): StudioRunGateway {
  const { activeRuns, context, controller } = input
  const { args, credentials, extensions, root } = context
  return {
    async start(request, onEvent) {
      const runController = new AbortController()
      const onProcessAbort = () => runController.abort()
      controller.signal.addEventListener('abort', onProcessAbort, {
        once: true,
      })
      const config = await loadConfig(args.configPath, root)
      validateStudioMobileTargetCapabilities(
        config,
        await discoverStudioMobileTargets(
          config,
          undefined,
          extensions.adapters,
          request?.profiles,
        ),
        request?.profiles,
      )
      const started = await startProjectRun({
        root,
        config: await resolveConfigSecrets(config, credentials),
        options: {
          extensionsPath: args.extensionsPath,
          suite: request?.suite,
          profiles: request?.profiles ? [...request.profiles] : undefined,
          selection: studioRunSelection(request),
          rerunId: request?.rerunId,
          scenarioIds: request?.scenarioId ? [request.scenarioId] : undefined,
          failures: request?.failures,
          refreshCache: request?.refreshCache,
        },
        signal: runController.signal,
        onEvent,
        onSchedule: (schedule) => onEvent({ type: 'run-scheduled', schedule }),
        onApplicationDiagnostic: (event) =>
          onEvent({ type: 'diagnostic-recorded', ...event }),
        onLiveViewport: (update) => onEvent(studioLiveViewportEvent(update)),
      })
      activeRuns.set(started.id, runController)
      void started.done
        .catch((error) => console.error(errorMessage(error)))
        .finally(() => {
          activeRuns.delete(started.id)
          controller.signal.removeEventListener('abort', onProcessAbort)
        })
      return { id: started.id, done: started.done }
    },
    async snapshot(id) {
      const { events, manifest } = await loadPersistedRun(root, id)
      return { id, events, manifest }
    },
    async cancel(id) {
      activeRuns.get(id)?.abort()
    },
  }
}

async function studio(argv: string[]): Promise<number> {
  const args = parseStudioArguments(argv)
  const root = process.cwd()
  const credentials = createCredentialStore()
  const project = {
    root,
    configPath: args.configPath,
    credentials,
  }
  const config = await loadConfig(args.configPath, root)
  const specificationGlobs = config.specifications ?? defaultSpecificationGlob
  const model = authoringModel(config.web?.browser?.modelName)
  async function loadProject() {
    return loadStudioProject(project)
  }
  const extensions = await loadExtensions(args.extensionsPath, root)
  const controller = new AbortController()
  const activeRuns = new Map<string, AbortController>()
  const context: StudioCommandContext = {
    args,
    credentials,
    extensions,
    project,
    root,
  }
  const server = await startStudio({
    project: await loadProject(),
    loadProject,
    specificationGlobs,
    language: config.language,
    authoring: {
      model,
      propose: extensions.authorSpecification,
    },
    management: studioManagementGateway(context),
    executionCache: createStudioExecutionCacheGateway(root, async () => {
      const current = await loadConfig(args.configPath, root)
      return current.cache ?? {}
    }),
    history: createStudioHistoryGateway(root, async () => {
      const current = await loadConfig(args.configPath, root)
      return {
        maxAgeMs: current.retention?.days
          ? current.retention.days * dayMs
          : undefined,
        maxBytes: current.retention?.maxBytes,
      }
    }),
    gateway: studioRunGateway({ activeRuns, context, controller }),
    hostname: args.remoteHost,
    allowRemoteAccess: Boolean(args.remoteHost),
    open: args.open,
    port: args.port,
  })
  console.log(`Studio ${server.url}`)
  await waitForStudioStop(server, controller)
  return 0
}

async function main(argv: string[]): Promise<number> {
  const directCommand = directCommands[String(argv[0])]
  if (directCommand) return directCommand(argv)
  if (argv[0] === 'init') {
    if (argv.length > 1) throw new Error('Usage: pickle init')
    await initializeProject()
    return 0
  }
  if (argv[0] === 'studio') {
    return studio(argv)
  }
  if (argv[0] === 'check') {
    await checkProject({ ...projectOptions(argv), report: console.log })
    return 0
  }
  if (argv[0] === 'migrate') {
    await migrateProject({ ...migrateOptions(argv), report: console.log })
    return 0
  }
  if (argv[0] === 'compare') {
    return compare(argv)
  }
  if (argv[0] === 'import') {
    return importArchive(argv)
  }
  if (argv[0] === 'export') {
    return exportRun(argv)
  }
  return run(argv)
}

const directCommands: Readonly<
  Record<string, (argv: string[]) => Promise<number>>
> = {
  cache: runCacheCommand,
  doctor: runDoctorCommand,
}

try {
  process.exitCode = await main(Bun.argv.slice(2))
} catch (error) {
  console.error(`ERROR ${errorMessage(error)}`)
  process.exitCode = 2
}
