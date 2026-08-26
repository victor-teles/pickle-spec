import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RetentionPolicy } from '@pickle-spec/runner'
import {
  compareTestRuns,
  createAllureResultsZip,
  formatHtml,
  importRunArchive,
  openTestRunStore,
  resolveLocalProjectStorage,
  writeRunArchive,
} from '@pickle-spec/runner'
import type { StudioHistoryGateway } from '@pickle-spec/studio'
import { loadPersistedRun } from '../run/execute-run'

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
    async exportArchive(runId) {
      return withTemporaryFile(`${runId}.json`, async (outputPath) => {
        await writeRunArchive({ root, runId, outputPath })
        return Bun.file(outputPath).text()
      })
    },
    async exportHtml(runId, artifacts) {
      const { manifest } = await loadPersistedRun(root, runId)
      return formatHtml(manifest, { artifacts })
    },
    async exportAllure(runId) {
      const { manifest } = await loadPersistedRun(root, runId)
      if (!manifest.finishedAt) {
        throw new Error(`Test run "${runId}" must be finalized before export`)
      }
      return createAllureResultsZip(manifest, {
        artifactsDirectory: join(
          resolveLocalProjectStorage(root).runsDirectory,
          runId,
          'artifacts',
        ),
      })
    },
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
