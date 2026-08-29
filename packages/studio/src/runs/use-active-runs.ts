import { useEffect, useRef, useState } from 'react'
import type { StudioApi } from '../app/studio-api'
import { requiredValue } from '../required-value'
import type { StudioRunSnapshot } from '../server/server'
import {
  disconnectLiveInspection,
  hydrateLiveInspection,
  type LiveResultInspection,
  type LiveStreamEvent,
  liveInspectionFromSnapshot,
  receiveLiveStreamEvent,
} from './result/live-result-inspection'

type ActiveRunsOptions = {
  api: StudioApi
  runIds: readonly string[]
  onError: (message: string) => void
  onFinished: (runId: string) => void
}

type InspectionUpdate =
  | LiveResultInspection
  | ((current: LiveResultInspection) => LiveResultInspection)

type SetInspections = React.Dispatch<
  React.SetStateAction<ReadonlyMap<string, LiveResultInspection>>
>

class ActiveRunConnections {
  private cancelled = false
  private readonly sockets: WebSocket[] = []

  constructor(
    private readonly options: ActiveRunsOptions,
    private readonly setInspections: SetInspections,
  ) {}

  start(): () => void {
    this.setInspections(new Map())
    for (const runId of this.options.runIds) void this.connect(runId)
    return () => this.close()
  }

  private async connect(runId: string): Promise<void> {
    try {
      const snapshot = await this.loadSnapshot(runId)
      if (this.cancelled) return
      this.update(runId, liveInspectionFromSnapshot(snapshot, ''))
      this.openSocket(runId)
    } catch (reason) {
      if (!this.cancelled) this.options.onError(messageFrom(reason))
    }
  }

  private openSocket(runId: string): void {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(
      `${protocol}//${location.host}/api/runs/${encodeURIComponent(runId)}/events`,
    )
    this.sockets.push(socket)
    socket.onmessage = (message) => this.receive(runId, message)
    socket.onclose = () => this.disconnect(runId)
  }

  private receive(runId: string, message: MessageEvent): void {
    const event = JSON.parse(String(message.data)) as LiveStreamEvent
    this.update(runId, (current) => receiveLiveStreamEvent(current, event))
    if (event.type === 'run-finished') void this.finish(runId)
  }

  private async finish(runId: string): Promise<void> {
    try {
      const snapshot = await this.loadSnapshot(runId)
      this.update(runId, (current) => hydrateLiveInspection(current, snapshot))
      this.options.onFinished(runId)
    } catch (reason) {
      this.options.onError(messageFrom(reason))
    }
  }

  private disconnect(runId: string): void {
    if (this.cancelled) return
    this.update(runId, (current) =>
      current.phase === 'running'
        ? disconnectLiveInspection(
            current,
            'The live event stream closed. Reopen the Test run to reconnect.',
          )
        : current,
    )
  }

  private update(runId: string, update: InspectionUpdate): void {
    this.setInspections((current) => {
      const existing = current.get(runId)
      if (typeof update === 'function' && !existing) return current
      const next = new Map(current)
      next.set(
        runId,
        typeof update === 'function' ? update(requiredValue(existing)) : update,
      )
      return next
    })
  }

  private loadSnapshot(runId: string): Promise<StudioRunSnapshot> {
    return this.options.api(`/api/runs/${encodeURIComponent(runId)}`)
  }

  private close(): void {
    this.cancelled = true
    for (const socket of this.sockets) socket.close()
  }
}

export function useActiveRuns(options: ActiveRunsOptions) {
  const [inspections, setInspections] = useState<
    ReadonlyMap<string, LiveResultInspection>
  >(new Map())
  const onError = useRef(options.onError)
  const onFinished = useRef(options.onFinished)
  const { api, runIds } = options
  onError.current = options.onError
  onFinished.current = options.onFinished
  useEffect(
    () =>
      new ActiveRunConnections(
        {
          api,
          runIds,
          onError: (message) => onError.current(message),
          onFinished: (runId) => onFinished.current(runId),
        },
        setInspections,
      ).start(),
    [api, runIds],
  )

  return inspections
}

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
