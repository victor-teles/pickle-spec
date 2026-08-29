import { useCallback, useEffect, useMemo, useState } from 'react'
import { targetNewRun } from '../app/command-palette-model'
import { type StudioApi, studioToken } from '../app/studio-api'
import type {
  StudioRunReadiness,
  StudioRunRequest,
  StudioRunSnapshot,
  StudioRunsIndex,
} from '../server/server'
import {
  cellsFromLiveInspection,
  disconnectLiveInspection,
  hydrateLiveInspection,
  type LiveResultInspection,
  type LiveStreamEvent,
  liveInspectionFromSnapshot,
  pauseLiveFollowing,
  pinLiveCell,
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

export type StudioReadinessAttempt = {
  readiness: StudioRunReadiness
  request: StudioRunRequest
}

export function useLiveRun(options: UseLiveRunOptions) {
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
  const activeRunIds = options.runsIndex?.activeRunIds ?? noActiveRunIds

  const running =
    live?.phase === 'running' ||
    starting ||
    Boolean(options.runsIndex?.activeRunIds.length)
  const cells = useMemo(
    () => (live ? cellsFromLiveInspection(live) : []),
    [live],
  )
  const selectedResult = live
    ? cells.find(
        (cell) =>
          cell.scenarioId === live.location?.scenarioId &&
          cell.profileId === live.location?.profileId,
      )
    : undefined
  useEffect(() => {
    if (
      runId ||
      live ||
      starting ||
      !options.selectedSpecificationUri ||
      activeRunIds.length === 0
    ) {
      return
    }
    let cancelled = false
    const specificationUri = options.selectedSpecificationUri
    void Promise.all(
      activeRunIds.map((activeRunId) =>
        options.api<StudioRunSnapshot>(
          `/api/runs/${encodeURIComponent(activeRunId)}`,
        ),
      ),
    ).then(
      (snapshots) => {
        if (cancelled) return
        const snapshot = snapshots.find((candidate) =>
          candidate.schedule?.some(
            (scheduled) => scheduled.specification.uri === specificationUri,
          ),
        )
        if (!snapshot) return
        setLive(liveInspectionFromSnapshot(snapshot, specificationUri))
        setRunId(snapshot.id)
      },
      (reason: unknown) => {
        if (!cancelled) options.onError(reason)
      },
    )
    return () => {
      cancelled = true
    }
  }, [
    activeRunIds,
    live,
    options.api,
    options.onError,
    options.selectedSpecificationUri,
    runId,
    starting,
  ])
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
      if (event.type !== 'run-finished') return
      setOrigin(undefined)
      void options
        .api<StudioRunSnapshot>(`/api/runs/${encodeURIComponent(runId)}`)
        .then((snapshot) => {
          setLive((current) =>
            current ? hydrateLiveInspection(current, snapshot) : current,
          )
          void options.reloadRunsIndex()
        }, options.onError)
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
  }, [options.api, options.onError, options.reloadRunsIndex, runId])

  function updateLive(
    update: (inspection: LiveResultInspection) => LiveResultInspection,
  ) {
    setLive((current) => (current ? update(current) : current))
  }

  function pinSelection(cell: MatrixCell) {
    if (!live) return
    const pinned = pinLiveCell(live, cell)
    setLive(pinned)
    if (pinned.location) options.onInspectResult(pinned.location)
  }

  async function startRun(request: StudioRunRequest) {
    if (running) return
    options.onClearError()
    setRunId(undefined)
    setLive(undefined)
    setOrigin(runOriginFromRequest(request))
    setStarting(true)
    try {
      const readiness = await options.api<StudioRunReadiness>(
        '/api/run-readiness',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(request),
        },
      )
      setReadinessAttempt({ readiness, request })
      if (!readiness.ready) throw new Error(readiness.reasons.join('\n'))

      const started = await options.api<{ id: string }>('/api/runs', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(request),
      })
      setRunId(started.id)
      options.registerActiveRun(started.id)
      setLive(
        startLiveInspection({
          specificationUri:
            request.paths?.[0] ?? options.selectedSpecificationUri ?? '',
          runId: started.id,
        }),
      )
    } catch (reason) {
      setOrigin(undefined)
      options.onError(reason)
    } finally {
      setStarting(false)
    }
  }

  async function startNewRun(request: StudioRunRequest) {
    await startRun(targetNewRun(request, options.activeProfileId))
  }

  async function cancelRun(requestedRunId = runId) {
    if (!requestedRunId || !running) return
    options.onClearError()
    try {
      const response = await fetch(
        `/api/runs/${encodeURIComponent(requestedRunId)}/cancel`,
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

  function resumeFollowing() {
    updateLive(resumeLiveFollowing)
  }

  function pauseFollowing() {
    updateLive(pauseLiveFollowing)
  }

  function selectInspectorTab(tab: ResultInspectorTab) {
    updateLive((current) => selectLiveInspectorTab(current, tab))
  }

  return {
    cancelRun,
    cells,
    clearReadinessAttempt,
    live,
    origin,
    pauseFollowing,
    pinSelection,
    readinessAttempt,
    runId,
    running,
    selectInspectorTab,
    selectedResult,
    startNewRun,
    startRun,
    resumeFollowing,
  }
}
