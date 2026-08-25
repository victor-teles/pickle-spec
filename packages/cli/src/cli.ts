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
import type { StudioAuthoringModel } from '@pickle-spec/studio'
import { createCredentialStore, startStudio } from '@pickle-spec/studio'
import {
  defaultModelName,
  screenshotModes,
  type WebAdapterOptions,
} from '@pickle-spec/web'
import cliPackage from '../package.json' with { type: 'json' }
import type { ApplicationOutputOptions } from './application-output'
import { runCacheCommand } from './cache'
import { errorMessage, withRecoveryFailure } from './command-error'
import { defaultSpecificationGlob, loadConfig } from './config'
import {
  loadExtensions,
  loadPersistedRun,
  loadProjectSpecifications,
  startProjectRun,
} from './execute-run'
import { parseTestRunOutput } from './output-arguments'
import { checkProject, initializeProject, migrateProject } from './project'
import {
  finalizeMaterializedEvidence,
  reportTestRunExportOutcomes,
  testRunExportFailed,
  writeRunOutputs,
} from './run-outputs'
import {
  createRunReporter,
  type RunReporterName,
  terminalReporterCapabilities,
} from './run-reporter'
import { createRunReportingSession } from './run-reporting-session'
import { createStudioExecutionCacheGateway } from './studio-cache'
import { createStudioHistoryGateway } from './studio-history'
import {
  discoverStudioMobileTargets,
  validateStudioMobileTargetCapabilities,
} from './studio-mobile-targets'
import {
  loadStudioProject,
  patchStudioConfig,
  resolveConfigSecrets,
  saveStudioCredential,
  studioRunReadiness,
  studioRunSelection,
} from './studio-project'
import { evaluateTestRunExitStatus } from './test-run-exit-status'

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

