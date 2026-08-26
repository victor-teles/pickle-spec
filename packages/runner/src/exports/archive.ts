import { mkdir, open, rm, stat } from 'node:fs/promises'
import { dirname, join, relative, resolve, sep } from 'node:path'
import type {
  RunEvent,
  ScenarioAttempt,
  TestArtifact,
  TestResult,
  TestStepResult,
} from '../execution/run-scenario'
import { testRunSchemaVersion } from '../execution/run-scenario'
import {
  publicRunEvent,
  recordableTestResult,
  withoutPrivateStepResultData,
} from '../results/public-results'
import { parseTestRunManifest } from '../results/test-run-schema'
import {
  aggregateTestResultState,
  materializeTestResults,
  openTestRunStore,
  type TestRunManifest,
} from '../results/test-run-store'
import { resolveLocalProjectStorage } from '../storage/local-project-storage'
import { parseRunArchive } from './archive-migrate'

export { parseRunArchive }

export interface RunArchiveArtifact {
  path: string
  mediaType?: string
  content: string
}

export interface RunArchive {
  schemaVersion: typeof testRunSchemaVersion
  kind: 'run-archive'
  manifest: TestRunManifest
  events: RunEvent[]
  artifacts: RunArchiveArtifact[]
}

export interface WriteRunArchiveInput {
  root: string
  pickleHome?: string
  runId: string
  outputPath: string
}

export interface ImportRunArchiveInput {
  root: string
  pickleHome?: string
  archivePath: string
}

export interface ImportedRunArchive {
  manifest: TestRunManifest
  events: RunEvent[]
  preservedArchivePath: string
}

interface CollectedArtifact {
  absolutePath: string
  archivePath: string
  mediaType?: string
}

type MapArtifactPath = (path: string) => string

type NodeError = Error & { code?: string }

function collectArtifacts(
  manifest: TestRunManifest,
  events: readonly RunEvent[],
  runDirectory: string,
): CollectedArtifact[] {
  const byAbsolute = new Map<string, CollectedArtifact>()
  for (const artifact of artifactReferences(manifest, events)) {
    const absolutePath = resolve(artifact.path)
    if (byAbsolute.has(absolutePath)) continue
    byAbsolute.set(absolutePath, {
      absolutePath,
      archivePath: containedArtifactPath(runDirectory, absolutePath),
      mediaType: artifact.mediaType,
    })
  }
  return [...byAbsolute.values()]
}

function archiveArtifactReferences(archive: RunArchive): TestArtifact[] {
  return artifactReferences(archive.manifest, archive.events)
}

function artifactReferences(
  manifest: TestRunManifest,
  events: readonly RunEvent[],
): TestArtifact[] {
  const artifacts: TestArtifact[] = []
  const collectSteps = (steps: readonly TestStepResult[]) => {
    for (const step of steps) {
      artifacts.push(...(step.artifacts ?? []))
    }
  }
  for (const result of manifest.results) {
    for (const attempt of result.attempts) collectSteps(attempt.steps)
  }
  for (const event of events) {
    if (event.type === 'scenario-finished') collectSteps(event.attempt.steps)
    if (event.type === 'step-finished') collectSteps([event.result])
  }
  return artifacts
}

function mapAttemptArtifacts(
  attempt: ScenarioAttempt,
  mapPath: MapArtifactPath,
): ScenarioAttempt {
  return {
    ...attempt,
    steps: attempt.steps.map((step) => mapStepArtifacts(step, mapPath)),
  }
}

function mapStepArtifacts(
  step: TestStepResult,
  mapPath: MapArtifactPath,
): TestStepResult {
  const publicStep = withoutPrivateStepResultData(step)
  if (!publicStep.artifacts) return publicStep
  return {
    ...publicStep,
    artifacts: publicStep.artifacts.map((artifact) => ({
      ...artifact,
      path: mapPath(artifact.path),
    })),
  }
}

function mapResultArtifacts(
  result: TestResult,
  mapPath: MapArtifactPath,
): TestResult {
  const recordable = recordableTestResult(result)
  return {
    ...recordable,
    attempts: recordable.attempts.map((attempt) =>
      mapAttemptArtifacts(attempt, mapPath),
    ),
  }
}

