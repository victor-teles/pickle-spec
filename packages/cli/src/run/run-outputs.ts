import {
  openTestRunStore,
  publishTestRunExports,
  type TestRunExportOutcome,
  type TestRunExportRequest,
} from '@pickle-spec/runner'

export interface RunOutputOptions {
  outputs?: readonly TestRunExportRequest[]
  force?: boolean
  allArtifacts?: boolean
}

type FinalizeEvidenceOptions = {
  includeEmptyRun?: boolean
}

export async function writeRunOutputs(
  options: RunOutputOptions,
  root: string,
  runId: string,
): Promise<TestRunExportOutcome[]> {
  return publishTestRunExports({
    root,
    runId,
    outputs: options.outputs ?? [],
    force: options.force,
    htmlArtifacts: options.allArtifacts ? 'all' : 'failures',
  })
}

export async function finalizeMaterializedEvidence(
  options: RunOutputOptions,
  root: string,
  runId: string,
  finalizeOptions: FinalizeEvidenceOptions = {},
): Promise<TestRunExportOutcome[]> {
  const persisted = await openTestRunStore({ root }).open(runId)
  const events = await persisted.events()
  if (
    !finalizeOptions.includeEmptyRun &&
    !events.some((event) => event.type === 'scenario-finished')
  ) {
    return []
  }
  await persisted.materialize()
  return writeRunOutputs(options, root, runId)
}

export function reportTestRunExportOutcomes(
  outcomes: readonly TestRunExportOutcome[],
  write: (line: string) => void,
): void {
  for (const outcome of outcomes) {
    if (outcome.status === 'succeeded') {
      write(`OUTPUT succeeded ${outcome.format}=${outcome.path}`)
    } else {
      write(
        `OUTPUT failed ${outcome.format}=${outcome.path}: ${outcome.message}`,
      )
    }
  }
}

export function testRunExportFailed(
  outcomes: readonly TestRunExportOutcome[],
): boolean {
  return outcomes.some(({ status }) => status === 'failed')
}
