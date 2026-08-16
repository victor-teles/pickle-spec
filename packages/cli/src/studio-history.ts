import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { RetentionPolicy } from '@pickle-spec/runner'
import {
  compareTestRuns,
  formatHtml,
  importRunArchive,
  openTestRunStore,
  writeRunArchive,
} from '@pickle-spec/runner'
import type { StudioHistoryGateway } from '@pickle-spec/studio'
import { loadPersistedRun } from './execute-run'

export function createStudioHistoryGateway(
  root: string,
  retention: () => Promise<Required<RetentionPolicy>>,
): StudioHistoryGateway {
  const store = openTestRunStore({ root })

  return {
    async list() {
      return { runs: await store.list(), retention: await retention() }
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
    async deleteEligible() {
      return store.applyRetention(await retention())
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
