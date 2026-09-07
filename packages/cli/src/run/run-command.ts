import { openTestRunStore } from '@pickle-spec/runner'
import cliPackage from '../../package.json' with { type: 'json' }
import type { RunCommandInput } from '../command-inputs'
import { loadConfig, type PickleConfig } from '../configuration/config'
import {
  commandErrorFrom,
  withRecoveryFailure,
} from '../terminal/command-error'
import { startProjectRun } from './execute-run'
import {
  finalizeMaterializedEvidence,
  reportTestRunExportOutcomes,
  testRunExportFailed,
  writeRunOutputs,
} from './run-outputs'
import { createRunReporter, terminalReporterCapabilities } from './run-reporter'
import {
  createRunReportingSession,
  type RunReportingSession,
} from './run-reporting-session'
import { evaluateTestRunExitStatus } from './test-run-exit-status'

type RunRecovery = { commandError: Error; exitCode?: number }

const dayMs = 24 * 60 * 60 * 1000

interface RunCommandState {
  startedRunId?: string
  outputsWritten: boolean
}

interface RunCommandContext {
  args: RunCommandInput
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
    onEvent: (...args) => context.reporting.event(...args),
    onSchedule: (...args) => context.reporting.prepare(...args),
    onResult: (...args) => context.reporting.complete(...args),
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
  cause: Error,
  message: string,
  includeEmptyRun = false,
): Promise<Error> {
  const runState = context.state
  const runId = runState.startedRunId
  if (!runId || runState.outputsWritten) return cause
  try {
    const outcomes = await finalizeMaterializedEvidence(
      context.args,
      context.root,
      runId,
      includeEmptyRun ? { includeEmptyRun: true } : undefined,
    )
    reportTestRunExportOutcomes(outcomes, console.error)
    runState.outputsWritten = true
    return cause
  } catch (recoveryError) {
    return withRecoveryFailure(cause, message, recoveryError)
  }
}

function isInterruptedRun(cause: unknown, context: RunCommandContext): boolean {
  return (
    context.controller.signal.aborted &&
    cause instanceof Error &&
    cause.name === 'AbortError'
  )
}

async function recoverInterruptedRun(
  context: RunCommandContext,
  cause: Error,
): Promise<RunRecovery> {
  if (!isInterruptedRun(cause, context)) return { commandError: cause }
  let recoveredError = await recoverMaterializedEvidence(
    context,
    cause,
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
  cause: Error,
): Promise<number> {
  const interrupted = await recoverInterruptedRun(context, cause)
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

export async function runCommand(args: RunCommandInput): Promise<number> {
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
  const onResize = () => reporting.refresh()
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
    return recoverRunCommand(context, commandErrorFrom(error))
  } finally {
    process.off('SIGINT', onSigint)
    process.off('SIGWINCH', onResize)
  }
}
