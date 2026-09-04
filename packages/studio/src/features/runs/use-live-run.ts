import { useCallback, useEffect, useMemo, useState } from 'react'
import { type StudioApi, studioToken } from '../../lib/studio-api'
import type {
  StudioRunReadiness,
  StudioRunRequest,
  StudioRunSnapshot,
  StudioRunsIndex,
} from '../../server/contracts'
import { targetNewRun } from '../studio/command-palette-model'
import {
  cellsFromLiveInspection,
  disconnectLiveInspection,
  hydrateLiveInspection,
  inspectLiveTimelineEntry,
  type LiveResultInspection,
  type LiveStreamEvent,
  liveInspectionFromSnapshot,
  pauseLiveFollowing,
  pinLiveCell,
  pinLiveInvestigation,
  receiveLiveStreamEvent,
  resumeLiveFollowing,
  selectLiveInspectorTab,
  startLiveInspection,
} from './result/live-result-inspection'
import type {
  ResultInspectionLocation,
  ResultInspectorTab,
} from './result/result-inspection'
import type { MatrixCell } from './result/run-view'
import { type RunOrigin, runOriginFromRequest } from './run-origin'

const noActiveRunIds: readonly string[] = []

type UseLiveRunOptions = {
  activeProfileId?: string
  api: StudioApi
  onClearError: () => void
  onError: (reason: unknown) => void
  onInspectResult: (location: ResultInspectionLocation) => void
  registerActiveRun: (runId: string) => void
  reloadRunsIndex: () => Promise<StudioRunsIndex>
  runsIndex?: StudioRunsIndex
  selectedSpecificationUri?: string
}

type SetValue<Value> = React.Dispatch<React.SetStateAction<Value>>

export type StudioReadinessAttempt = {
  readiness: StudioRunReadiness
  request: StudioRunRequest
}

type LiveRunSetters = {
  setLive: SetValue<LiveResultInspection | undefined>
  setOrigin: SetValue<RunOrigin | undefined>
  setReadinessAttempt: SetValue<StudioReadinessAttempt | undefined>
  setRunId: SetValue<string | undefined>
  setStarting: SetValue<boolean>
}

async function restoreActiveRun(input: {
  activeRunIds: readonly string[]
  api: StudioApi
  cancelled: () => boolean
  onError: (reason: unknown) => void
  setLive: SetValue<LiveResultInspection | undefined>
  setRunId: SetValue<string | undefined>
  specificationUri: string
}): Promise<void> {
  try {
    const snapshots = await Promise.all(
      input.activeRunIds.map((runId) =>
        input.api<StudioRunSnapshot>(`/api/runs/${encodeURIComponent(runId)}`),
      ),
    )
    if (input.cancelled()) return
    const snapshot = snapshots.find((candidate) =>
      candidate.schedule?.some(
        (scheduled) => scheduled.specification.uri === input.specificationUri,
      ),
    )
    if (!snapshot) return
    input.setLive(liveInspectionFromSnapshot(snapshot, input.specificationUri))
    input.setRunId(snapshot.id)
  } catch (reason) {
    if (!input.cancelled()) input.onError(reason)
  }
}

function useRestoreActiveRun(input: {
  activeRunIds: readonly string[]
  live?: LiveResultInspection
  options: UseLiveRunOptions
  runId?: string
  setLive: SetValue<LiveResultInspection | undefined>
  setRunId: SetValue<string | undefined>
  starting: boolean
}): void {
  useEffect(() => {
    const specificationUri = input.options.selectedSpecificationUri
    if (input.runId || input.live || input.starting || !specificationUri) return
    if (input.activeRunIds.length === 0) return
    let cancelled = false
    void restoreActiveRun({
      activeRunIds: input.activeRunIds,
      api: input.options.api,
      cancelled: () => cancelled,
      onError: input.options.onError,
      setLive: input.setLive,
      setRunId: input.setRunId,
      specificationUri,
    })
    return () => {
      cancelled = true
    }
  }, [
    input.activeRunIds,
    input.live,
    input.options.api,
    input.options.onError,
    input.options.selectedSpecificationUri,
    input.runId,
    input.setLive,
    input.setRunId,
    input.starting,
  ])
}

