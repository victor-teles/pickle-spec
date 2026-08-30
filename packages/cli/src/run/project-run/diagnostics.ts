import type {
  ApplicationOutputAvailability,
  ApplicationOutputLine,
} from '../../server/server'
import { startServer } from '../../server/server'
import type { ApplicationDiagnosticBuffer } from '../application-diagnostics'
import { createApplicationDiagnosticBuffer } from '../application-diagnostics'
import { resolveApplicationOutput } from '../application-output'
import type { ResolvedProjectRunConfiguration } from './targets'
import type { ProjectRunOptions, StartProjectRunInput } from './types'

export type ManagedProjectServer = Awaited<ReturnType<typeof startServer>>

type StartedApplicationDiagnostics = {
  server: ManagedProjectServer
  diagnostics: ApplicationDiagnosticBuffer
}

export async function startApplicationDiagnostics(
  input: StartProjectRunInput,
  args: ProjectRunOptions,
  targets: ResolvedProjectRunConfiguration['targets'],
): Promise<StartedApplicationDiagnostics> {
  const applicationOutput = resolveApplicationOutput(
    input.config,
    targets.map(({ executionTargetProfile }) => executionTargetProfile),
    args.applicationOutput,
  )
  const pendingOutput: ApplicationOutputLine[] = []
  let diagnostics: ApplicationDiagnosticBuffer | undefined
  const server = await startServer(
    {
      ...input.config.server,
      output: applicationOutput.capture,
      reuseExisting: args.reuseServer
        ? true
        : input.config.server?.reuseExisting,
    },
    {
      signal: input.signal,
      onOutput(line) {
        if (diagnostics) diagnostics.record(line)
        else pendingOutput.push(line)
      },
    },
  )
  const unavailableOutput: ApplicationOutputAvailability = {
    stdout: applicationOutput.capture.stdout
      ? 'not-supported'
      : 'not-requested',
    stderr: applicationOutput.capture.stderr
      ? 'not-supported'
      : 'not-requested',
  }
  diagnostics = createApplicationDiagnosticBuffer({
    profiles: applicationOutput.profiles,
    availability: server?.outputAvailability ?? unavailableOutput,
    onDiagnostic: input.onApplicationDiagnostic,
  })
  for (const line of pendingOutput) diagnostics.record(line)
  return { server, diagnostics }
}