function mapEventArtifacts(
  event: RunEvent,
  mapPath: MapArtifactPath,
): RunEvent {
  if (event.type === 'scenario-finished') {
    return publicRunEvent({
      ...event,
      attempt: mapAttemptArtifacts(event.attempt, mapPath),
    })
  }
  if (event.type === 'step-finished') {
    return publicRunEvent({
      ...event,
      result: mapStepArtifacts(event.result, mapPath),
    })
  }
  return publicRunEvent(event)
}

type LoadedRun = {
  runDirectory: string
  manifest: TestRunManifest
  events: RunEvent[]
}

async function loadRunFiles(
  root: string,
  runId: string,
  pickleHome?: string,
): Promise<LoadedRun> {
  const store = openTestRunStore({ root, pickleHome })
  const run = await store.open(runId)
  const events = await run.events()
  if (events.length === 0) throw new Error(`Unknown test run "${runId}"`)
  const runDirectory = join(
    resolveLocalProjectStorage(root, pickleHome).runsDirectory,
    runId,
  )
  const manifestPath = join(runDirectory, 'manifest.json')
  if (!(await Bun.file(manifestPath).exists())) {
    throw new Error(`Test run "${runId}" must be finalized before export`)
  }
  const manifest = parseTestRunManifest(
    await Bun.file(manifestPath).json(),
    (version): never => {
      throw new Error(
        `Test run storage schema version ${String(version)} is unsupported`,
      )
    },
  )
  assertFinalizedManifest(manifest)
  return { runDirectory, manifest, events }
}

export async function writeRunArchive(
  input: WriteRunArchiveInput,
): Promise<RunArchive> {
  const { runDirectory, manifest, events } = await loadRunFiles(
    input.root,
    input.runId,
    input.pickleHome,
  )
  const collected = collectArtifacts(manifest, events, runDirectory)
  const pathMap = new Map(
    collected.map((item) => [resolve(item.absolutePath), item.archivePath]),
  )
  const mapPath: MapArtifactPath = (path) =>
    pathMap.get(resolve(path)) ?? containedArtifactPath(runDirectory, path)
  const artifacts: RunArchiveArtifact[] = []
  for (const item of collected) {
    const file = Bun.file(item.absolutePath)
    if (!(await file.exists())) {
      throw new Error(`Artifact source file is missing: ${item.absolutePath}`)
    }
    artifacts.push({
      path: item.archivePath,
      content: Buffer.from(await file.arrayBuffer()).toString('base64'),
      mediaType: item.mediaType,
    })
  }

  const archive: RunArchive = {
    schemaVersion: testRunSchemaVersion,
    kind: 'run-archive',
    manifest: {
      ...manifest,
      results: manifest.results.map((result) =>
        mapResultArtifacts(result, mapPath),
      ),
    },
    events: events.map((event) => mapEventArtifacts(event, mapPath)),
    artifacts,
  }
  assertArchiveArtifactPayloads(archive)
  await mkdir(dirname(input.outputPath), { recursive: true })
  await Bun.write(input.outputPath, `${JSON.stringify(archive, null, 2)}\n`)
  return archive
}

export async function readRunArchive(path: string): Promise<RunArchive> {
  const parsed: unknown = JSON.parse(await Bun.file(path).text())
  const archive = parseRunArchive(parsed)
  assertConsistentRunArchive(archive)
  assertArchiveArtifactPayloads(archive)
  return archive
}

type ImportedArtifact = RunArchive['artifacts'][number] & { target: string }

interface PreparedArchiveImport {
  archive: RunArchive
  originalBytes: Uint8Array
  artifacts: ImportedArtifact[]
  archivesDirectory: string
  runDirectory: string
  preservedArchivePath: string
}

