import type { ServerWebSocket } from 'bun'
import type { DiskChangeEvent } from '../../authoring/documents'
import type {
  StudioSocketData,
  WorkspaceStreamEvent,
} from '../../server/socket-data'

export interface WorkspaceEventHub {
  close(socket: ServerWebSocket<StudioSocketData>): void
  open(socket: ServerWebSocket<StudioSocketData>): void
  publish(event: DiskChangeEvent): void
}

export function createWorkspaceEventHub(): WorkspaceEventHub {
  const listeners = new Set<(event: WorkspaceStreamEvent) => void>()

  return {
    close(socket) {
      if (socket.data.kind !== 'workspace' || !socket.data.listener) return
      listeners.delete(socket.data.listener)
    },
    open(socket) {
      const client = socket
      if (client.data.kind !== 'workspace') return
      const listener = (event: WorkspaceStreamEvent) => {
        client.send(JSON.stringify(event))
      }
      listeners.add(listener)
      client.data = { kind: 'workspace', listener }
    },
    publish(event) {
      const payload: WorkspaceStreamEvent = { type: 'disk-changed', ...event }
      for (const listener of listeners) listener(payload)
    },
  }
}
