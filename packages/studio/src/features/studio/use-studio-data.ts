import { useCallback, useEffect, useState } from 'react'
import type { StudioProject, StudioRunsIndex } from '../../server/contracts'
import { getStudioProject } from '../project/project.functions'
import { reasonMessage } from '../runs/result/result-presentation'
import { getStudioRuns } from '../runs/runs.functions'

interface InitialStudioDataInput {
  reportError: (reason: unknown) => void
  setProject: (project: StudioProject) => void
  setRunsIndex: (runs: StudioRunsIndex) => void
}

function useInitialStudioData(input: InitialStudioDataInput): void {
  const { reportError, setProject, setRunsIndex } = input
  useEffect(() => {
    let cancelled = false
    Promise.all([getStudioProject(), getStudioRuns()]).then(
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
  }, [reportError, setProject, setRunsIndex])
}

export function useStudioData() {
  const [project, setProject] = useState<StudioProject>()
  const [runsIndex, setRunsIndex] = useState<StudioRunsIndex>()
  const [error, setError] = useState<string>()

  const clearError = useCallback(() => setError(undefined), [])

  const reportError = useCallback((reason: unknown) => {
    setError(reasonMessage(reason))
  }, [])

  const reloadProject = useCallback(async () => {
    const value = await getStudioProject()
    setProject(value)
    return value
  }, [])

  const reloadRunsIndex = useCallback(async () => {
    const value = await getStudioRuns()
    setRunsIndex(value)
    return value
  }, [])

  useInitialStudioData({ reportError, setProject, setRunsIndex })

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
