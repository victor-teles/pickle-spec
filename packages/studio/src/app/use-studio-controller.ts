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

interface StudioActionsInput {
  commandPalette: ReturnType<typeof useCommandPalette>
  navigation: ReturnType<typeof useStudioNavigation>
  run: ReturnType<typeof useLiveRun>
}

function studioActions({
  commandPalette,
  navigation,
  run,
}: StudioActionsInput) {
  return {
    cancelCurrentRun: () => void run.cancelRun(),
    cancelRun: (activeRunId: string) => void run.cancelRun(activeRunId),
    jumpRun: (activeRunId: string) =>
      navigation.navigate({ kind: 'run', runId: activeRunId }),
    openCommands: () => commandPalette.setVisibility(true),
    refreshSpecification: (specification: StudioSpecification) =>
      void run.startNewRun({
        paths: [specification.uri],
        refreshCache: true,
      }),
    selectArea: (area: StudioArea) => navigation.showArea(area),
    startAll: () => void run.startNewRun({}),
    startNewRun: (request: StudioRunRequest) => void run.startNewRun(request),
    startScenario: ({ specification, scenario }: CurrentScenario) =>
      void run.startNewRun({
        paths: [specification.uri],
        scenarioId: scenario.id,
      }),
    startSpecification: (specification: StudioSpecification) =>
      void run.startNewRun({ paths: [specification.uri] }),
  }
}

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

  return {
    actions: studioActions({ commandPalette, navigation, run }),
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