function useLiveRunSocket(input: {
  options: UseLiveRunOptions
  runId?: string
  setLive: SetValue<LiveResultInspection | undefined>
  setOrigin: SetValue<RunOrigin | undefined>
}): void {
  const { api, onError, reloadRunsIndex } = input.options
  const { runId, setLive, setOrigin } = input
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
        setOrigin(undefined)
        void hydrateFinishedRun({
          api,
          onError,
          reloadRunsIndex,
          runId,
          setLive,
        })
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
  }, [api, onError, reloadRunsIndex, runId, setLive, setOrigin])
}

async function hydrateFinishedRun(input: {
  api: StudioApi
  onError: (reason: unknown) => void
  reloadRunsIndex: () => Promise<StudioRunsIndex>
  runId: string
  setLive: SetValue<LiveResultInspection | undefined>
}): Promise<void> {
  try {
    const snapshot = await input.api<StudioRunSnapshot>(
      `/api/runs/${encodeURIComponent(input.runId)}`,
    )
    input.setLive((current) =>
      current ? hydrateLiveInspection(current, snapshot) : current,
    )
    await input.reloadRunsIndex()
  } catch (reason) {
    input.onError(reason)
  }
}

function useLiveRunState() {
  const [runId, setRunId] = useState<string>()
  const [starting, setStarting] = useState(false)
  const [origin, setOrigin] = useState<RunOrigin>()
  const [live, setLive] = useState<LiveResultInspection>()
  const [readinessAttempt, setReadinessAttempt] =
    useState<StudioReadinessAttempt>()
  const clearReadinessAttempt = useCallback(
    () => setReadinessAttempt(undefined),
    [],
  )
  return {
    clearReadinessAttempt,
    live,
    origin,
    readinessAttempt,
    runId,
    setters: {
      setLive,
      setOrigin,
      setReadinessAttempt,
      setRunId,
      setStarting,
    },
    starting,
  }
}

function selectedResultFrom(
  live: LiveResultInspection | undefined,
  cells: readonly MatrixCell[],
): MatrixCell | undefined {
  if (!live) return
  return cells.find(
    (cell) =>
      cell.scenarioId === live.location?.scenarioId &&
      cell.profileId === live.location?.profileId,
  )
}

async function startLiveRun(
  options: UseLiveRunOptions,
  setters: LiveRunSetters,
  running: boolean,
  request: StudioRunRequest,
): Promise<void> {
  if (running) return
  options.onClearError()
  setters.setRunId(undefined)
  setters.setLive(undefined)
  setters.setOrigin(runOriginFromRequest(request))
  setters.setStarting(true)
  try {
    const readiness = await options.api<StudioRunReadiness>(
      '/api/run-readiness',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      },
    )
    setters.setReadinessAttempt({ readiness, request })
    if (!readiness.ready) throw new Error(readiness.reasons.join('\n'))
    const started = await options.api<{ id: string }>('/api/runs', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
    })
    setters.setRunId(started.id)
    options.registerActiveRun(started.id)
    setters.setLive(
      startLiveInspection({
        specificationUri:
          request.paths?.[0] ?? options.selectedSpecificationUri ?? '',
        runId: started.id,
      }),
    )
  } catch (reason) {
    setters.setOrigin(undefined)
    options.onError(reason)
  } finally {
    setters.setStarting(false)
  }
}

