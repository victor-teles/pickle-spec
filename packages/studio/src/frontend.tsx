import { SearchIcon } from '@hugeicons/core-free-icons'
import { HugeiconsIcon } from '@hugeicons/react'
import {
  type KeyboardEvent,
  StrictMode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { createRoot } from 'react-dom/client'
import { CommandPalette, type CurrentScenario } from './command-palette'
import { targetNewRun } from './command-palette-model'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { LoadingState } from './components/ui/loading-state'
import { ResultMark } from './components/ui/result-mark'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from './components/ui/table'
import { Toaster } from './components/ui/toast'
import { TooltipProvider } from './components/ui/tooltip'
import { cn } from './lib/utils'
import {
  cellsFromLiveInspection,
  disconnectLiveInspection,
  hydrateLiveInspection,
  type LiveResultInspection,
  type LiveStreamEvent,
  pauseLiveFollowing,
  pinLiveCell,
  receiveLiveStreamEvent,
  resumeLiveFollowing,
  selectLiveInspectorTab,
  startLiveInspection,
} from './live-result-inspection'
import { StudioShellSkeleton } from './loading-skeletons'
import type { ResultInspectorTab } from './result-inspection'
import { ResultInspector } from './result-inspector'
import { reasonMessage, resultBadgeVariant } from './result-presentation'
import {
  attentionCells,
  cellKey,
  isSelectedCell,
  type MatrixCell,
  type RunView,
  statusLabel,
  type TestResultState,
} from './run-view'
import { RunsArea } from './runs'
import { SettingsPanel } from './settings'
import { SpecificationEditor } from './specification-editor'
import {
  parseStudioRoute,
  type StudioRoute,
  studioRouteHref,
} from './studio-route'
import './styles.css'
import type {
  StudioProject,
  StudioRunReadiness,
  StudioRunRequest,
  StudioRunSnapshot,
  StudioRunsIndex,
  StudioScenario,
  StudioSpecification,
} from './server'
import { useVirtualWindow } from './virtualization'

const token = new URLSearchParams(location.search).get('token') ?? ''
if (token) {
  const address = new URL(location.href)
  address.searchParams.delete('token')
  history.replaceState(
    null,
    '',
    `${address.pathname}${address.search}${address.hash}`,
  )
}
const initialRoute = parseStudioRoute(location.href)
const areas = ['Specifications', 'Runs', 'Settings'] as const
const specificationRowHeight = 36

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers)
  if (token) headers.set('authorization', `Bearer ${token}`)
  const response = await fetch(path, {
    ...init,
    headers,
  })
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<T>
}

type StatusBadgeState = TestResultState | 'idle' | 'running'

function badgeVariant(state: StatusBadgeState) {
  if (state === 'running') return 'running'
  if (state === 'idle') return 'default'
  return resultBadgeVariant(state)
}

function statusText(state: StatusBadgeState) {
  return state === 'idle' ? 'Ready' : state
}

function StatusBadge(props: { state: StatusBadgeState }) {
  if (props.state === 'running') {
    return <LoadingState label="running" />
  }
  return (
    <Badge variant={badgeVariant(props.state)} role="status">
      <ResultMark key={props.state} state={props.state} />
      {statusText(props.state)}
    </Badge>
  )
}

function matrixCellVariant(state: MatrixCell['state']) {
  if (state === 'failed' || state === 'infrastructure-error') {
    return 'destructive'
  }
  if (state === 'passed') return 'passed'
  return 'outline'
}

