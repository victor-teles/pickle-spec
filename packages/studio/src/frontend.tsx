import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { LoadingState } from './components/ui/loading-state'
import { ResultMark } from './components/ui/result-mark'
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

type StudioScenario = {
  id: string
  name: string
  canRun?: boolean
}

type StudioSpecification = {
  id: string
  name: string
  uri: string
  state?: string
  tags?: string[]
  links?: Array<{ namespace: string; id: string }>
  canRun?: boolean
  runReasons?: string[]
  scenarios: StudioScenario[]
}

type StudioProject = {
  name: string
  root: string
  profiles: string[]
  suites: string[]
  specifications: StudioSpecification[]
  model?: {
    provider: string
    name: string
  }
  links?: Record<string, string>
  suiteDetails?: Array<{
    name: string
    paths?: string | string[]
    tagExpression?: string
    states?: string[]
    scenarioName?: string
  }>
  profileDetails?: Array<{
    id: string
    adapter: string
    capabilities?: string[]
  }>
  secrets?: Array<{ name: string; present: boolean }>
  readiness?: { ready: boolean; reasons: string[] }
}

type StudioRunRequest = {
  paths?: string[]
  scenarioName?: string
}

const token = new URLSearchParams(location.search).get('token') ?? ''
const areas = [
  { name: 'Specifications', available: true },
  { name: 'Runs', available: false },
  { name: 'Plans', available: false },
  { name: 'Settings', available: true },
] as const

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
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

