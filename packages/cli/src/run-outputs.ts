import {
  formatJson,
  formatJunit,
  formatNdjson,
  openTestRunStore,
  type RunEvent,
  type TestRunManifest,
} from '@pickle-spec/runner'
import { loadPersistedRun } from './execute-run'

export interface RunOutputOptions {
  junitPath?: string
  jsonPath?: string
  ndjsonPath?: string
}

type FinalizeEvidenceOptions = {
  includeEmptyRun?: boolean
}

interface MaterializedRunEvidence {
  manifest: TestRunManifest
  events: RunEvent[]
}

async function writeMaterializedRunOutputs(
  options: RunOutputOptions,
  evidence: MaterializedRunEvidence,
): Promise<void> {
  if (options.junitPath) {
    await Bun.write(options.junitPath, formatJunit(evidence.manifest))
  }
  if (options.jsonPath) {
    await Bun.write(options.jsonPath, formatJson(evidence.manifest))
  }
  if (options.ndjsonPath) {
    await Bun.write(options.ndjsonPath, formatNdjson(evidence.events))
  }
}

export async function writeRunOutputs(
  options: RunOutputOptions,
  root: string,
  runId: string,
): Promise<void> {
  await writeMaterializedRunOutputs(
    options,
    await loadPersistedRun(root, runId),
  )
}

export async function finalizeMaterializedEvidence(
  options: RunOutputOptions,
  root: string,
  runId: string,
  finalizeOptions: FinalizeEvidenceOptions = {},
): Promise<void> {
  const persisted = await openTestRunStore({ root }).open(runId)
  const events = await persisted.events()
  if (
    !finalizeOptions.includeEmptyRun &&
    !events.some((event) => event.type === 'scenario-finished')
  ) {
    return
  }
  const manifest = await persisted.materialize()
  await writeMaterializedRunOutputs(options, { manifest, events })
}
