import type { ServerWebSocket } from 'bun'
import {
  liveViewportTargetKey,
  type StudioLiveViewportEvent,
} from '../../live-viewport'
import type { StudioSocketData } from '../../server/socket-data'
import type { StudioRunStreamEvent } from './run.contracts'

type RetainedViewportEvent = Extract<
  StudioLiveViewportEvent,
  { type: 'viewport-updated' }
>

function isViewportEvent(
  event: StudioRunStreamEvent,
): event is StudioLiveViewportEvent {
  return event.type === 'viewport-updated' || event.type === 'viewport-closed'
}

export interface RunEventHub {
  activeRunIds(): readonly string[]
  bufferedEvents(runId: string): readonly StudioRunStreamEvent[]
  close(socket: ServerWebSocket<StudioSocketData>): void
  finish(runId: string): void
  markActive(runId: string): void
  open(socket: ServerWebSocket<StudioSocketData>): void
  publish(runId: string, event: StudioRunStreamEvent): void
}

export function createRunEventHub(): RunEventHub {
  const activeRuns = new Set<string>()
  const buffers = new Map<string, StudioRunStreamEvent[]>()
  const listeners = new Map<
    string,
    Set<(event: StudioRunStreamEvent) => void>
  >()
  const liveViewports = new Map<string, Map<string, RetainedViewportEvent>>()

  function updateViewport(runId: string, event: StudioLiveViewportEvent): void {
    const retained = new Map(liveViewports.get(runId) ?? [])
    const key = liveViewportTargetKey(event.target)
    if (event.type === 'viewport-updated') retained.set(key, event)
    else retained.delete(key)
    liveViewports.set(runId, retained)
  }

  function publish(runId: string, event: StudioRunStreamEvent): void {
    if (!runId) return
    if (isViewportEvent(event)) updateViewport(runId, event)
    else buffers.set(runId, [...(buffers.get(runId) ?? []), event])
    for (const listener of listeners.get(runId) ?? []) listener(event)
  }

  return {
    activeRunIds: () => [...activeRuns],
    bufferedEvents: (runId) => buffers.get(runId) ?? [],
    close(socket) {
      if (socket.data.kind !== 'run' || !socket.data.listener) return
      listeners.get(socket.data.runId)?.delete(socket.data.listener)
    },
    finish(runId) {
      publish(runId, { type: 'run-finished', run: { id: runId } })
      liveViewports.delete(runId)
      activeRuns.delete(runId)
    },
    markActive(runId) {
      activeRuns.add(runId)
    },
    open(socket) {
      const client = socket
      if (client.data.kind !== 'run') return
      const runId = client.data.runId
      for (const event of buffers.get(runId) ?? []) {
        client.send(JSON.stringify(event))
      }
      for (const event of liveViewports.get(runId)?.values() ?? []) {
        client.send(JSON.stringify(event))
      }
      const listener = (event: StudioRunStreamEvent) => {
        client.send(JSON.stringify(event))
      }
      const runListeners = listeners.get(runId) ?? new Set()
      runListeners.add(listener)
      listeners.set(runId, runListeners)
      client.data = { kind: 'run', runId, listener }
    },
    publish,
  }
}
