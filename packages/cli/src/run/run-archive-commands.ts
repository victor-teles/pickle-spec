import { resolve } from 'node:path'
import {
  compareTestRuns,
  importRunArchive,
  publishTestRunExports,
  type TestRunExportRequest,
} from '@pickle-spec/runner'
import type {
  CompareCommandInput,
  ExportCommandInput,
  ImportCommandInput,
} from '../command-inputs'
import { loadPersistedRun } from './execute-run'
import { reportTestRunExportOutcomes, testRunExportFailed } from './run-outputs'

export async function compareRuns(input: CompareCommandInput): Promise<number> {
  const baseline = await loadPersistedRun(process.cwd(), input.baselineId)
  const candidate = await loadPersistedRun(process.cwd(), input.candidateId)
  console.log(
    JSON.stringify(
      compareTestRuns(baseline.manifest, candidate.manifest),
      null,
      2,
    ),
  )
  return 0
}

export async function importRunArchiveCommand(
  input: ImportCommandInput,
): Promise<number> {
  const imported = await importRunArchive({
    root: process.cwd(),
    archivePath: resolve(input.archivePath),
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

export async function exportRunCommand(
  input: ExportCommandInput,
): Promise<number> {
  const { runId, outputs, allArtifacts, force } = input
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
