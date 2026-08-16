import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import {
  attentionCells,
  type ClientEvent,
  cellKey,
  emptyRunView,
  type MatrixCell,
  type RunView,
  reduceRun,
  scenarioRows,
  statusLabel,
  type TestResultState,
} from './run-view'
import './styles.css'

type StudioProject = {
  name: string
  root: string
  profiles: string[]
  suites: string[]
}

const token = new URLSearchParams(location.search).get('token') ?? ''
const areas = ['Specifications', 'Runs', 'Plans', 'Settings'] as const

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

function artifactUrl(path: string): string {
  return `/api/artifact?path=${encodeURIComponent(path)}&token=${encodeURIComponent(token)}`
}

function StudioApp() {
  const [project, setProject] = useState<StudioProject>()
  const [error, setError] = useState<string>()
  const [area, setArea] = useState<(typeof areas)[number]>('Runs')
  const [runId, setRunId] = useState<string>()
  const [view, setView] = useState<RunView>(emptyRunView)

  useEffect(() => {
    api<StudioProject>('/api/project').then(setProject, (reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
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
  const scenarios = useMemo(() => scenarioRows(view.cells), [view.cells])
  const aggregate = statusLabel(view)

  async function startRun() {
    setError(undefined)
    setView({ ...emptyRunView(), phase: 'running' })
    try {
      const started = await api<{ id: string }>('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      })
      setRunId(started.id)
    } catch (reason) {
      setView(emptyRunView())
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  if (error && !project) {
    return (
      <main className="p-8">
        <p role="alert">{error}</p>
      </main>
    )
  }
  if (!project) {
    return (
      <main className="p-8">
        <p>Opening project…</p>
      </main>
    )
  }

  return (
    <div className="flex min-h-screen flex-col">
      <header className="flex items-center justify-between border-b border-border bg-card px-6 py-3">
        <div>
          <p className="font-mono text-xs tracking-[0.2em] text-muted-foreground uppercase">
            Pickle Spec
          </p>
          <h1 className="text-xl font-semibold tracking-tight">
            {project.name}
          </h1>
        </div>
        {area === 'Runs' ? (
          <Button type="button" onClick={() => void startRun()}>
            Start test run
          </Button>
        ) : null}
      </header>
      <nav
        aria-label="Studio"
        className="flex gap-1 border-b border-border px-4 py-2"
      >
        {areas.map((name) => (
          <a
            key={name}
            href={`#${name.toLowerCase()}`}
            className={`rounded-md px-3 py-1.5 text-sm ${
              area === name
                ? 'bg-accent text-accent-foreground'
                : 'text-muted-foreground hover:bg-secondary'
            }`}
            onClick={() => setArea(name)}
          >
            {name}
          </a>
        ))}
      </nav>
      <main className="grid flex-1 gap-6 p-6 lg:grid-cols-[20rem_1fr]">
        {area === 'Runs' ? (
          <>
            <section className="space-y-4">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-medium">Test run</h2>
                <Badge variant={badgeVariant(aggregate)} role="status">
                  {aggregate}
                </Badge>
              </div>
              {error ? <p role="alert">{error}</p> : null}
              {view.activity.length > 0 ? (
                <ul className="space-y-1 text-sm">
                  {view.activity.map((name) => (
                    <li key={name}>{name}</li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Start a test run to watch live progress, the target matrix,
                  and step timelines.
                </p>
              )}
              <div>
                <h3 className="mb-2 text-sm font-medium">Needs attention</h3>
                <ul aria-label="Needs attention" className="space-y-2">
                  {attention.map((cell) => (
                    <li key={cellKey(cell.scenarioId, cell.profileId)}>
                      <button
                        type="button"
                        className="w-full rounded-md border border-border bg-card px-3 py-2 text-left text-sm"
                        onClick={() =>
                          setView((current) => ({ ...current, selected: cell }))
                        }
                      >
                        {cell.scenarioName} {cell.state}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </section>
            <section className="space-y-6">
              <TargetMatrix
                profiles={project.profiles}
                scenarios={scenarios}
                cells={view.cells}
                onSelect={(cell) =>
                  setView((current) => ({ ...current, selected: cell }))
                }
              />
              <Timeline cell={view.selected} />
            </section>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            {area} will be available in a later Studio slice.
          </p>
        )}
      </main>
    </div>
  )
}

function TargetMatrix(props: {
  profiles: string[]
  scenarios: { id: string; name: string }[]
  cells: MatrixCell[]
  onSelect: (cell: MatrixCell) => void
}) {
  function cellFor(scenarioId: string, profileId: string) {
    return props.cells.find(
      (cell) => cell.scenarioId === scenarioId && cell.profileId === profileId,
    )
  }

  return (
    <div className="overflow-auto rounded-lg border border-border bg-card">
      <table aria-label="Target matrix" className="w-full text-sm">
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
          </tr>
        </thead>
        <tbody>
          {props.scenarios.map((scenario) => (
            <tr
              key={scenario.id}
              className="border-b border-border last:border-0"
            >
              <th scope="row" className="px-3 py-2 text-left font-medium">
                {scenario.name}
              </th>
              {props.profiles.map((profile) => {
                const cell = cellFor(scenario.id, profile)
                const label = `${scenario.name} ${profile} ${cell?.state ?? 'pending'}`
                return (
                  <td key={profile} className="px-3 py-2">
                    {cell ? (
                      <Button
                        type="button"
                        size="sm"
                        variant={
                          cell.state === 'failed' ? 'destructive' : 'outline'
                        }
                        aria-label={label}
                        onClick={() => props.onSelect(cell)}
                      >
                        {cell.state}
                      </Button>
                    ) : (
                      <span className="text-muted-foreground">pending</span>
                    )}
                  </td>
                )
              })}
            </tr>
          ))}
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
            className="rounded-md border border-border bg-card px-4 py-3"
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
                  alt={artifact.kind}
                  src={artifactUrl(artifact.path)}
                  className="mt-3 max-h-64 rounded-md border border-border"
                />
              ) : (
                <a
                  key={artifact.path}
                  href={artifactUrl(artifact.path)}
                  className="mt-2 inline-block text-sm text-primary"
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
