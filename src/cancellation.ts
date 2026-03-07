import type { Stagehand } from '@browserbasehq/stagehand'
import { stopServer, type ManagedServer } from './server'

// --- Mutable run state ---

let abortController: AbortController | null = null
const activeStagehands: Set<Stagehand> = new Set()
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

  for (const sh of activeStagehands) {
    sh.close({ force: true }).catch(() => {})
  }
  activeStagehands.clear()

  if (activeServer) {
    stopServer(activeServer)
    activeServer = null
  }
}

export function isCancelled(): boolean {
  return abortController?.signal.aborted ?? false
}

export function addActiveStagehand(stagehand: Stagehand): void {
  activeStagehands.add(stagehand)
}

export function removeActiveStagehand(stagehand: Stagehand): void {
  activeStagehands.delete(stagehand)
}

export function setActiveStagehand(stagehand: Stagehand | null): void {
  if (stagehand === null) {
    activeStagehands.clear()
  } else {
    activeStagehands.add(stagehand)
  }
}

export function setActiveServer(server: ManagedServer | null): void {
  activeServer = server
}

// --- Error guard ---

export function rethrowIfCancellation(err: unknown): void {
  if (err instanceof CancellationError) throw err
  if (isCancelled()) throw new CancellationError()
  if (err instanceof Error && (err.name === 'AbortError' || err.name === 'AgentAbortError')) {
    throw new CancellationError()
  }
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