async function prepareArchiveImport(
  input: ImportRunArchiveInput,
): Promise<PreparedArchiveImport> {
  const originalBytes = new Uint8Array(
    await Bun.file(input.archivePath).arrayBuffer(),
  )
  const archive = parseRunArchive(
    JSON.parse(new TextDecoder().decode(originalBytes)),
  )
  validateRunId(archive.manifest.id)
  assertConsistentRunArchive(archive)
  const storage = resolveLocalProjectStorage(input.root, input.pickleHome)
  const archivesDirectory = storage.archivesDirectory
  const runDirectory = join(storage.runsDirectory, archive.manifest.id)
  const preservedArchivePath = join(
    archivesDirectory,
    `${archive.manifest.id}.json`,
  )
  if (
    (await pathExists(runDirectory)) ||
    (await pathExists(preservedArchivePath))
  ) {
    throw new Error(`Test run "${archive.manifest.id}" already exists`)
  }
  const artifacts = archive.artifacts.map((artifact) => ({
    ...artifact,
    target: importedArtifactPath(runDirectory, artifact.path),
  }))
  const artifactPaths = artifacts.map((artifact) => artifact.path)
  if (new Set(artifactPaths).size !== artifactPaths.length) {
    throw new Error('Run archive contains duplicate artifact paths')
  }
  validateArchiveArtifactReferences(archive, runDirectory)
  assertArchiveArtifactPayloads(archive)
  return {
    archive,
    originalBytes,
    artifacts,
    archivesDirectory,
    runDirectory,
    preservedArchivePath,
  }
}

async function createImportedRunDirectory(
  runDirectory: string,
  runId: string,
): Promise<void> {
  try {
    await mkdir(runDirectory)
  } catch (error) {
    if (isAlreadyExists(error)) {
      throw new Error(`Test run "${runId}" already exists`)
    }
    throw error
  }
}

async function writePreservedArchive(
  path: string,
  originalBytes: Uint8Array,
): Promise<void> {
  const archiveFile = await open(path, 'wx')
  try {
    await archiveFile.writeFile(originalBytes)
  } finally {
    await archiveFile.close()
  }
}

async function writeImportedArtifacts(
  artifacts: readonly ImportedArtifact[],
): Promise<Map<string, string>> {
  const pathMap = new Map<string, string>()
  for (const artifact of artifacts) {
    await mkdir(dirname(artifact.target), { recursive: true })
    await Bun.write(
      artifact.target,
      decodeBase64(artifact.content, artifact.path),
    )
    pathMap.set(artifact.path, artifact.target)
  }
  return pathMap
}