function StudioApp() {
  const [project, setProject] = useState<StudioProject>()
  const [error, setError] = useState<string>()
  const [runId, setRunId] = useState<string>()
  const [selectedId, setSelectedId] = useState<string>()
  const [route, setRoute] = useState(initialRoute)
  const [runsIndex, setRunsIndex] = useState<StudioRunsIndex>()
  const [currentArea, setCurrentArea] = useState<(typeof areas)[number]>(
    initialRoute.kind === 'runs' ||
      initialRoute.kind === 'run' ||
      initialRoute.kind === 'result'
      ? 'Runs'
      : 'Specifications',
  )
  const [starting, setStarting] = useState(false)
  const [live, setLive] = useState<LiveResultInspection>()
  const [authoring, setAuthoring] = useState(false)
  const [attentionOrder, setAttentionOrder] = useState<string[]>()
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [activeProfileId, setActiveProfileId] = useState<string>()
  const [currentScenarioId, setCurrentScenarioId] = useState<string>()
  const [currentScenarioSpecificationUri, setCurrentScenarioSpecificationUri] =
    useState<string>()
  const [scenarioFocusTargetId, setScenarioFocusTargetId] = useState<string>()
  const [scenarioFocusRequest, setScenarioFocusRequest] = useState(0)
  const [specificationFocusRequest, setSpecificationFocusRequest] = useState(0)
  const commandReturnFocusRef = useRef<HTMLElement>(null)
  const specificationHeadingRef = useRef<HTMLHeadingElement>(null)

  const setCommandPaletteVisibility = useCallback((open: boolean) => {
    if (open && document.activeElement instanceof HTMLElement) {
      commandReturnFocusRef.current = document.activeElement
    }
    setCommandPaletteOpen(open)
    if (!open) {
      requestAnimationFrame(() => commandReturnFocusRef.current?.focus())
    }
  }, [])

  const reloadRunsIndex = useCallback(async () => {
    const value = await api<StudioRunsIndex>('/api/runs')
    setRunsIndex(value)
    return value
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      api<StudioProject>('/api/project'),
      api<StudioRunsIndex>('/api/runs'),
    ]).then(
      ([projectValue, runsValue]) => {
        if (!cancelled) {
          setProject(projectValue)
          setRunsIndex(runsValue)
        }
      },
      (reason: unknown) => {
        if (!cancelled) setError(reasonMessage(reason))
      },
    )
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    function restoreLocation() {
      const next = parseStudioRoute(location.href)
      setRoute(next)
      setCurrentArea(
        next.kind === 'runs' || next.kind === 'run' || next.kind === 'result'
          ? 'Runs'
          : 'Specifications',
      )
    }
    addEventListener('popstate', restoreLocation)
    return () => removeEventListener('popstate', restoreLocation)
  }, [])

  useEffect(() => {
    function toggleCommandPalette(event: globalThis.KeyboardEvent) {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.key.toLowerCase() !== 'k'
      ) {
        return
      }
      event.preventDefault()
      setCommandPaletteVisibility(!commandPaletteOpen)
    }
    addEventListener('keydown', toggleCommandPalette)
    return () => removeEventListener('keydown', toggleCommandPalette)
  }, [commandPaletteOpen, setCommandPaletteVisibility])

  useEffect(() => {
    if (!runId) return
    let closedByClient = false
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(
      `${protocol}//${location.host}/api/runs/${runId}/events`,
    )
    socket.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as LiveStreamEvent
      setLive((current) =>
        current ? receiveLiveStreamEvent(current, event) : current,
      )
      if (event.type === 'run-finished') {
        void api<StudioRunSnapshot>(
          `/api/runs/${encodeURIComponent(runId)}`,
        ).then(
          (snapshot) => {
            setLive((current) =>
              current ? hydrateLiveInspection(current, snapshot) : current,
            )
            void reloadRunsIndex()
          },
          (reason: unknown) => setError(reasonMessage(reason)),
        )
      }
    }
    socket.onclose = () => {
      if (closedByClient) return
      setLive((current) =>
        current?.phase === 'running'
          ? disconnectLiveInspection(current, 'The live event stream closed.')
          : current,
      )
    }
    return () => {
      closedByClient = true
      socket.close()
    }
  }, [reloadRunsIndex, runId])

  const cells = live ? cellsFromLiveInspection(live) : []
  const attention = useMemo(() => attentionCells(cells), [cells])
  const selectedResult = live
    ? cells.find(
        (cell) =>
          cell.scenarioId === live.location?.scenarioId &&
          cell.profileId === live.location?.profileId,
      )
    : undefined
  const runPhase =
    live?.phase === 'finished'
      ? 'finished'
      : live?.phase === 'running' || starting
        ? 'running'
        : 'idle'
  const running =
    runPhase === 'running' || Boolean(runsIndex?.activeRunIds.length)
  const composedView: RunView = {
    phase: runPhase,
    activity: [],
    cells,
    selected: selectedResult,
    pinned: live?.pinned ?? false,
  }
  const displayedAttention = useMemo(() => {
    if (!attentionOrder) return attention
    const positions = new Map(
      attentionOrder.map((key, index) => [key, index] as const),
    )
    return [...attention].sort((left, right) => {
      const leftPosition =
        positions.get(cellKey(left.scenarioId, left.profileId)) ??
        attentionOrder.length
      const rightPosition =
        positions.get(cellKey(right.scenarioId, right.profileId)) ??
        attentionOrder.length
      return leftPosition - rightPosition
    })
  }, [attention, attentionOrder])
  const aggregate = statusLabel(composedView)
  const selected =
    project?.specifications.find((item) => item.id === selectedId) ??
    project?.specifications[0]
  const currentScenario =
    selected && selected.uri === currentScenarioSpecificationUri
      ? selected.scenarios.find((scenario) => scenario.id === currentScenarioId)
      : undefined
  const currentScenarioContext: CurrentScenario | undefined =
    selected && currentScenario
      ? { specification: selected, scenario: currentScenario }
      : undefined
  const canRunAll = Boolean(project?.readiness?.ready ?? true)
  const specCanRun = selected?.canRun ?? canRunAll
  const runReasons = selected?.runReasons ?? project?.readiness?.reasons

  useEffect(() => {
    if (activeProfileId && !project?.profiles.includes(activeProfileId)) {
      setActiveProfileId(undefined)
    }
  }, [activeProfileId, project])

  useEffect(() => {
    if (
      currentScenarioId &&
      (!selected ||
        selected.uri !== currentScenarioSpecificationUri ||
        !selected.scenarios.some(
          (scenario) => scenario.id === currentScenarioId,
        ))
    ) {
      setCurrentScenarioId(undefined)
      setCurrentScenarioSpecificationUri(undefined)
      setScenarioFocusTargetId(undefined)
    }
  }, [currentScenarioId, currentScenarioSpecificationUri, selected])

  useEffect(() => {
    if (specificationFocusRequest === 0) return
    specificationHeadingRef.current?.focus()
  }, [specificationFocusRequest])

  async function reloadProject() {
    const value = await api<StudioProject>('/api/project')
    setProject(value)
    return value
  }

  function navigate(next: StudioRoute, replace = false) {
    if (next.kind === 'not-found') return
    const href = studioRouteHref(next)
    if (replace) history.replaceState(null, '', href)
    else history.pushState(null, '', href)
    setRoute(next)
    setCurrentArea(
      next.kind === 'runs' || next.kind === 'run' || next.kind === 'result'
        ? 'Runs'
        : 'Specifications',
    )
  }

  function updateLive(
    update: (inspection: LiveResultInspection) => LiveResultInspection,
  ) {
    setLive((current) => (current ? update(current) : current))
  }

  function pinSelection(cell: MatrixCell) {
    updateLive((current) => pinLiveCell(current, cell))
  }

  async function startRun(request: StudioRunRequest) {
    if (running) return
    setError(undefined)
    setRunId(undefined)
    setLive(undefined)
    setStarting(true)
    try {
      const readiness = await api<StudioRunReadiness>('/api/run-readiness', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      })
      if (!readiness.ready) {
        throw new Error(readiness.reasons.join('\n'))
      }
      const started = await api<{ id: string }>('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      })
      setRunId(started.id)
      setRunsIndex((current) =>
        current
          ? {
              ...current,
              activeRunIds: [...new Set([...current.activeRunIds, started.id])],
            }
          : current,
      )
      setLive(
        startLiveInspection({
          specificationUri: request.paths?.[0] ?? selected?.uri ?? '',
          runId: started.id,
        }),
      )
      setStarting(false)
    } catch (reason) {
      setStarting(false)
      setError(reasonMessage(reason))
    }
  }

  async function startNewRun(request: StudioRunRequest) {
    await startRun(targetNewRun(request, activeProfileId))
  }

  async function cancelRun(requestedRunId = runId) {
    if (!requestedRunId || !running) return
    setError(undefined)
    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(requestedRunId)}/cancel`,
        {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        },
      )
      if (!response.ok) throw new Error(await response.text())
    } catch (reason) {
      setError(reasonMessage(reason))
    }
  }

  function jumpToSpecification(
    specification: StudioSpecification,
    scenario?: StudioScenario,
  ) {
    history.replaceState(null, '', '/')
    setRoute({ kind: 'specifications' })
    setCurrentArea('Specifications')
    setSelectedId(specification.id)
    setCurrentScenarioId(scenario?.id)
    setCurrentScenarioSpecificationUri(scenario ? specification.uri : undefined)
    if (scenario) {
      setScenarioFocusTargetId(scenario.id)
      setScenarioFocusRequest((current) => current + 1)
    } else {
      setScenarioFocusTargetId(undefined)
      setSpecificationFocusRequest((current) => current + 1)
    }
  }

  function rememberScenario(
    specification: StudioSpecification,
    scenario: StudioScenario,
  ) {
    setCurrentScenarioId(scenario.id)
    setCurrentScenarioSpecificationUri(specification.uri)
  }

  if (error && !project) {
    return (
      <main className="studio-shell flex min-h-screen items-center justify-center p-4">
        <div className="max-w-lg space-y-4 rounded-xl border border-border bg-card p-4 shadow-[0_16px_48px_rgb(0_0_0/0.32)]">
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
          <Button
            type="button"
            onClick={() => {
              setError(undefined)
              void api<StudioProject>('/api/project').then(
                setProject,
                (reason: unknown) => setError(reasonMessage(reason)),
              )
            }}
          >
            Try again
          </Button>
        </div>
      </main>
    )
  }
  if (!project) {
    return <StudioShellSkeleton />
  }

  return (
    <div className="studio-shell flex h-screen flex-col overflow-hidden">
      <CommandPalette
        activeProfileId={activeProfileId}
        currentScenario={currentScenarioContext}
        currentSpecification={selected}
        index={runsIndex}
        open={commandPaletteOpen}
        project={project}
        running={running}
        onCancelRun={(activeRunId) => void cancelRun(activeRunId)}
        onJumpRun={(activeRunId) =>
          navigate({ kind: 'run', runId: activeRunId })
        }
        onJumpSpecification={jumpToSpecification}
        onOpenChange={setCommandPaletteVisibility}
        onRefreshSpecification={(specification) =>
          void startNewRun({
            paths: [specification.uri],
            refreshCache: true,
          })
        }
        onSelectProfile={setActiveProfileId}
        onStartAll={() => void startNewRun({})}
        onStartScenario={({ specification, scenario }) =>
          void startNewRun({
            paths: [specification.uri],
            scenarioId: scenario.id,
          })
        }
        onStartSpecification={(specification) =>
          void startNewRun({ paths: [specification.uri] })
        }
      />
      <header className="studio-topbar flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-border px-3 py-1.5 sm:flex-nowrap sm:px-4">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="studio-wordmark shrink-0">Pickle Spec</span>
          <span aria-hidden="true" className="h-5 w-px bg-border" />
          <span className="studio-project-name hidden truncate sm:block">
            {project.name}
          </span>
        </div>
        {authoring ? null : (
          <nav
            aria-label="Studio"
            className="order-3 flex w-full items-center gap-0.5 sm:order-none sm:ml-auto sm:w-auto"
          >
            {areas.map((area) => (
              <Button
                key={area}
                size="sm"
                variant={area === currentArea ? 'secondary' : 'ghost'}
                aria-current={area === currentArea ? 'page' : undefined}
                onClick={() => {
                  if (area === 'Runs') {
                    navigate({ kind: 'runs', filters: {} })
                    return
                  }
                  history.pushState(null, '', '/')
                  setRoute({ kind: 'specifications' })
                  setCurrentArea(area)
                }}
              >
                {area}
              </Button>
            ))}
          </nav>
        )}
        {authoring ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            aria-label="Open Studio commands"
            onClick={() => setCommandPaletteVisibility(true)}
          >
            <HugeiconsIcon
              icon={SearchIcon}
              strokeWidth={2}
              aria-hidden="true"
            />
            <span className="hidden xl:inline">Commands</span>
            <kbd className="font-mono text-[0.625rem] text-muted-foreground">
              ⌘K
            </kbd>
          </Button>
        )}
        {authoring ? null : (
          <Badge
            aria-label={`Run target: ${activeProfileId ?? 'All profiles'}`}
          >
            Target: {activeProfileId ?? 'All profiles'}
          </Badge>
        )}
        <StatusBadge state={aggregate} />
      </header>
      {currentArea === 'Settings' ? (
        <div className="studio-stage min-h-0 flex-1 overflow-auto">
          <SettingsPanel
            project={project}
            api={api}
            onProject={setProject}
            onError={setError}
          />
        </div>
      ) : currentArea === 'Runs' &&
        (route.kind === 'runs' ||
          route.kind === 'run' ||
          route.kind === 'result') ? (
        <div className="studio-stage flex min-h-0 flex-1">
          <RunsArea
            api={api}
            index={runsIndex}
            project={project}
            route={route}
            runsBlocked={running}
            onCancel={(activeRunId) => void cancelRun(activeRunId)}
            onError={setError}
            onNavigate={navigate}
            onRerun={startRun}
            reloadIndex={reloadRunsIndex}
          />
        </div>
      ) : (
        <div
          className={cn(
            'studio-stage min-h-0 flex-1',
            authoring ? 'flex' : 'grid lg:grid-cols-[16rem_1fr]',
          )}
        >
          {authoring ? null : (
            <SpecificationList
              specifications={project.specifications}
              selectedId={selected?.id}
              running={running}
              canRun={canRunAll}
              onSelect={(id) => {
                setSelectedId(id)
                setCurrentScenarioId(undefined)
                setCurrentScenarioSpecificationUri(undefined)
                setScenarioFocusTargetId(undefined)
              }}
              onRunAll={() => void startNewRun({})}
            />
          )}
          <main
            className="flex min-h-0 min-w-0 flex-1 flex-col"
            aria-busy={running}
          >
            {error ? (
              <p role="alert" className="px-5 pt-4 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {selected ? (
              <>
                <header
                  className={cn(
                    'specification-heading border-b border-border px-3 py-3 sm:px-5 sm:py-4',
                    authoring
                      ? 'flex min-h-0 flex-1 flex-col space-y-3'
                      : 'shrink-0 space-y-3',
                  )}
                >
                  <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <h1
                        ref={specificationHeadingRef}
                        tabIndex={-1}
                        className="studio-display text-lg leading-tight outline-none sm:text-xl"
                      >
                        {selected.name}
                      </h1>
                      <p className="truncate font-mono text-[0.6875rem] text-muted-foreground sm:text-xs">
                        {selected.uri}
                      </p>
                    </div>
                    {authoring && running && runId ? (
                      <Button
                        type="button"
                        variant="destructive"
                        onClick={() => void cancelRun()}
                      >
                        Cancel test run
                      </Button>
                    ) : null}
                  </div>
                  {!specCanRun && runReasons?.length ? (
                    <p role="status" className="text-sm text-muted-foreground">
                      {runReasons.join(' ')}
                    </p>
                  ) : null}
                  <div
                    className={cn(
                      authoring
                        ? 'flex min-h-0 flex-1 flex-col'
                        : 'flex flex-wrap items-center gap-2',
                    )}
                  >
                    <div
                      className={cn(
                        authoring
                          ? 'flex min-h-0 flex-1 flex-col'
                          : 'flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto sm:shrink-0 sm:justify-end',
                      )}
                    >
                      {authoring ? null : running ? (
                        runId ? (
                          <Button
                            type="button"
                            variant="destructive"
                            onClick={() => void cancelRun()}
                          >
                            Cancel test run
                          </Button>
                        ) : (
                          <Button type="button" disabled>
                            Checking readiness…
                          </Button>
                        )
                      ) : specCanRun ? (
                        <>
                          <Button
                            type="button"
                            onClick={() =>
                              void startNewRun({ paths: [selected.uri] })
                            }
                          >
                            Run Specification
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() =>
                              void startNewRun({
                                paths: [selected.uri],
                                refreshCache: true,
                              })
                            }
                          >
                            Refresh cache
                          </Button>
                        </>
                      ) : null}
                      <SpecificationEditor
                        uri={selected.uri}
                        namespaces={Object.keys(project.links ?? {})}
                        linkTemplates={project.links}
                        api={api}
                        onModeChange={(mode) => setAuthoring(mode === 'edit')}
                        onCatalogChange={async () => {
                          await reloadProject()
                        }}
                        onCreated={(uri) => {
                          void reloadProject().then((value) => {
                            const created = value.specifications.find(
                              (item) => item.uri === uri,
                            )
                            if (created) setSelectedId(created.id)
                          })
                        }}
                        onError={(message) => setError(message)}
                      />
                      {authoring ? null : (
                        <Button
                          type="button"
                          variant="ghost"
                          onClick={() =>
                            navigate({
                              kind: 'runs',
                              filters: { specification: selected.uri },
                            })
                          }
                        >
                          View runs
                        </Button>
                      )}
                    </div>
                  </div>
                </header>
                {authoring ? null : (
                  <div className="min-h-0 flex-1 space-y-5 overflow-auto px-3 py-4 sm:px-5">
                    <ScenarioTable
                      profiles={project.profiles}
                      scenarios={selected.scenarios}
                      cells={cells}
                      selected={selectedResult}
                      focusedScenarioId={currentScenarioId}
                      focusTargetId={scenarioFocusTargetId}
                      focusRequest={scenarioFocusRequest}
                      running={running}
                      onSelect={pinSelection}
                      onRun={(scenario) => {
                        rememberScenario(selected, scenario)
                        void startNewRun({
                          paths: [selected.uri],
                          scenarioId: scenario.id,
                        })
                      }}
                    />
                    {attention.length > 0 ? (
                      <div>
                        <h3 className="studio-display mb-2 text-sm">
                          Needs attention
                        </h3>
                        <ul
                          aria-label="Needs attention"
                          aria-live="polite"
                          className="space-y-2"
                          onFocusCapture={() =>
                            setAttentionOrder(
                              (current) =>
                                current ??
                                attention.map((cell) =>
                                  cellKey(cell.scenarioId, cell.profileId),
                                ),
                            )
                          }
                          onBlurCapture={(event) => {
                            if (
                              !(event.relatedTarget instanceof Node) ||
                              !event.currentTarget.contains(event.relatedTarget)
                            ) {
                              setAttentionOrder(undefined)
                            }
                          }}
                        >
                          {displayedAttention.map((cell) => (
                            <li key={cellKey(cell.scenarioId, cell.profileId)}>
                              <Button
                                type="button"
                                variant="outline"
                                className={cn(
                                  'h-auto w-full min-w-0 flex-col items-stretch gap-1 rounded-xl bg-card px-3 py-2 text-left',
                                  isSelectedCell(selectedResult, cell)
                                    ? 'border-foreground/25'
                                    : 'border-border',
                                )}
                                onClick={() => pinSelection(cell)}
                              >
                                <span className="flex min-w-0 items-center gap-2">
                                  <span className="min-w-0 flex-1 truncate">
                                    {cell.scenarioName}
                                  </span>
                                  <Badge variant={badgeVariant(cell.state)}>
                                    <ResultMark
                                      key={cell.state}
                                      state={cell.state}
                                    />
                                    {cell.state}
                                  </Badge>
                                </span>
                                <span className="text-xs text-muted-foreground">
                                  {cell.profileId} · Inspect result
                                </span>
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {live?.location && live.snapshot ? (
                      <ResultInspector
                        api={api}
                        location={live.location}
                        snapshot={live.snapshot}
                        connection={live.connection}
                        following={live.following}
                        followedEntryId={live.followedEntryId}
                        onResumeFollowing={() =>
                          updateLive(resumeLiveFollowing)
                        }
                        onPauseFollowing={() => updateLive(pauseLiveFollowing)}
                        onTabChange={(tab: ResultInspectorTab) =>
                          updateLive((current) =>
                            selectLiveInspectorTab(current, tab),
                          )
                        }
                      />
                    ) : null}
                  </div>
                )}
              </>
            ) : (
              <p className="p-5 text-sm text-muted-foreground">
                No Specifications found. Add a feature file matching the project
                configuration.
              </p>
            )}
          </main>
        </div>
      )}
    </div>
  )
}

function SpecificationList(props: {
  specifications: readonly StudioSpecification[]
  selectedId?: string
  running: boolean
  canRun: boolean
  onSelect: (id: string) => void
  onRunAll: () => void
}) {
  const virtual = useVirtualWindow<HTMLUListElement>({
    count: props.specifications.length,
    itemSize: specificationRowHeight,
  })
  const visibleSpecifications = props.specifications.slice(
    virtual.start,
    virtual.end,
  )
  const [pendingFocus, setPendingFocus] = useState<number>()
  const focusTargetVisible =
    pendingFocus !== undefined &&
    pendingFocus >= virtual.start &&
    pendingFocus < virtual.end

  useEffect(() => {
    if (pendingFocus === undefined || !focusTargetVisible) return
    const target = virtual.scrollRef.current?.querySelector<HTMLElement>(
      `[data-specification-index="${pendingFocus}"]`,
    )
    if (!target) return
    target.focus()
    setPendingFocus(undefined)
  }, [focusTargetVisible, pendingFocus, virtual.scrollRef])

  function moveFocus(event: KeyboardEvent, index: number) {
    let nextIndex: number | undefined
    if (event.key === 'ArrowDown') {
      nextIndex = Math.min(props.specifications.length - 1, index + 1)
    } else if (event.key === 'ArrowUp') {
      nextIndex = Math.max(0, index - 1)
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = props.specifications.length - 1
    }
    if (nextIndex === undefined || nextIndex === index) return
    event.preventDefault()
    const list = virtual.scrollRef.current
    if (!list) return
    setPendingFocus(nextIndex)
    list.scrollTop = nextIndex * specificationRowHeight
  }

  return (
    <nav
      aria-label="Specifications"
      className="specification-rail flex min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0"
    >
      <div className="flex h-11 shrink-0 items-center px-3">
        <h2 className="studio-display text-sm">Specifications</h2>
      </div>
      {props.specifications.length === 0 ? (
        <p className="px-3 pb-3 text-xs/relaxed text-muted-foreground">
          None in this project.
        </p>
      ) : (
        <ul
          ref={virtual.containerRef}
          className="flex min-h-0 flex-1 flex-col overflow-auto px-2 pb-2"
        >
          {virtual.before > 0 ? (
            <li
              aria-hidden="true"
              className="shrink-0"
              style={{ height: virtual.before }}
            />
          ) : null}
          {visibleSpecifications.map((specification, visibleIndex) => {
            const index = virtual.start + visibleIndex
            const current = specification.id === props.selectedId
            return (
              <li
                key={specification.id}
                className="shrink-0"
                style={{ height: specificationRowHeight }}
              >
                <Button
                  type="button"
                  variant="ghost"
                  size="default"
                  data-specification-index={index}
                  aria-label={specification.name}
                  aria-current={current ? 'true' : undefined}
                  className={cn(
                    'h-full w-full min-w-0 justify-between px-2.5 text-left text-xs',
                    current && 'bg-accent font-medium text-accent-foreground',
                  )}
                  onClick={() => props.onSelect(specification.id)}
                  onKeyDown={(event) => moveFocus(event, index)}
                >
                  <span className="min-w-0 truncate">{specification.name}</span>
                  <span aria-hidden="true" className="font-mono">
                    {specification.scenarios.length}
                  </span>
                </Button>
              </li>
            )
          })}
          {virtual.after > 0 ? (
            <li
              aria-hidden="true"
              className="shrink-0"
              style={{ height: virtual.after }}
            />
          ) : null}
        </ul>
      )}
      <div className="border-t border-border p-2">
        {props.canRun ? (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={props.running || props.specifications.length === 0}
            onClick={props.onRunAll}
          >
            Run all Specifications
          </Button>
        ) : null}
      </div>
    </nav>
  )
}

function ScenarioTable(props: {
  profiles: readonly string[]
  scenarios: readonly StudioScenario[]
  cells: readonly MatrixCell[]
  selected?: MatrixCell
  focusedScenarioId?: string
  focusTargetId?: string
  focusRequest: number
  running: boolean
  onSelect: (cell: MatrixCell) => void
  onRun: (scenario: StudioScenario) => void
}) {
  const rowRefs = useRef(new Map<string, HTMLTableRowElement>())

  useEffect(() => {
    if (!props.focusTargetId || props.focusRequest === 0) return
    const row = rowRefs.current.get(props.focusTargetId)
    row?.scrollIntoView({ block: 'nearest' })
    row?.focus({ preventScroll: true })
  }, [props.focusRequest, props.focusTargetId])

  function cellFor(scenarioId: string, profileId: string) {
    return props.cells.find(
      (cell) => cell.scenarioId === scenarioId && cell.profileId === profileId,
    )
  }

  return (
    <div className="scenario-table w-full min-w-0 max-w-full overflow-auto rounded-xl border border-border bg-card">
      <Table
        aria-label="Scenarios"
        className="text-xs"
        style={{ tableLayout: 'fixed' }}
      >
        <TableHeader>
          <TableRow>
            <TableHead>Scenario</TableHead>
            {props.profiles.map((profile) => (
              <TableHead key={profile} className="w-32">
                {profile}
              </TableHead>
            ))}
            <TableHead className="w-20 text-right">
              <span className="sr-only">Run</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.scenarios.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={2 + props.profiles.length}
                className="py-5 text-muted-foreground"
              >
                This Specification has no Scenarios.
              </TableCell>
            </TableRow>
          ) : (
            props.scenarios.map((scenario) => (
              <TableRow
                key={scenario.id}
                ref={(row) => {
                  if (row) rowRefs.current.set(scenario.id, row)
                  else rowRefs.current.delete(scenario.id)
                }}
                tabIndex={-1}
                data-state={
                  scenario.id === props.focusedScenarioId
                    ? 'selected'
                    : undefined
                }
                className="outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-foreground/35"
              >
                <TableHead
                  scope="row"
                  className="max-w-0 truncate"
                  title={scenario.name}
                >
                  {scenario.name}
                </TableHead>
                {props.profiles.map((profile) => {
                  const cell = cellFor(scenario.id, profile)
                  const label = `${scenario.name} ${profile} ${cell?.state ?? 'pending'}`
                  const selected = cell
                    ? isSelectedCell(props.selected, cell)
                    : false
                  return (
                    <TableCell key={profile} className="w-32">
                      {cell ? (
                        <Button
                          type="button"
                          size="sm"
                          variant={matrixCellVariant(cell.state)}
                          aria-label={label}
                          aria-pressed={selected}
                          className="animate-in fade-in zoom-in-95 duration-120 motion-reduce:animate-none"
                          onClick={() => props.onSelect(cell)}
                        >
                          <ResultMark key={cell.state} state={cell.state} />
                          {cell.state}
                        </Button>
                      ) : (
                        <span className="text-muted-foreground">pending</span>
                      )}
                    </TableCell>
                  )
                })}
                <TableCell className="w-20 text-right">
                  {scenario.canRun !== false ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={props.running}
                      aria-label={`Run Scenario ${scenario.name}`}
                      onClick={() => props.onRun(scenario)}
                    >
                      Run
                    </Button>
                  ) : null}
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Studio root element is missing')
createRoot(root).render(
  <StrictMode>
    <Toaster>
      <TooltipProvider>
        <StudioApp />
      </TooltipProvider>
    </Toaster>
  </StrictMode>,
)