function parseRunArguments(argv: string[]): RunArguments {
  if (argv[0] !== 'run')
    throw new Error('Usage: pickle run [specifications] [options]')
  const args: RunArguments = { selection: {} }
  let index = 1
  if (argv[index] && !argv[index]!.startsWith('-')) args.pattern = argv[index++]

  while (index < argv.length) {
    const flag = argv[index]!
    switch (flag) {
      case '--config':
        args.configPath = valueAfter(argv, index++)
        break
      case '--extensions':
        args.extensionsPath = valueAfter(argv, index++)
        break
      case '--suite':
        args.suite = valueAfter(argv, index++)
        break
      case '--profile':
        args.profiles = [...(args.profiles ?? []), valueAfter(argv, index++)]
        break
      case '--scenario':
        args.selection.scenarioName = valueAfter(argv, index++)
        break
      case '--tag':
      case '-t':
        args.selection.tagExpression = valueAfter(argv, index++)
        break
      case '--state': {
        const state = valueAfter(argv, index++)
        args.selection.states = [
          ...(args.selection.states ?? []),
          state as SpecificationState,
        ]
        break
      }
      case '--shard':
        args.selection.shard = parseShard(valueAfter(argv, index++))
        break
      case '--retries':
        args.retries = integer(valueAfter(argv, index++), flag, 0)
        break
      case '--concurrency':
      case '-j':
        args.concurrency = integer(valueAfter(argv, index++), flag, 1)
        break
      case '--language':
      case '-l':
        args.language = valueAfter(argv, index++)
        break
      case '--scenario-timeout': {
        args.scenarioTimeoutMs = integer(valueAfter(argv, index++), flag, 1)
        break
      }
      case '--step-timeout':
        args.stepTimeoutMs = integer(valueAfter(argv, index++), flag, 1)
        break
      case '--reuse-server':
        args.reuseServer = true
        break
      case '--headed':
        args.headed = true
        break
      case '--screenshot': {
        const mode = valueAfter(argv, index++)
        if (
          !screenshotModes.includes(mode as (typeof screenshotModes)[number])
        ) {
          throw new Error('--screenshot requires off, on-failure, or on-step')
        }
        args.screenshotMode = mode as RunArguments['screenshotMode']
        break
      }
      case '--application-revision':
        args.applicationRevision = valueAfter(argv, index++)
        break
      case '--application-output': {
        const stream = valueAfter(argv, index++)
        if (stream !== 'stdout' && stream !== 'stderr') {
          throw new Error('--application-output requires stdout or stderr')
        }
        args.applicationOutput = {
          ...args.applicationOutput,
          [stream]: true,
        }
        break
      }
      case '--evidence': {
        const persistence = valueAfter(argv, index++)
        if (
          persistence !== 'off' &&
          persistence !== 'on-failure' &&
          persistence !== 'always'
        ) {
          throw new Error('--evidence requires off, on-failure, or always')
        }
        args.evidencePersistence = persistence
        break
      }
      case '--output':
        args.outputs = [
          ...(args.outputs ?? []),
          parseTestRunOutput(valueAfter(argv, index++)),
        ]
        break
      case '--force':
        args.force = true
        break
      case '--all-artifacts':
        args.allArtifacts = true
        break
      case '--rerun':
        args.rerunId = valueAfter(argv, index++)
        break
      case '--failures':
        args.failures = true
        break
      case '--fast':
        args.fast = true
        break
      case '--refresh-cache':
        args.refreshCache = true
        break
      case '--cache-only':
        args.cacheOnly = true
        break
      case '--reporter': {
        const reporter = valueAfter(argv, index++)
        if (reporter !== 'default' && reporter !== 'ndjson') {
          throw new Error('--reporter requires default or ndjson')
        }
        args.reporter = reporter
        break
      }
      default:
        throw new Error(`Unknown option: ${flag}`)
    }
    index++
  }
  if (args.refreshCache && args.cacheOnly) {
    throw new Error('--refresh-cache cannot be combined with --cache-only')
  }
  return args
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
  let startedRunId: string | undefined
  let outputsWritten = false
  process.on('SIGINT', onSigint)
  if (process.stdout.isTTY) process.on('SIGWINCH', onResize)
  try {
    const started = await startProjectRun({
      root,
      config,
      options: args,
      signal: controller.signal,
      onEvent: reporting.event,
      onSchedule: reporting.prepare,
      onResult: reporting.complete,
    })
    startedRunId = started.id
    reporting.start()
    const { runs } = await started.done
    const store = openTestRunStore({ root })
    const outputOutcomes = await writeRunOutputs(args, root, started.id)
    outputsWritten = true
    reportTestRunExportOutcomes(outputOutcomes, console.error)
    const retention = await store.applyRetention({
      maxAgeMs: config.retention?.days
        ? config.retention.days * dayMs
        : undefined,
      maxBytes: config.retention?.maxBytes,
    })
    if (config.retention?.days || config.retention?.maxBytes) {
      console.error(
        `RETENTION removed ${retention.removed.length} Test runs (${retention.beforeBytes} → ${retention.afterBytes} bytes)${retention.removed.length > 0 ? `: ${retention.removed.join(', ')}` : ''}`,
      )
    }

    const exitStatus = evaluateTestRunExitStatus(
      runs.map(({ result }) => result),
      { interrupted: controller.signal.aborted },
    )
    reporting.finish(runs, performance.now() - startedAt, exitStatus)
    const reporterFailure = reporting.failure()
    if (reporterFailure) throw reporterFailure.error
    return testRunExportFailed(outputOutcomes) ? 2 : exitStatus.exitCode
  } catch (error) {
    let commandError: unknown = error
    if (
      controller.signal.aborted &&
      error instanceof Error &&
      error.name === 'AbortError'
    ) {
      const exitStatus = evaluateTestRunExitStatus([], { interrupted: true })
      if (startedRunId && !outputsWritten) {
        try {
          const outcomes = await finalizeMaterializedEvidence(
            args,
            root,
            startedRunId,
            { includeEmptyRun: true },
          )
          reportTestRunExportOutcomes(outcomes, console.error)
          outputsWritten = true
        } catch (recoveryError) {
          commandError = withRecoveryFailure(
            commandError,
            'Failed to finalize interrupted evidence',
            recoveryError,
          )
        }
      }
      reporting.finish([], performance.now() - startedAt, exitStatus)
      const reporterFailure = reporting.failure()
      if (reporterFailure) {
        commandError = withRecoveryFailure(
          commandError,
          'Failed to render interrupted summary',
          reporterFailure.error,
        )
      } else if (outputsWritten) {
        return 130
      }
    }
    if (startedRunId && !outputsWritten) {
      try {
        const outcomes = await finalizeMaterializedEvidence(
          args,
          root,
          startedRunId,
        )
        reportTestRunExportOutcomes(outcomes, console.error)
      } catch (recoveryError) {
        commandError = withRecoveryFailure(
          commandError,
          'Failed to finalize materialized evidence',
          recoveryError,
        )
      }
    }
    const reporterRecoveryFailure = reporting.fail(
      commandError,
      performance.now() - startedAt,
    )
    if (reporterRecoveryFailure) {
      commandError = withRecoveryFailure(
        commandError,
        'Failed to restore reporter output',
        reporterRecoveryFailure.error,
      )
    }
    throw commandError
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
    const flag = argv[index]!
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
    const flag = argv[index]!
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
  const baseline = await loadPersistedRun(process.cwd(), argv[1]!)
  const candidate = await loadPersistedRun(process.cwd(), argv[2]!)
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
    archivePath: resolve(argv[1]!),
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

async function exportRun(argv: string[]): Promise<number> {
  if (argv[0] !== 'export' || !argv[1]) {
    throw new Error(
      'Usage: pickle export <id> --output format=path [--output format=path] [--force] [--all-artifacts]',
    )
  }
  const runId = argv[1]
  const outputs: TestRunExportRequest[] = []
  let allArtifacts = false
  let force = false
  for (let index = 2; index < argv.length; index++) {
    const flag = argv[index]!
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
  const outcomes = await publishTestRunExports({
    root: process.cwd(),
    runId,
    outputs,
    force,
    htmlArtifacts: allArtifacts ? 'all' : 'failures',
  })
  reportTestRunExportOutcomes(outcomes, console.log)

  const warningThreshold = 10 * 1024 * 1024
  if (allArtifacts) {
    for (const output of outputs) {
      const file = Bun.file(output.path)
      if (
        output.format === 'html' &&
        (await file.exists()) &&
        file.size > warningThreshold
      ) {
        console.error(
          `Warning: HTML export includes every available test artifact and is larger than 10 MB (${file.size} bytes).`,
        )
      }
    }
  }
  return testRunExportFailed(outcomes) ? 2 : 0
}

function parseStudioArguments(argv: string[]): StudioArguments {
  if (argv[0] !== 'studio') throw new Error('Usage: pickle studio [options]')
  const options: StudioArguments = { open: true }
  for (let index = 1; index < argv.length; index++) {
    const flag = argv[index]!
    if (flag === '--no-open') options.open = false
    else if (flag === '--port')
      options.port = integer(valueAfter(argv, index++), flag, 0)
    else if (flag === '--config') options.configPath = valueAfter(argv, index++)
    else if (flag === '--extensions')
      options.extensionsPath = valueAfter(argv, index++)
    else if (flag === '--remote') options.remoteHost = valueAfter(argv, index++)
    else throw new Error(`Unknown option: ${flag}`)
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

async function studio(argv: string[]): Promise<number> {
  const args = parseStudioArguments(argv)
  const root = process.cwd()
  const credentials = createCredentialStore()
  const context = {
    root,
    configPath: args.configPath,
    credentials,
  }
  const config = await loadConfig(args.configPath, root)
  const specificationGlobs = config.specifications ?? defaultSpecificationGlob
  const model = authoringModel(config.web?.browser?.modelName)
  async function loadProject() {
    return loadStudioProject(context)
  }
  const extensions = await loadExtensions(args.extensionsPath, root)
  const controller = new AbortController()
  const activeRuns = new Map<string, AbortController>()
  const server = await startStudio({
    project: await loadProject(),
    loadProject,
    specificationGlobs,
    language: config.language,
    authoring: {
      model,
      propose: extensions.authorSpecification,
    },
    management: {
      saveConfig: (patch) => patchStudioConfig(context, patch),
      saveCredential: (input) => saveStudioCredential(context, input),
      async discoverMobileTargets() {
        return discoverStudioMobileTargets(
          await loadConfig(args.configPath, root),
          undefined,
          extensions.adapters,
        )
      },
      async readiness(request) {
        const current = await loadConfig(args.configPath, root)
        const specifications = await loadProjectSpecifications(
          current.specifications ?? defaultSpecificationGlob,
          current.language,
          root,
        )
        const readiness = await studioRunReadiness(
          context,
          request,
          current,
          specifications,
        )
        if (!readiness.ready) return readiness
        try {
          validateStudioMobileTargetCapabilities(
            current,
            await discoverStudioMobileTargets(
              current,
              undefined,
              extensions.adapters,
              request?.profiles,
            ),
            request?.profiles,
          )
          return readiness
        } catch (reason) {
          return {
            ready: false,
            reasons: [
              ...readiness.reasons,
              reason instanceof Error ? reason.message : String(reason),
            ],
          }
        }
      },
    },
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
    gateway: {
      async start(request, onEvent) {
        const runController = new AbortController()
        const onProcessAbort = () => runController.abort()
        controller.signal.addEventListener('abort', onProcessAbort, {
          once: true,
        })
        const current = await loadConfig(args.configPath, root)
        validateStudioMobileTargetCapabilities(
          current,
          await discoverStudioMobileTargets(
            current,
            undefined,
            extensions.adapters,
            request?.profiles,
          ),
          request?.profiles,
        )
        const started = await startProjectRun({
          root,
          config: await resolveConfigSecrets(current, credentials),
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
          onSchedule(schedule) {
            onEvent({ type: 'run-scheduled', schedule })
          },
          onApplicationDiagnostic(event) {
            onEvent({ type: 'diagnostic-recorded', ...event })
          },
        })
        activeRuns.set(started.id, runController)
        void started.done
          .catch((error) => {
            console.error(
              error instanceof Error ? error.message : String(error),
            )
          })
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
    },
    hostname: args.remoteHost,
    allowRemoteAccess: Boolean(args.remoteHost),
    open: args.open,
    port: args.port,
  })
  console.log(`Studio ${server.url}`)
  await new Promise<void>((resolve) => {
    const stop = () => {
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      controller.abort()
      server.stop()
      resolve()
    }
    process.on('SIGINT', stop)
    process.on('SIGTERM', stop)
  })
  return 0
}

async function main(argv: string[]): Promise<number> {
  if (argv[0] === 'init') {
    if (argv.length > 1) throw new Error('Usage: pickle init')
    await initializeProject()
    return 0
  }
  if (argv[0] === 'studio') {
    return studio(argv)
  }
  if (argv[0] === 'cache') {
    return runCacheCommand(argv)
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

try {
  process.exitCode = await main(Bun.argv.slice(2))
} catch (error) {
  console.error(`ERROR ${errorMessage(error)}`)
  process.exitCode = 2
}
