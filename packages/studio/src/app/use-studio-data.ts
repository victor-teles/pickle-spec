import { useCallback, useEffect, useState } from 'react'
import { reasonMessage } from '../runs/result/result-presentation'
import type { StudioProject, StudioRunsIndex } from '../server/server'
import type { StudioApi } from './studio-api'

type UseStudioDataOptions = {
  api: StudioApi
}

interface InitialStudioDataInput {
  api: StudioApi
  reportError: (reason: unknown) => void
  setProject: (project: StudioProject) => void
  setRunsIndex: (runs: StudioRunsIndex) => void
}

function useInitialStudioData(input: InitialStudioDataInput): void {
  const { api, reportError, setProject, setRunsIndex } = input
  useEffect(() => {
    let cancelled = false
    Promise.all([
      api<StudioProject>('/api/project'),
      api<StudioRunsIndex>('/api/runs'),
    ]).then(
      ([projectValue, runsValue]) => {
        if (cancelled) return
        setProject(projectValue)
        setRunsIndex(runsValue)
      },
      (reason: unknown) => {
        if (!cancelled) reportError(reason)
      },
    )
    return () => {
      cancelled = true
    }
  }, [api, reportError, setProject, setRunsIndex])
}

export function useStudioData({ api }: UseStudioDataOptions) {
  const [project, setProject] = useState<StudioProject>()
  const [runsIndex, setRunsIndex] = useState<StudioRunsIndex>()
  const [error, setError] = useState<string>()

  const clearError = useCallback(() => setError(undefined), [])

  const reportError = useCallback((reason: unknown) => {
    setError(reasonMessage(reason))
  }, [])

  const reloadProject = useCallback(async () => {
    const value = await api<StudioProject>('/api/project')
    setProject(value)
    return value
  }, [api])

  const reloadRunsIndex = useCallback(async () => {
    const value = await api<StudioRunsIndex>('/api/runs')
    setRunsIndex(value)
    return value
  }, [api])

  useInitialStudioData({ api, reportError, setProject, setRunsIndex })

  async function retryProject() {
    setError(undefined)
    try {
      await reloadProject()
    } catch (reason) {
      reportError(reason)
    }
  }

  function registerActiveRun(runId: string) {
    setRunsIndex((current) =>
      current
        ? {
            ...current,
            activeRunIds: [...new Set([...current.activeRunIds, runId])],
          }
        : current,
    )
  }

  return {
    clearError,
    error,
    project,
    registerActiveRun,
    reloadProject,
    reloadRunsIndex,
    reportError,
    retryProject,
    runsIndex,
    setErrorMessage: setError,
    setProject,
  }
}
