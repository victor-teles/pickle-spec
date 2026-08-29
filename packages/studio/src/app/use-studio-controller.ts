import { useEffect, useState } from 'react'
import { useLiveRun } from '../runs/use-live-run'
import type { StudioRunRequest, StudioSpecification } from '../server/server'
import { useSpecificationSelection } from '../specifications/use-specification-selection'
import type { CurrentScenario } from './command-palette'
import { studioApi } from './studio-api'
import { useCommandPalette } from './use-command-palette'
import { useStudioData } from './use-studio-data'
import { type StudioArea, useStudioNavigation } from './use-studio-navigation'

const noSpecifications: readonly StudioSpecification[] = []

export function useStudioController() {
  const data = useStudioData({ api: studioApi })
  const navigation = useStudioNavigation()
  const commandPalette = useCommandPalette()
  const [authoring, setAuthoring] = useState(false)
  const [selectedProfileId, setSelectedProfileId] = useState<string>()
  const activeProfileId =
    selectedProfileId && data.project?.profiles.includes(selectedProfileId)
      ? selectedProfileId
      : undefined

  const selection = useSpecificationSelection({
    navigate: navigation.navigate,
    route: navigation.route,
    specifications: data.project?.specifications ?? noSpecifications,
  })
  const run = useLiveRun({
    activeProfileId,
    api: studioApi,
    onClearError: data.clearError,
    onError: data.reportError,
    onInspectResult: (location) =>
      navigation.navigate({ kind: 'result', location }),
    registerActiveRun: data.registerActiveRun,
    reloadRunsIndex: data.reloadRunsIndex,
    runsIndex: data.runsIndex,
    selectedSpecificationUri: selection.selected?.uri,
  })
  useEffect(() => {
    if (data.project) run.clearReadinessAttempt()
  }, [data.project, run.clearReadinessAttempt])

  function selectArea(area: StudioArea) {
    navigation.showArea(area)
  }

  function openCommands() {
    commandPalette.setVisibility(true)
  }

  function cancelRun(activeRunId: string) {
    void run.cancelRun(activeRunId)
  }

  function cancelCurrentRun() {
    void run.cancelRun()
  }

  function jumpRun(activeRunId: string) {
    navigation.navigate({ kind: 'run', runId: activeRunId })
  }

  function refreshSpecification(specification: StudioSpecification) {
    void run.startNewRun({
      paths: [specification.uri],
      refreshCache: true,
    })
  }

  function startAll() {
    void run.startNewRun({})
  }

  function startScenario({ specification, scenario }: CurrentScenario) {
    void run.startNewRun({
      paths: [specification.uri],
      scenarioId: scenario.id,
    })
  }

  function startSpecification(specification: StudioSpecification) {
    void run.startNewRun({ paths: [specification.uri] })
  }

  function startNewRun(request: StudioRunRequest) {
    void run.startNewRun(request)
  }

  return {
    actions: {
      cancelCurrentRun,
      cancelRun,
      jumpRun,
      openCommands,
      refreshSpecification,
      selectArea,
      startAll,
      startNewRun,
      startScenario,
      startSpecification,
    },
    activeProfileId,
    authoring,
    commandPalette,
    data,
    navigation,
    run,
    selection,
    setAuthoring,
    setSelectedProfileId,
  }
}
