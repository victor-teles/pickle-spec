import { useEffect, useRef, useState } from 'react'
import type { StudioRunSnapshot } from '../server/server'
import {
  disconnectLiveInspection,
  hydrateLiveInspection,
  type LiveResultInspection,
  type LiveStreamEvent,
  receiveLiveStreamEvent,
  startLiveInspection,
} from './result/live-result-inspection'

type StudioApi = <Value>(path: string, init?: RequestInit) => Promise<Value>

type ActiveRunsOptions = {
  api: StudioApi
  runIds: readonly string[]
  onError: (message: string) => void
  onFinished: (runId: string) => void
}

export function useActiveRuns(options: ActiveRunsOptions) {
  const [inspections, setInspections] = useState<
    ReadonlyMap<string, LiveResultInspection>
  >(new Map())
  const onError = useRef(options.onError)
  const onFinished = useRef(options.onFinished)
  onError.current = options.onError
  onFinished.current = options.onFinished
  useEffect(() => {
    let cancelled = false
    const sockets: WebSocket[] = []
    setInspections(new Map())

    for (const runId of options.runIds) {
      void connect(runId)
    }

    async function connect(runId: string) {
      try {
        const snapshot = await options.api<StudioRunSnapshot>(
          `/api/runs/${encodeURIComponent(runId)}`,
        )
        if (cancelled) return
        let inspection = startLiveInspection({
          runId,
          specificationUri: '',
        })
        for (const event of snapshot.events) {
          inspection = receiveLiveStreamEvent(inspection, event)
        }
        updateInspection(runId, inspection)

        const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
        const socket = new WebSocket(
          `${protocol}//${location.host}/api/runs/${encodeURIComponent(runId)}/events`,
        )
        sockets.push(socket)
        socket.onmessage = (message) => {
          const event = JSON.parse(String(message.data)) as LiveStreamEvent
          updateInspection(runId, (current) =>
            receiveLiveStreamEvent(current, event),
          )
          if (event.type === 'run-finished') {
            void options
              .api<StudioRunSnapshot>(`/api/runs/${encodeURIComponent(runId)}`)
              .then(
                (finalSnapshot) => {
                  updateInspection(runId, (current) =>
                    hydrateLiveInspection(current, finalSnapshot),
                  )
                  onFinished.current(runId)
                },
                (reason: unknown) => onError.current(messageFrom(reason)),
              )
          }
        }
        socket.onclose = () => {
          if (cancelled) return
          updateInspection(runId, (current) =>
            current.phase === 'running'
              ? disconnectLiveInspection(
                  current,
                  'The live event stream closed. Reopen the Test run to reconnect.',
                )
              : current,
          )
        }
      } catch (reason) {
        if (!cancelled) onError.current(messageFrom(reason))
      }
    }

    function updateInspection(
      runId: string,
      update:
        | LiveResultInspection
        | ((current: LiveResultInspection) => LiveResultInspection),
    ) {
      setInspections((current) => {
        const existing = current.get(runId)
        if (typeof update === 'function' && !existing) return current
        const next = new Map(current)
        next.set(
          runId,
          typeof update === 'function' ? update(existing!) : update,
        )
        return next
      })
    }

    return () => {
      cancelled = true
      for (const socket of sockets) socket.close()
    }
  }, [options.api, options.runIds])

  return inspections
}

function messageFrom(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}
