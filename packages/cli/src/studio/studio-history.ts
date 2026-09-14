import { link, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RetentionPolicy } from '@pickle-spec/runner'
import {
  compareTestRuns,
  createAllureResultsZip,
  formatHtml,
  formatJson,
  formatJunit,
  formatNdjson,
  importRunArchive,
  openTestRunStore,
  resolveLocalProjectStorage,
  writeRunArchive,
} from '@pickle-spec/runner'
import type { StudioHistoryGateway } from '@pickle-spec/studio'
import { z } from 'zod'
import { loadPersistedRun } from '../run/execute-run'

const studioOwnerFileName = 'studio-owner.json'
const studioRecoveryClaimFileName = 'studio-recovery-claim.json'

const studioRunOwnerSchema = z.object({ pid: z.number().int().positive() })
const errorCodeSchema = z.object({ code: z.string().optional() })

type StudioRunOwner = z.infer<typeof studioRunOwnerSchema>

function studioOwnerPath(root: string, runId: string): string {
  return join(
    resolveLocalProjectStorage(root).runsDirectory,
    runId,
    studioOwnerFileName,
  )
}

function studioRecoveryClaimPath(root: string, runId: string): string {
  return join(
    resolveLocalProjectStorage(root).runsDirectory,
    runId,
    studioRecoveryClaimFileName,
  )
}

function liveProcess(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return errorCodeSchema.safeParse(error).data?.code !== 'ESRCH'
  }
}

async function readStudioRunOwner(
  path: string,
): Promise<StudioRunOwner | undefined> {
  try {
    return studioRunOwnerSchema.safeParse(await Bun.file(path).json()).data
  } catch {
    return undefined
  }
}

async function claimStudioRunRecovery(
  root: string,
  runId: string,
): Promise<boolean> {
  const path = studioRecoveryClaimPath(root, runId)
  const candidatePath = `${path}.${process.pid}.${crypto.randomUUID()}`
  await Bun.write(
    candidatePath,
    `${JSON.stringify({ pid: process.pid } satisfies StudioRunOwner)}\n`,
  )
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await link(candidatePath, path)
        return true
      } catch (error) {
        const code = errorCodeSchema.safeParse(error).data?.code
        if (code !== 'EEXIST') throw error
        const owner = await readStudioRunOwner(path)
        if (owner && liveProcess(owner.pid)) return false
        await rm(path, { force: true })
      }
    }
    return false
  } finally {
    await rm(candidatePath, { force: true })
  }
}

export async function markStudioRunOwned(
  root: string,
  runId: string,
): Promise<void> {
  await Bun.write(
    studioOwnerPath(root, runId),
    `${JSON.stringify({ pid: process.pid } satisfies StudioRunOwner)}\n`,
  )
}

export async function clearStudioRunOwner(
  root: string,
  runId: string,
): Promise<void> {
  await rm(studioOwnerPath(root, runId), { force: true })
}

export async function recoverAbandonedStudioRuns(root: string): Promise<void> {
  const store = openTestRunStore({ root })
  const runsDirectory = resolveLocalProjectStorage(root).runsDirectory
  const owners = new Bun.Glob(`*/${studioOwnerFileName}`).scan({
    cwd: runsDirectory,
    onlyFiles: true,
  })
  try {
    for await (const relativePath of owners) {
      const runId = relativePath.slice(0, -`/${studioOwnerFileName}`.length)
      const owner = await readStudioRunOwner(join(runsDirectory, relativePath))
      if (owner && liveProcess(owner.pid)) continue
      if (!(await claimStudioRunRecovery(root, runId))) continue
      try {
        await (
          await store.open(runId)
        ).materialize({
          state: 'infrastructure-error',
        })
        await clearStudioRunOwner(root, runId)
      } finally {
        await rm(studioRecoveryClaimPath(root, runId), { force: true })
      }
    }
  } catch (error) {
    if (errorCodeSchema.safeParse(error).data?.code !== 'ENOENT') throw error
  }
}

export function createStudioHistoryGateway(
  root: string,
  retention: () => Promise<RetentionPolicy>,
): StudioHistoryGateway {
  const store = openTestRunStore({ root })

  return {
    async list() {
      const [runs, policy, storage] = await Promise.all([
        store.list(),
        retention(),
        store.inspectStorage(),
      ])
      return { runs, retention: policy, storage }
    },
    async compare(baselineRunId, candidateRunId) {
      const [baseline, candidate] = await Promise.all([
        loadPersistedRun(root, baselineRunId),
        loadPersistedRun(root, candidateRunId),
      ])
      return compareTestRuns(baseline.manifest, candidate.manifest)
    },
    async importArchive(bytes) {
      return withTemporaryFile('import.json', async (archivePath) => {
        await Bun.write(archivePath, bytes)
        return (await importRunArchive({ root, archivePath })).manifest
      })
    },
    exportReport: createReportExporter(root),
    async deleteEligible() {
      return store.applyRetention(await retention())
    },
    pin(runId) {
      return store.pin(runId)
    },
    unpin(runId) {
      return store.unpin(runId)
    },
  }
}

function createReportExporter(
  root: string,
): StudioHistoryGateway['exportReport'] {
  return async (request) => {
    const { manifest, events } = await loadPersistedRun(root, request.runId)
    if (!manifest.finishedAt) {
      throw new Error(
        `Test run "${request.runId}" must be finalized before export`,
      )
    }
    switch (request.format) {
      case 'json':
        return formatJson(manifest)
      case 'ndjson':
        return formatNdjson(events)
      case 'junit':
        return formatJunit(manifest)
      case 'html':
        return formatHtml(manifest, { artifacts: request.htmlArtifacts })
      case 'archive':
        return withTemporaryFile(
          `${request.runId}.json`,
          async (outputPath) => {
            await writeRunArchive({ root, runId: request.runId, outputPath })
            return Bun.file(outputPath).text()
          },
        )
      default:
        return createAllureResultsZip(manifest, {
          artifactsDirectory: join(
            resolveLocalProjectStorage(root).runsDirectory,
            request.runId,
            'artifacts',
          ),
        })
    }
  }
}

async function withTemporaryFile<Value>(
  name: string,
  use: (path: string) => Promise<Value>,
): Promise<Value> {
  const directory = await mkdtemp(join(tmpdir(), 'pickle-studio-history-'))
  try {
    return await use(join(directory, name))
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
