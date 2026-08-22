import {
  formatJson,
  formatJunit,
  formatNdjson,
  openTestRunStore,
  type TestRunManifest,
} from '@pickle-spec/runner'

export interface RunOutputOptions {
  junitPath?: string
  jsonPath?: string
  ndjsonPath?: string
}

type FinalizeEvidenceOptions = {
  includeEmptyRun?: boolean
}

export async function writeRunOutputs(
  options: RunOutputOptions,
  root: string,
  runId: string,
  manifest: TestRunManifest,
): Promise<void> {
  if (options.junitPath) {
    await Bun.write(options.junitPath, formatJunit(manifest))
  }
  if (options.jsonPath) await Bun.write(options.jsonPath, formatJson(manifest))
  if (options.ndjsonPath) {
    const persisted = await openTestRunStore({ root }).open(runId)
    await Bun.write(options.ndjsonPath, formatNdjson(await persisted.events()))
  }
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
  await writeRunOutputs(options, root, runId, manifest)
}
