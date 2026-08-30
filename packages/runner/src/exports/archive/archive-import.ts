import { mkdir, open, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  openTestRunStore,
  type TestRunManifest,
} from '../../results/test-run-store'
import { resolveLocalProjectStorage } from '../../storage/local-project-storage'
import type {
  ImportedRunArchive,
  ImportRunArchiveInput,
  RunArchive,
} from '../archive'
import {
  assertArchiveArtifactPayloads,
  decodeBase64,
  importedArtifactPath,
  mapEventArtifacts,
  mapResultArtifacts,
  validateArchiveArtifactReferences,
} from './archive-artifacts'
import { parseRunArchive } from './archive-migrate'
import { assertConsistentRunArchive, validateRunId } from './archive-validation'

type ImportedArtifact = RunArchive['artifacts'][number] & { target: string }

interface PreparedArchiveImport {
  archive: RunArchive
  originalBytes: Uint8Array
  artifacts: ImportedArtifact[]
  archivesDirectory: string
  runDirectory: string
  preservedArchivePath: string
}

type NodeError = Error & { code?: string }

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
    const mapPath = (path: string) =>
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
