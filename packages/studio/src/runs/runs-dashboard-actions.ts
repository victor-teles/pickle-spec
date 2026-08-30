import type { TestRunComparison, TestRunManifest } from '@pickle-spec/runner'
import type { Dispatch, SetStateAction } from 'react'
import type { StudioApi } from '../app/studio-api'
import type { StudioRoute } from '../app/studio-route'
import { toast } from '../components/ui/toast'
import type { StudioRunSnapshot, StudioRunsIndex } from '../server/contracts'
import { defaultRunAttemptLocation } from './result/live-result-follow'
import { reasonMessage } from './result/result-presentation'

type Navigate = (route: StudioRoute, replace?: boolean) => void

export async function openRunAttempt(
  api: StudioApi,
  onNavigate: Navigate,
  runId: string,
  setOpeningRunId: Dispatch<SetStateAction<string | undefined>>,
  setError: (error?: string) => void,
) {
  setError(undefined)
  setOpeningRunId(runId)
  try {
    const snapshot = await api<StudioRunSnapshot>(
      `/api/runs/${encodeURIComponent(runId)}`,
    )
    const location = defaultRunAttemptLocation(snapshot)
    onNavigate(location ? { kind: 'result', location } : { kind: 'run', runId })
  } catch (reason) {
    setError(reasonMessage(reason))
  } finally {
    setOpeningRunId((current) => (current === runId ? undefined : current))
  }
}

export async function compareSelectedRuns(
  api: StudioApi,
  runIds: readonly string[],
  setComparison: (value: TestRunComparison) => void,
  setError: (value?: string) => void,
) {
  if (runIds.length !== 2) return
  setError(undefined)
  try {
    setComparison(
      await api('/api/history/compare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          baselineRunId: runIds[1],
          candidateRunId: runIds[0],
        }),
      }),
    )
  } catch (reason) {
    setError(reasonMessage(reason))
  }
}

export async function importRunArchive(
  api: StudioApi,
  reloadIndex: () => Promise<StudioRunsIndex>,
  file: File | undefined,
  setError: (value?: string) => void,
) {
  if (!file) return
  setError(undefined)
  try {
    const manifest = await api<TestRunManifest>('/api/history/import', {
      method: 'POST',
      body: file,
    })
    await reloadIndex()
    toast.add({
      type: 'success',
      title: 'Test run imported',
      description: `Test run ${manifest.id} is now available in Runs.`,
    })
  } catch (reason) {
    setError(reasonMessage(reason))
  }
}

export async function setRunPinned(
  api: StudioApi,
  reloadIndex: () => Promise<StudioRunsIndex>,
  runId: string,
  pinned: boolean,
  setError: (value?: string) => void,
) {
  setError(undefined)
  try {
    await api(`/api/history/${encodeURIComponent(runId)}/pin`, {
      method: pinned ? 'POST' : 'DELETE',
    })
    await reloadIndex()
    toast.add({
      type: 'success',
      title: `Test run ${pinned ? 'pinned' : 'unpinned'}`,
      description: pinned
        ? `${runId} is protected from retention deletion.`
        : `${runId} can be deleted by the retention policy.`,
    })
  } catch (reason) {
    setError(reasonMessage(reason))
  }
}

export async function deleteEligibleRuns(
  api: StudioApi,
  reloadIndex: () => Promise<StudioRunsIndex>,
  selectedRunIds: readonly string[],
  setSelectedRunIds: Dispatch<SetStateAction<string[]>>,
  setComparison: (value?: TestRunComparison) => void,
  setError: (value?: string) => void,
) {
  setError(undefined)
  try {
    const result = await api<{ removed: string[] }>('/api/history/retention', {
      method: 'POST',
    })
    setSelectedRunIds((current) =>
      current.filter((runId) => !result.removed.includes(runId)),
    )
    if (selectedRunIds.some((runId) => result.removed.includes(runId)))
      setComparison(undefined)
    await reloadIndex()
    const empty = result.removed.length === 0
    toast.add({
      type: empty ? 'info' : 'success',
      title: empty ? 'No Test runs deleted' : 'Run retention applied',
      description: empty
        ? 'No local Test runs matched the configured retention policy.'
        : `Deleted ${result.removed.length} local Test runs.`,
    })
  } catch (reason) {
    setError(reasonMessage(reason))
  }
}