async function cancelLiveRun(
  options: UseLiveRunOptions,
  running: boolean,
  runId?: string,
): Promise<void> {
  if (!runId || !running) return
  options.onClearError()
  try {
    const response = await fetch(
      `/api/runs/${encodeURIComponent(runId)}/cancel`,
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${studioToken}` },
      },
    )
    if (!response.ok) throw new Error(await response.text())
  } catch (reason) {
    options.onError(reason)
  }
}

function liveInspectionControls(
  live: LiveResultInspection | undefined,
  setLive: SetValue<LiveResultInspection | undefined>,
  setRunId: SetValue<string | undefined>,
  onInspectResult: (location: ResultInspectionLocation) => void,
) {
  const update = (
    transform: (inspection: LiveResultInspection) => LiveResultInspection,
  ) => setLive((current) => (current ? transform(current) : current))
  return {
    dismissFinishedRun: () => {
      if (live?.phase === 'running') return
      setLive(undefined)
      setRunId(undefined)
    },
    inspectLocation: (location: ResultInspectionLocation) =>
      update((current) => pinLiveInvestigation(current, location)),
    inspectTimelineEntry: (entryId: string) =>
      update((current) => inspectLiveTimelineEntry(current, entryId)),
    pauseFollowing: () => update(pauseLiveFollowing),
    pinSelection: (cell: MatrixCell) => {
      if (!live) return
      const pinned = pinLiveCell(live, cell)
      setLive(pinned)
      if (pinned.location) onInspectResult(pinned.location)
    },
    resumeFollowing: () => update(resumeLiveFollowing),
    selectInspectorTab: (tab: ResultInspectorTab) =>
      update((current) => selectLiveInspectorTab(current, tab)),
  }
}

function liveRunIsRunning(
  live: LiveResultInspection | undefined,
  starting: boolean,
  runsIndex: StudioRunsIndex | undefined,
): boolean {
  return (
    live?.phase === 'running' ||
    starting ||
    Boolean(runsIndex?.activeRunIds.length)
  )
}

function selectedLiveForSpecification(
  live: LiveResultInspection | undefined,
  specificationUri: string | undefined,
): LiveResultInspection | undefined {
  return live?.specificationUri === specificationUri ? live : undefined
}

function useSelectedLiveRun(
  live: LiveResultInspection | undefined,
  specificationUri: string | undefined,
) {
  const selectedLive = selectedLiveForSpecification(live, specificationUri)
  const cells = useMemo(
    () => (selectedLive ? cellsFromLiveInspection(selectedLive) : []),
    [selectedLive],
  )
  return {
    cells,
    selectedLive,
    selectedResult: selectedResultFrom(selectedLive, cells),
  }
}

export function useLiveRun(options: UseLiveRunOptions) {
  const {
    clearReadinessAttempt,
    live,
    origin,
    readinessAttempt,
    runId,
    setters,
    starting,
  } = useLiveRunState()
  const { setLive, setOrigin, setRunId } = setters
  const activeRunIds = options.runsIndex?.activeRunIds ?? noActiveRunIds
  const running = liveRunIsRunning(live, starting, options.runsIndex)
  const { cells, selectedLive, selectedResult } = useSelectedLiveRun(
    live,
    options.selectedSpecificationUri,
  )
  useRestoreActiveRun({
    activeRunIds,
    live,
    options,
    runId,
    setLive,
    setRunId,
    starting,
  })
  useLiveRunSocket({ options, runId, setLive, setOrigin })
  const controls = liveInspectionControls(
    live,
    setLive,
    setRunId,
    options.onInspectResult,
  )
  const startRun = (request: StudioRunRequest) =>
    startLiveRun(options, setters, running, request)

  async function startNewRun(request: StudioRunRequest) {
    await startRun(targetNewRun(request, options.activeProfileId))
  }

  const cancelRun = (requestedRunId = runId) =>
    cancelLiveRun(options, running, requestedRunId)

  return {
    ...controls,
    activeLive: live,
    cancelRun,
    cells,
    clearReadinessAttempt,
    live: selectedLive,
    origin,
    readinessAttempt,
    runId,
    running,
    selectedResult,
    startNewRun,
    startRun,
  }
}
