import type { ReactNode } from 'react'
import { Button } from '../../components/ui/button'
import { studioApi } from '../../lib/studio-api'
import { FirstRunOnboarding } from '../onboarding/first-run-onboarding'
import { RunsArea } from '../runs/runs'
import { SettingsPanel } from '../settings/settings'
import { SpecificationsScreen } from '../specifications/specifications-screen'
import { CommandPalette } from './command-palette'
import type { StudioRoute } from './studio-route'
import { StudioTopbar } from './studio-topbar'
import { useStudioController } from './use-studio-controller'

type RunsRoute = Extract<
  StudioRoute,
  { kind: 'runs' | 'run' | 'result' | 'artifact' }
>

function isRunsRoute(route: StudioRoute): route is RunsRoute {
  return ['runs', 'run', 'result', 'artifact'].includes(route.kind)
}

type StudioController = ReturnType<typeof useStudioController>

function StudioSpecificationsArea(props: { studio: StudioController }) {
  const { studio } = props
  const { data } = studio
  if (!data.project) return null
  return (
    <SpecificationsScreen
      api={studioApi}
      authoring={studio.authoring}
      error={data.error}
      onAuthoringChange={studio.setAuthoring}
      onError={data.setErrorMessage}
      onReloadProject={data.reloadProject}
      project={data.project}
      run={{
        cells: studio.run.cells,
        live: studio.run.live,
        onCancel: studio.actions.cancelCurrentRun,
        onPauseFollowing: studio.run.pauseFollowing,
        onPinSelection: studio.run.pinSelection,
        onResumeFollowing: studio.run.resumeFollowing,
        onRun: studio.actions.startNewRun,
        onSelectInspectorTab: studio.run.selectInspectorTab,
        origin: studio.run.origin,
        runId: studio.run.runId,
        running: studio.run.running,
        selectedResult: studio.run.selectedResult,
      }}
      selection={{
        currentScenarioId: studio.selection.currentScenarioContext?.scenario.id,
        focusRequest: studio.selection.focus?.request ?? 0,
        focusTargetId:
          studio.selection.focus?.kind === 'scenario'
            ? studio.selection.focus.scenarioId
            : undefined,
        headingRef: studio.selection.headingRef,
        missing: studio.selection.missing,
        onSelectScenario: studio.selection.selectScenario,
        onSelect: studio.selection.selectSpecification,
        onSelectCreated: studio.selection.selectCreatedSpecification,
        selected: studio.selection.selected,
      }}
    />
  )
}

function StudioAreaContent(props: { studio: StudioController }) {
  const { studio } = props
  const { data, navigation } = studio
  if (!data.project) return null
  if (navigation.area === 'Settings') {
    return (
      <div className="studio-stage min-h-0 flex-1 overflow-auto">
        <SettingsPanel
          project={data.project}
          api={studioApi}
          onProject={data.setProject}
          onError={data.setErrorMessage}
        />
      </div>
    )
  }
  if (navigation.area === 'Runs' && isRunsRoute(navigation.route)) {
    return (
      <div className="studio-stage flex min-h-0 flex-1 overflow-hidden">
        <RunsArea
          api={studioApi}
          index={data.runsIndex}
          project={data.project}
          route={navigation.route}
          runsBlocked={studio.run.running}
          onCancel={studio.actions.cancelRun}
          onError={data.setErrorMessage}
          onNavigate={navigation.navigate}
          onRerun={studio.run.startRun}
          reloadIndex={data.reloadRunsIndex}
        />
      </div>
    )
  }
  return <StudioSpecificationsArea studio={studio} />
}

function StudioWorkspace(props: { studio: StudioController }) {
  const { studio } = props
  const { data } = studio
  if (!data.project) return null

  function handleOpenSettings() {
    studio.actions.selectArea('Settings')
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
        area={studio.navigation.area}
        authoring={studio.authoring}
        projectName={data.project.name}
        running={studio.run.running}
        onAreaChange={studio.actions.selectArea}
        onOpenCommands={studio.actions.openCommands}
      />
      <FirstRunOnboarding
        activeProfileId={studio.activeProfileId}
        currentSpecification={studio.selection.selected}
        onOpenSettings={handleOpenSettings}
        onRun={studio.run.startRun}
        project={data.project}
        readinessAttempt={studio.run.readinessAttempt}
        running={studio.run.running}
        runsIndex={data.runsIndex}
      />
      <StudioAreaContent studio={studio} />
    </div>
  )
}

export function StudioApp({ loadingFallback }: { loadingFallback: ReactNode }) {
  const studio = useStudioController()
  const { data } = studio

  if (data.error && !data.project) {
    return <InitialErrorState error={data.error} onRetry={data.retryProject} />
  }
  if (!data.project) return loadingFallback

  return <StudioWorkspace studio={studio} />
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
