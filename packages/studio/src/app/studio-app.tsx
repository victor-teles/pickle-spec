import type { ReactNode } from 'react'
import { Button } from '../components/ui/button'
import { RunsArea } from '../runs/runs'
import { SettingsPanel } from '../settings/settings'
import { SpecificationsScreen } from '../specifications/specifications-screen'
import { CommandPalette } from './command-palette'
import { studioApi } from './studio-api'
import { StudioTopbar } from './studio-topbar'
import { useStudioController } from './use-studio-controller'

export function StudioApp({ loadingFallback }: { loadingFallback: ReactNode }) {
  const studio = useStudioController()
  const { data } = studio

  if (data.error && !data.project) {
    return <InitialErrorState error={data.error} onRetry={data.retryProject} />
  }
  if (!data.project) return loadingFallback

  const specificationSelection = {
    currentScenarioId: studio.selection.currentScenarioContext?.scenario.id,
    focusRequest: studio.selection.focus?.request ?? 0,
    focusTargetId:
      studio.selection.focus?.kind === 'scenario'
        ? studio.selection.focus.scenarioId
        : undefined,
    headingRef: studio.selection.headingRef,
    onRememberScenario: studio.selection.rememberScenario,
    onSelect: studio.selection.selectSpecification,
    onSelectCreated: studio.selection.selectCreatedSpecification,
    selected: studio.selection.selected,
  }
  const specificationRun = {
    cells: studio.run.cells,
    live: studio.run.live,
    onCancel: studio.actions.cancelCurrentRun,
    onPauseFollowing: studio.run.pauseFollowing,
    onPinSelection: studio.run.pinSelection,
    onResumeFollowing: studio.run.resumeFollowing,
    onRun: studio.actions.startNewRun,
    onSelectInspectorTab: studio.run.selectInspectorTab,
    runId: studio.run.runId,
    running: studio.run.running,
    selectedResult: studio.run.selectedResult,
  }

  return (
    <div className="studio-shell flex h-screen flex-col overflow-hidden">
      <CommandPalette
        activeProfileId={studio.activeProfileId}
        currentScenario={studio.selection.currentScenarioContext}
        currentSpecification={studio.selection.selected}
        index={data.runsIndex}
        open={studio.commandPalette.open}
        project={data.project}
        running={studio.run.running}
        onCancelRun={studio.actions.cancelRun}
        onJumpRun={studio.actions.jumpRun}
        onJumpSpecification={studio.selection.jumpToSpecification}
        onOpenChange={studio.commandPalette.setVisibility}
        onRefreshSpecification={studio.actions.refreshSpecification}
        onSelectProfile={studio.setSelectedProfileId}
        onStartAll={studio.actions.startAll}
        onStartScenario={studio.actions.startScenario}
        onStartSpecification={studio.actions.startSpecification}
      />
      <StudioTopbar
        activeProfileId={studio.activeProfileId}
        area={studio.navigation.area}
        authoring={studio.authoring}
        projectName={data.project.name}
        runStatus={studio.run.aggregate}
        onAreaChange={studio.actions.selectArea}
        onOpenCommands={studio.actions.openCommands}
      />
      {studio.navigation.area === 'Settings' ? (
        <div className="studio-stage min-h-0 flex-1 overflow-auto">
          <SettingsPanel
            project={data.project}
            api={studioApi}
            onProject={data.setProject}
            onError={data.setErrorMessage}
          />
        </div>
      ) : studio.navigation.area === 'Runs' &&
        (studio.navigation.route.kind === 'runs' ||
          studio.navigation.route.kind === 'run' ||
          studio.navigation.route.kind === 'result') ? (
        <div className="studio-stage flex min-h-0 flex-1">
          <RunsArea
            api={studioApi}
            index={data.runsIndex}
            project={data.project}
            route={studio.navigation.route}
            runsBlocked={studio.run.running}
            onCancel={studio.actions.cancelRun}
            onError={data.setErrorMessage}
            onNavigate={studio.navigation.navigate}
            onRerun={studio.run.startRun}
            reloadIndex={data.reloadRunsIndex}
          />
        </div>
      ) : (
        <SpecificationsScreen
          api={studioApi}
          authoring={studio.authoring}
          error={data.error}
          onAuthoringChange={studio.setAuthoring}
          onError={data.setErrorMessage}
          onReloadProject={data.reloadProject}
          onViewRuns={studio.actions.viewRuns}
          project={data.project}
          run={specificationRun}
          selection={specificationSelection}
        />
      )}
    </div>
  )
}

type InitialErrorStateProps = {
  error: string
  onRetry: () => Promise<void>
}

function InitialErrorState(props: InitialErrorStateProps) {
  function handleRetry() {
    void props.onRetry()
  }

  return (
    <main className="studio-shell flex min-h-screen items-center justify-center p-4">
      <div className="max-w-lg space-y-4 rounded-xl border border-border bg-card p-4 shadow-[0_16px_48px_rgb(0_0_0/0.32)]">
        <p role="alert" className="text-sm text-destructive">
          {props.error}
        </p>
        <Button type="button" onClick={handleRetry}>
          Try again
        </Button>
      </div>
    </main>
  )
}