function artifactUrl(path: string): string {
  return `/api/artifact?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`
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
    useState<(typeof areas)[number]['name']>('Specifications')
  const [view, setView] = useState<RunView>(emptyRunView)
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
      `${protocol}//${location.host}/api/runs/${runId}/events?token=${encodeURIComponent(token)}`,
    )
    socket.onmessage = (message) => {
      const event = JSON.parse(String(message.data)) as ClientEvent
      setView((current) => reduceRun(current, event))
    }
    return () => socket.close()
  }, [runId])

  const attention = useMemo(() => attentionCells(view.cells), [view.cells])
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
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-3">
        <h1 className="text-xl font-semibold tracking-tight">{project.name}</h1>
        <StatusBadge state={aggregate} />
      </header>
      <nav
        aria-label="Studio"
        className="flex gap-px border-b border-border px-2 py-1"
      >
        {areas.map((item) => (
          <Button
            key={item.name}
            variant={
              item.available && item.name === currentArea
                ? 'secondary'
                : 'ghost'
            }
            render={
              <a
                href={`#${item.name.toLowerCase()}`}
                aria-current={
                  item.available && item.name === currentArea
                    ? 'page'
                    : undefined
                }
                aria-disabled={item.available ? undefined : true}
                tabIndex={item.available ? undefined : -1}
              />
            }
            className={
              item.available
                ? undefined
                : 'pointer-events-none text-muted-foreground opacity-60'
            }
            onClick={(event) => {
              if (!item.available) {
                event.preventDefault()
                return
              }
              setCurrentArea(item.name)
            }}
          >
            {item.name}
          </Button>
        ))}
      </nav>
      {currentArea === 'Settings' ? (
        <SettingsPanel
          project={project}
          api={api}
          onProject={setProject}
          onError={setError}
        />
      ) : (
        <div className="grid min-h-0 flex-1 lg:grid-cols-[16rem_1fr]">
          <SpecificationList
            specifications={project.specifications}
            selectedId={selected?.id}
            running={running}
            canRun={canRunAll}
            onSelect={setSelectedId}
            onRunAll={() => void startRun({})}
          />
          <main className="min-w-0 space-y-6 p-6" aria-busy={running}>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            {!specCanRun && runReasons?.length ? (
              <p role="status" className="text-sm text-muted-foreground">
                {runReasons.join(' ')}
              </p>
            ) : null}
            {selected ? (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <h2 className="text-lg font-medium">{selected.name}</h2>
                    <p className="truncate font-mono text-xs text-muted-foreground">
                      {selected.uri}
                    </p>
                  </div>
                  {running && runId ? (
                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => void cancelRun()}
                    >
                      Cancel test run
                    </Button>
                  ) : specCanRun ? (
                    <Button
                      type="button"
                      disabled={running}
                      onClick={() => void startRun({ paths: [selected.uri] })}
                    >
                      Run Specification
                    </Button>
                  ) : null}
                </div>
                <SpecificationEditor
                  uri={selected.uri}
                  model={project.model}
                  namespaces={Object.keys(project.links ?? {})}
                  linkTemplates={project.links}
                  api={api}
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
                    void startRun({ paths: [selected.uri], scenarioName })
                  }
                />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">
                No Specifications found. Add a feature file matching the project
                configuration.
              </p>
            )}
            {attention.length > 0 ? (
              <div>
                <h3 className="mb-2 text-sm font-medium">Needs attention</h3>
                <ul
                  aria-label="Needs attention"
                  aria-live="polite"
                  className="space-y-2"
                >
                  {attention.map((cell) => (
                    <li key={cellKey(cell.scenarioId, cell.profileId)}>
                      <button
                        type="button"
                        className={cn(
                          'flex w-full min-w-0 flex-col gap-1 rounded-md border bg-card px-3 py-2 text-left text-sm outline-none transition-[transform,background-color,border-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-muted/30 active:scale-[0.99] focus-visible:border-foreground/30 motion-reduce:transition-none motion-reduce:active:scale-100',
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
                            <ResultMark key={cell.state} state={cell.state} />
                            {cell.state}
                          </Badge>
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {cell.profileId} · Open step timeline
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <Timeline cell={view.selected} />
          </main>
        </div>
      )}
    </div>
  )
}

function SpecificationList(props: {
  specifications: StudioSpecification[]
  selectedId?: string
  running: boolean
  canRun: boolean
  onSelect: (id: string) => void
  onRunAll: () => void
}) {
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
        <ul className="flex min-h-0 flex-1 flex-col gap-px overflow-auto px-2 pb-2">
          {props.specifications.map((specification) => {
            const current = specification.id === props.selectedId
            return (
              <li key={specification.id}>
                <Button
                  type="button"
                  variant="ghost"
                  size="lg"
                  aria-label={specification.name}
                  aria-current={current ? 'true' : undefined}
                  className={cn(
                    'h-8 w-full min-w-0 justify-between p-2 text-left',
                    current && 'bg-accent font-medium text-accent-foreground',
                  )}
                  onClick={() => props.onSelect(specification.id)}
                >
                  <span className="min-w-0 truncate">{specification.name}</span>
                  <span aria-hidden="true" className="font-mono">
                    {specification.scenarios.length}
                  </span>
                </Button>
              </li>
            )
          })}
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
  profiles: string[]
  scenarios: StudioScenario[]
  cells: MatrixCell[]
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
    <div className="overflow-auto rounded-lg border border-border bg-card">
      <table aria-label="Scenarios" className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="px-3 py-2 text-left font-medium">
              Scenario
            </th>
            {props.profiles.map((profile) => (
              <th
                key={profile}
                scope="col"
                className="px-3 py-2 text-left font-medium"
              >
                {profile}
              </th>
            ))}
            <th scope="col" className="px-3 py-2 text-right font-medium">
              <span className="sr-only">Run</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {props.scenarios.length === 0 ? (
            <tr>
              <td
                colSpan={2 + props.profiles.length}
                className="px-3 py-6 text-muted-foreground"
              >
                This Specification has no Scenarios.
              </td>
            </tr>
          ) : (
            props.scenarios.map((scenario) => (
              <tr
                key={scenario.id}
                className="border-b border-border last:border-0"
              >
                <th
                  scope="row"
                  className="max-w-56 truncate px-3 py-2 text-left font-medium"
                >
                  {scenario.name}
                </th>
                {props.profiles.map((profile) => {
                  const cell = cellFor(scenario.id, profile)
                  const label = `${scenario.name} ${profile} ${cell?.state ?? 'pending'}`
                  const selected = cell
                    ? isSelectedCell(props.selected, cell)
                    : false
                  return (
                    <td key={profile} className="px-3 py-2">
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
                    </td>
                  )
                })}
                <td className="px-3 py-2 text-right">
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
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function Timeline(props: { cell?: MatrixCell }) {
  const result = props.cell?.result
  if (!result) return null
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium">
        {result.scenario.name} · {result.executionTargetProfile.id}
      </h3>
      <ol aria-label="Step timeline" className="space-y-3">
        {result.steps.map((step) => (
          <li
            key={`${step.step.text}:${step.resolvedActions.map((action) => action.description).join(',')}`}
            className="rounded-md border border-border bg-card px-4 py-3 transition-[border-color] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] hover:border-foreground/15 motion-reduce:transition-none"
          >
            <p className="font-medium">
              {`${step.step.keyword.trim()} ${step.step.text}`}
            </p>
            <ul className="mt-2 space-y-1 font-mono text-xs">
              {step.resolvedActions.map((action) => (
                <li key={action.description}>{action.description}</li>
              ))}
            </ul>
            {step.message ? (
              <p className="mt-2 text-sm text-destructive">{step.message}</p>
            ) : null}
            {step.artifacts?.map((artifact) =>
              artifact.mediaType?.startsWith('image/') ? (
                <img
                  key={artifact.path}
                  alt={`${artifact.kind} for ${result.scenario.name}`}
                  src={artifactUrl(artifact.path)}
                  className="mt-3 max-h-64 rounded-md border border-border"
                />
              ) : (
                <a
                  key={artifact.path}
                  href={artifactUrl(artifact.path)}
                  className="mt-2 inline-block text-sm text-primary underline-offset-4 hover:underline"
                >
                  {artifact.kind}
                </a>
              ),
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Studio root element is missing')
createRoot(root).render(
  <StrictMode>
    <StudioApp />
  </StrictMode>,
)
