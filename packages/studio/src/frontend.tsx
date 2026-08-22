import {
  type KeyboardEvent,
  StrictMode,
  useEffect,
  useMemo,
  useState,
} from 'react'
import { createRoot } from 'react-dom/client'
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
import { HistoryPanel } from './history'
import { cn } from './lib/utils'
import {
  attentionCells,
  type ClientEvent,
  cellKey,
  emptyRunView,
  isSelectedCell,
  type MatrixCell,
  pinCell,
  type RunView,
  reduceRun,
  statusLabel,
  type TestResultState,
} from './run-view'
import { SettingsPanel } from './settings'
import { SpecificationEditor } from './specification-editor'
import './styles.css'
import type {
  StudioProject,
  StudioRunRequest,
  StudioScenario,
  StudioSpecification,
} from './server'
import { TestResultTimeline } from './test-result-timeline'
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
const areas = ['Specifications', 'Settings'] as const
const specificationRowHeight = 32

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
  if (state === 'failed' || state === 'infrastructure-error') return 'failed'
  if (state === 'passed-with-adaptation') return 'adaptation'
  if (state === 'passed') return 'passed'
  if (state === 'running') return 'running'
  return 'default'
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
  if (state === 'passed-with-adaptation') return 'adaptation'
  if (state === 'passed') return 'passed'
  return 'outline'
}

function reasonMessage(reason: unknown) {
  return reason instanceof Error ? reason.message : String(reason)
}

