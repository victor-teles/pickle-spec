import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import {
  assertAllureArtifactPath,
  projectAllureResults,
} from './allure-results'
import { writeRunArchive } from './archive'
import { publishAtomicOutput } from './atomic-output'
import { resolveLocalProjectStorage } from './local-project-storage'
import { formatHtml, formatJson, formatJunit, formatNdjson } from './outputs'
import type { RunEvent } from './run-scenario'
import { parseTestRunManifest } from './test-run-schema'
import { openTestRunStore, type TestRunManifest } from './test-run-store'

export const testRunExportFormats = [
  'json',
  'ndjson',
  'junit',
  'html',
  'archive',
  'allure',
] as const

export type TestRunExportFormat = (typeof testRunExportFormats)[number]

export interface TestRunExportRequest {
  format: TestRunExportFormat
  path: string
}

export type TestRunExportOutcome = TestRunExportRequest &
  ({ status: 'succeeded' } | { status: 'failed'; message: string })

export interface PublishTestRunExportsInput {
  root: string
  pickleHome?: string
  runId: string
  outputs: readonly TestRunExportRequest[]
  force?: boolean
  htmlArtifacts?: 'failures' | 'all'
}

interface FinalizedTestRun {
  manifest: TestRunManifest
  events: RunEvent[]
}

async function loadFinalizedTestRun(
  input: Pick<PublishTestRunExportsInput, 'root' | 'pickleHome' | 'runId'>,
): Promise<FinalizedTestRun> {
  const store = openTestRunStore({
    root: input.root,
    pickleHome: input.pickleHome,
  })
  const run = await store.open(input.runId)
  const events = await run.events()
  if (events.length === 0) throw new Error(`Unknown test run "${input.runId}"`)
  const manifestPath = join(
    resolveLocalProjectStorage(input.root, input.pickleHome).runsDirectory,
    input.runId,
    'manifest.json',
  )
  if (!(await Bun.file(manifestPath).exists())) {
    throw new Error(`Test run "${input.runId}" must be finalized before export`)
  }
  const manifest = parseTestRunManifest(
    await Bun.file(manifestPath).json(),
    (version): never => {
      throw new Error(
        `Test run storage schema version ${String(version)} is unsupported`,
      )
    },
  )
  if (!manifest.finishedAt) {
    throw new Error(`Test run "${input.runId}" must be finalized before export`)
  }
  return { manifest, events }
}

async function writeAllureResults(
  destination: string,
  manifest: TestRunManifest,
  artifactsDirectory: string,
): Promise<void> {
  await mkdir(destination)
  const projection = projectAllureResults(manifest)
  for (const { fileName, result } of projection.results) {
    await Bun.write(
      join(destination, fileName),
      `${JSON.stringify(result, null, 2)}\n`,
    )
  }
  for (const { sourcePath, fileName } of projection.attachments) {
    const source = Bun.file(sourcePath)
    if (!(await source.exists())) {
      throw new Error(`Artifact source file is missing: ${sourcePath}`)
    }
    await assertAllureArtifactPath(sourcePath, artifactsDirectory)
    await Bun.write(join(destination, fileName), source)
  }
}

async function writeExport(
  input: PublishTestRunExportsInput,
  evidence: FinalizedTestRun,
  output: TestRunExportRequest,
  stagedPath: string,
): Promise<void> {
  switch (output.format) {
    case 'json':
      await Bun.write(stagedPath, formatJson(evidence.manifest))
      return
    case 'ndjson':
      await Bun.write(stagedPath, formatNdjson(evidence.events))
      return
    case 'junit':
      await Bun.write(stagedPath, formatJunit(evidence.manifest))
      return
    case 'html':
      await Bun.write(
        stagedPath,
        await formatHtml(evidence.manifest, {
          artifacts: input.htmlArtifacts ?? 'failures',
        }),
      )
      return
    case 'archive':
      await writeRunArchive({
        root: input.root,
        pickleHome: input.pickleHome,
        runId: input.runId,
        outputPath: stagedPath,
      })
      return
    case 'allure':
      await writeAllureResults(
        stagedPath,
        evidence.manifest,
        join(
          resolveLocalProjectStorage(input.root, input.pickleHome)
            .runsDirectory,
          input.runId,
          'artifacts',
        ),
      )
  }
}

function failureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function publishTestRunExports(
  input: PublishTestRunExportsInput,
): Promise<TestRunExportOutcome[]> {
  if (input.outputs.length === 0) return []
  const evidence = await loadFinalizedTestRun(input)
  const outcomes: TestRunExportOutcome[] = []
  for (const output of input.outputs) {
    try {
      await publishAtomicOutput(
        output.path,
        output.format === 'allure' ? 'directory' : 'file',
        input.force ?? false,
        (stagedPath) => writeExport(input, evidence, output, stagedPath),
      )
      outcomes.push({ ...output, status: 'succeeded' })
    } catch (error) {
      outcomes.push({
        ...output,
        status: 'failed',
        message: failureMessage(error),
      })
    }
  }
  return outcomes
}