export async function importRunArchive(
  input: ImportRunArchiveInput,
): Promise<ImportedRunArchive> {
  const prepared = await prepareArchiveImport(input)
  const { archive, originalBytes, artifacts } = prepared
  const { archivesDirectory, runDirectory, preservedArchivePath } = prepared
  await mkdir(archivesDirectory, { recursive: true })
  await mkdir(dirname(runDirectory), { recursive: true })
  await createImportedRunDirectory(runDirectory, archive.manifest.id)

  let preservedArchive = false
  try {
    await writePreservedArchive(preservedArchivePath, originalBytes)
    preservedArchive = true
    await mkdir(join(runDirectory, 'artifacts'))
    const pathMap = await writeImportedArtifacts(artifacts)
    const mapPath: MapArtifactPath = (path) =>
      pathMap.get(path) ?? importedArtifactPath(runDirectory, path)
    const events = archive.events.map((event) =>
      mapEventArtifacts(event, mapPath),
    )
    const manifest: TestRunManifest = {
      ...archive.manifest,
      results: archive.manifest.results.map((result) =>
        mapResultArtifacts(result, mapPath),
      ),
    }

    await Bun.write(
      join(runDirectory, 'events.ndjson'),
      `${events.map((event) => JSON.stringify(event)).join('\n')}\n`,
    )
    await Bun.write(
      join(runDirectory, 'manifest.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    )
    await openTestRunStore({
      root: input.root,
      pickleHome: input.pickleHome,
    }).rebuildIndex()

    return { manifest, events, preservedArchivePath }
  } catch (error) {
    await rm(runDirectory, { recursive: true, force: true })
    if (preservedArchive) await rm(preservedArchivePath, { force: true })
    if (isAlreadyExists(error)) {
      throw new Error(`Test run "${archive.manifest.id}" already exists`)
    }
    throw error
  }
}

function assertConsistentRunArchive(archive: RunArchive): void {
  assertFinalizedManifest(archive.manifest)
  const startedEvents = archive.events.filter(
    (event) => event.type === 'run-started',
  )
  if (startedEvents.length !== 1) {
    throw new Error('Run archive requires exactly one run-started event')
  }
  const started = startedEvents[0]!
  if (
    started.run.id !== archive.manifest.id ||
    started.run.startedAt !== archive.manifest.startedAt ||
    started.run.sourceRunId !== archive.manifest.sourceRunId ||
    started.run.suite !== archive.manifest.suite ||
    started.run.applicationRevision !== archive.manifest.applicationRevision
  ) {
    throw new Error('Run archive manifest must match its run-started event')
  }

  const eventResults = materializeTestResults(archive.events).map(
    recordableTestResult,
  )
  const manifestResults = archive.manifest.results.map(recordableTestResult)
  if (JSON.stringify(eventResults) !== JSON.stringify(manifestResults)) {
    throw new Error('Run archive manifest results must match its Run events')
  }
  if (
    manifestResults.length > 0 &&
    archive.manifest.state !== aggregateTestResultState(manifestResults)
  ) {
    throw new Error('Run archive manifest state must match its Test results')
  }
}

function assertFinalizedManifest(manifest: TestRunManifest): void {
  if (!manifest.finishedAt) {
    throw new Error(
      `Test run "${manifest.id}" must be finalized before it can be archived`,
    )
  }
}

function assertArchiveArtifactPayloads(archive: RunArchive): void {
  const references = new Set(
    archiveArtifactReferences(archive).map((artifact) => artifact.path),
  )
  const payloadCounts = new Map<string, number>()
  for (const artifact of archive.artifacts) {
    payloadCounts.set(
      artifact.path,
      (payloadCounts.get(artifact.path) ?? 0) + 1,
    )
  }
  for (const path of references) {
    if (payloadCounts.get(path) !== 1) {
      throw new Error(
        `Artifact reference "${path}" requires exactly one embedded payload`,
      )
    }
  }
  for (const artifact of archive.artifacts) {
    if (!references.has(artifact.path)) {
      throw new Error(
        `Embedded artifact payload "${artifact.path}" has no manifest or event reference`,
      )
    }
    decodeBase64(artifact.content, artifact.path)
  }
}

function decodeBase64(content: string, path: string): Uint8Array {
  const base64Pattern =
    /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/
  if (content.length % 4 !== 0 || !base64Pattern.test(content)) {
    throw new Error(`Artifact payload "${path}" must be valid base64`)
  }
  const decoded = Buffer.from(content, 'base64')
  if (decoded.toString('base64') !== content) {
    throw new Error(`Artifact payload "${path}" must be valid base64`)
  }
  return decoded
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && (error as NodeError).code === 'EEXIST'
}

function validateRunId(id: string): void {
  if (
    !id ||
    id === '.' ||
    id === '..' ||
    id.includes('/') ||
    id.includes('\\')
  ) {
    throw new Error(`Invalid test run identifier "${id}"`)
  }
}

function importedArtifactPath(runDirectory: string, path: string): string {
  const artifactsDirectory = resolve(runDirectory, 'artifacts')
  const target = resolve(runDirectory, path)
  if (!target.startsWith(`${artifactsDirectory}${sep}`)) {
    throw new Error('Artifact path must stay inside the imported test run')
  }
  return target
}

function containedArtifactPath(runDirectory: string, path: string): string {
  const absoluteRunDirectory = resolve(runDirectory)
  const artifactsDirectory = resolve(runDirectory, 'artifacts')
  const target = resolve(path)
  if (!target.startsWith(`${artifactsDirectory}${sep}`)) {
    throw new Error('Artifact path must stay inside its owning test run')
  }
  return relative(absoluteRunDirectory, target)
}

function validateArchiveArtifactReferences(
  archive: RunArchive,
  runDirectory: string,
): void {
  const validateSteps = (steps: readonly TestStepResult[]) => {
    for (const step of steps) {
      for (const artifact of step.artifacts ?? []) {
        importedArtifactPath(runDirectory, artifact.path)
      }
    }
  }
  for (const result of archive.manifest.results) {
    for (const attempt of result.attempts) validateSteps(attempt.steps)
  }
  for (const event of archive.events) {
    if (event.type === 'scenario-finished') validateSteps(event.attempt.steps)
    if (event.type === 'step-finished') validateSteps([event.result])
  }
}
