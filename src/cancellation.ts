import type { Stagehand } from '@browserbasehq/stagehand'
import { stopServer, type ManagedServer } from './server'

// --- Mutable run state ---

let abortController: AbortController | null = null
let activeStagehand: Stagehand | null = null
let activeServer: ManagedServer | null = null

// --- Error ---

export class CancellationError extends Error {
  constructor() {
    super('Run cancelled by user')
    this.name = 'CancellationError'
  }
}

// --- State management ---

export function initCancellation(): AbortSignal {
  abortController = new AbortController()
  return abortController.signal
}

export function cancelRun(): void {
  if (abortController && !abortController.signal.aborted) {
    abortController.abort()
  }

  if (activeStagehand) {
    activeStagehand.close({ force: true }).catch(() => {})
    activeStagehand = null
  }

  if (activeServer) {
    stopServer(activeServer)
    activeServer = null
  }
}

export function isCancelled(): boolean {
  return abortController?.signal.aborted ?? false
}

export function setActiveStagehand(stagehand: Stagehand | null): void {
  activeStagehand = stagehand
}

export function setActiveServer(server: ManagedServer | null): void {
  activeServer = server
}

// --- Promise wrapper ---

export function withCancellation<T>(promise: Promise<T>): Promise<T> {
  if (isCancelled()) return Promise.reject(new CancellationError())

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new CancellationError())
    abortController!.signal.addEventListener('abort', onAbort, { once: true })

    promise.then(
      (value) => {
        abortController?.signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (err) => {
        abortController?.signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}