function StudioApp() {
  const [project, setProject] = useState<StudioProject>()
  const [error, setError] = useState<string>()
  const [runId, setRunId] = useState<string>()
  const [selectedId, setSelectedId] = useState<string>()
  const [currentArea, setCurrentArea] =
    useState<(typeof areas)[number]>('Specifications')
  const [specificationSection, setSpecificationSection] = useState<
    'scenarios' | 'history'
  >('scenarios')
  const [view, setView] = useState<RunView>(emptyRunView)
  const [authoring, setAuthoring] = useState(false)
  const [attentionOrder, setAttentionOrder] = useState<string[]>()
  const running = view.phase === 'running'

  useEffect(() => {
    let cancelled = false
    api<StudioProject>('/api/project').then(
      (value) => {
        if (!cancelled) setProject(value)
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
    if (!runId) return
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(
      `${protocol}//${location.host}/api/runs/${runId}/events`,
    )
    socket.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as ClientEvent
      setView((current) => reduceRun(current, event))
    }
    return () => socket.close()
  }, [runId])

  const attention = useMemo(() => attentionCells(view.cells), [view.cells])
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
  const aggregate = statusLabel(view)
  const selected =
    project?.specifications.find((item) => item.id === selectedId) ??
    project?.specifications[0]
  const canRunAll = Boolean(project?.readiness?.ready ?? true)
  const specCanRun = selected?.canRun ?? canRunAll
  const runReasons = selected?.runReasons ?? project?.readiness?.reasons

  async function reloadProject() {
    const value = await api<StudioProject>('/api/project')
    setProject(value)
    return value
  }

  async function startRun(request: StudioRunRequest) {
    if (running) return
    setError(undefined)
    setView({ ...emptyRunView(), phase: 'running' })
    try {
      const started = await api<{ id: string }>('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      })
      setRunId(started.id)
    } catch (reason) {
      setView(emptyRunView())
      setError(reasonMessage(reason))
    }
  }

  async function cancelRun() {
    if (!runId || !running) return
    setError(undefined)
    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(runId)}/cancel`,
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

  if (error && !project) {
    return (
      <main className="flex min-h-screen items-start p-6">
        <div className="max-w-lg space-y-3 rounded-md border border-border bg-card px-4 py-3">
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
    return (
      <main className="flex min-h-screen items-start p-6">
        <p className="text-sm text-muted-foreground">Opening project…</p>
      </main>
    )
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden">
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-3">
        <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
        <StatusBadge state={aggregate} />
      </header>
      {authoring ? null : (
        <nav
          aria-label="Studio"
          className="flex gap-px border-b border-border px-2 py-1"
        >
          {areas.map((area) => (
            <Button
              key={area}
              variant={area === currentArea ? 'secondary' : 'ghost'}
              aria-current={area === currentArea ? 'page' : undefined}
              onClick={() => setCurrentArea(area)}
            >
              {area}
            </Button>
          ))}
        </nav>
      )}
      {currentArea === 'Settings' ? (
        <div className="min-h-0 flex-1 overflow-auto">
          <SettingsPanel
            project={project}
            api={api}
            onProject={setProject}
            onError={setError}
          />
        </div>
      ) : (
        <div
          className={cn(
            'min-h-0 flex-1',
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
                setSpecificationSection('scenarios')
              }}
              onRunAll={() => void startRun({})}
            />
          )}
          <main
            className="flex min-h-0 min-w-0 flex-1 flex-col"
            aria-busy={running}
          >
            {error ? (
              <p role="alert" className="px-6 pt-6 text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {selected ? (
              <>
                <header
                  className={
                    authoring
                      ? 'flex min-h-0 flex-1 flex-col space-y-3 border-b border-border px-6 py-4'
                      : 'shrink-0 space-y-3 border-b border-border px-6 py-4'
                  }
                >
                  <div className="flex shrink-0 flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 space-y-1">
                      <h2 className="text-lg font-medium">{selected.name}</h2>
                      <p className="truncate font-mono text-xs text-muted-foreground">
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
                    {authoring ? null : (
                      <nav
                        aria-label="Specification"
                        className="flex w-fit gap-px rounded-md bg-muted/50 p-0.5"
                      >
                        <Button
                          type="button"
                          variant={
                            specificationSection === 'scenarios'
                              ? 'secondary'
                              : 'ghost'
                          }
                          aria-current={
                            specificationSection === 'scenarios'
                              ? 'page'
                              : undefined
                          }
                          onClick={() => setSpecificationSection('scenarios')}
                        >
                          Scenarios
                        </Button>
                        <Button
                          type="button"
                          variant={
                            specificationSection === 'history'
                              ? 'secondary'
                              : 'ghost'
                          }
                          aria-current={
                            specificationSection === 'history'
                              ? 'page'
                              : undefined
                          }
                          onClick={() => setSpecificationSection('history')}
                        >
                          History
                        </Button>
                      </nav>
                    )}
                    <div
                      className={cn(
                        authoring
                          ? 'flex min-h-0 flex-1 flex-col'
                          : 'ml-auto flex shrink-0 items-center gap-2',
                      )}
                    >
                      {authoring ? null : running && runId ? (
                        <Button
                          type="button"
                          variant="destructive"
                          onClick={() => void cancelRun()}
                        >
                          Cancel test run
                        </Button>
                      ) : specCanRun ? (
                        <>
                          <Button
                            type="button"
                            disabled={running}
                            onClick={() =>
                              void startRun({ paths: [selected.uri] })
                            }
                          >
                            Run Specification
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            disabled={running}
                            onClick={() =>
                              void startRun({
                                paths: [selected.uri],
                                refreshCache: true,
                              })
                            }
                          >
                            Refresh cache
                          </Button>
                        </>
                      ) : null}
                      {specificationSection === 'scenarios' ? (
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
                      ) : null}
                    </div>
                  </div>
                </header>
                {authoring ? null : specificationSection === 'history' ? (
                  <HistoryPanel
                    key={selected.uri}
                    api={api}
                    runPhase={view.phase}
                    specification={selected}
                    onRerun={startRun}
                  />
                ) : (
                  <div className="min-h-0 flex-1 space-y-6 overflow-auto px-6 py-4">
                    <ScenarioTable
                      profiles={project.profiles}
                      scenarios={selected.scenarios}
                      cells={view.cells}
                      selected={view.selected}
                      running={running}
                      onSelect={(cell) =>
                        setView((current) => pinCell(current, cell))
                      }
                      onRun={(scenarioName) =>
                        void startRun({
                          paths: [selected.uri],
                          scenarioName,
                        })
                      }
                    />
                    {attention.length > 0 ? (
                      <div>
                        <h3 className="mb-2 text-sm font-medium">
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
                                  'h-auto w-full min-w-0 flex-col items-stretch gap-1 bg-card px-3 py-2 text-left',
                                  isSelectedCell(view.selected, cell)
                                    ? 'border-foreground/25'
                                    : 'border-border',
                                )}
                                onClick={() =>
                                  setView((current) => pinCell(current, cell))
                                }
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
                                  {cell.profileId} · Open step timeline
                                </span>
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    {view.selected?.result ? (
                      <TestResultTimeline result={view.selected.result} />
                    ) : null}
                  </div>
                )}
              </>
            ) : (
              <p className="p-6 text-sm text-muted-foreground">
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
      className="flex min-h-0 flex-col border-b border-border lg:border-r lg:border-b-0"
    >
      <div className="flex h-8 shrink-0 items-center px-2">
        <h2 className="text-xs text-muted-foreground">Specifications</h2>
      </div>
      {props.specifications.length === 0 ? (
        <p className="px-2 pb-3 text-xs/relaxed text-muted-foreground">
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
                  size="lg"
                  data-specification-index={index}
                  aria-label={specification.name}
                  aria-current={current ? 'true' : undefined}
                  className={cn(
                    'h-full w-full min-w-0 justify-between p-2 text-left',
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
  running: boolean
  onSelect: (cell: MatrixCell) => void
  onRun: (scenarioName: string) => void
}) {
  function cellFor(scenarioId: string, profileId: string) {
    return props.cells.find(
      (cell) => cell.scenarioId === scenarioId && cell.profileId === profileId,
    )
  }

  return (
    <div className="w-full min-w-0 max-w-full overflow-auto rounded-lg border border-border bg-card">
      <Table
        aria-label="Scenarios"
        className="text-sm"
        style={{ tableLayout: 'fixed' }}
      >
        <TableHeader>
          <TableRow>
            <TableHead className="px-3 py-2">Scenario</TableHead>
            {props.profiles.map((profile) => (
              <TableHead key={profile} className="w-24 px-3 py-2">
                {profile}
              </TableHead>
            ))}
            <TableHead className="w-16 px-3 py-2 text-right">
              <span className="sr-only">Run</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {props.scenarios.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={2 + props.profiles.length}
                className="px-3 py-6 text-muted-foreground"
              >
                This Specification has no Scenarios.
              </TableCell>
            </TableRow>
          ) : (
            props.scenarios.map((scenario) => (
              <TableRow key={scenario.id}>
                <TableHead
                  scope="row"
                  className="max-w-0 truncate px-3 py-2"
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
                    <TableCell key={profile} className="w-24 px-3 py-2">
                      {cell ? (
                        <Button
                          type="button"
                          size="sm"
                          variant={matrixCellVariant(cell.state)}
                          aria-label={label}
                          aria-pressed={selected}
                          className="animate-in fade-in zoom-in-95 duration-150 motion-reduce:animate-none"
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
                <TableCell className="w-16 px-3 py-2 text-right">
                  {scenario.canRun !== false ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={props.running}
                      aria-label={`Run Scenario ${scenario.name}`}
                      onClick={() => props.onRun(scenario.name)}
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
    <StudioApp />
  </StrictMode>,
)
