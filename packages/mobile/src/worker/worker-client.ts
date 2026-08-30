import { fileURLToPath } from 'node:url'
import type {
  MobileWorkerEvent,
  MobileWorkerRequest,
  MobileWorkerResponse,
} from './worker-protocol'
import {
  mobileWorkerProtocolVersion,
  workerOutputMessageSchema,
  workerReadyMessageSchema,
} from './worker-protocol'

export interface MobileWorkerClient {
  request(
    request: MobileWorkerRequest,
    signal?: AbortSignal,
  ): Promise<MobileWorkerResponse>
  subscribe(listener: (event: MobileWorkerEvent) => void): () => void
  dispose(): Promise<void>
}

export type MobileWorkerFactory = () => MobileWorkerClient

export interface NodeWorkerClientOptions {
  nodePath?: string
  workerEntry?: URL
}

interface PendingRequest {
  resolve(response: MobileWorkerResponse): void
  reject(error: Error): void
}

function spawnWorker(nodePath: string, workerEntry: URL) {
  return Bun.spawn(
    [nodePath, '--experimental-strip-types', fileURLToPath(workerEntry)],
    {
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
    },
  )
}

type WorkerProcess = ReturnType<typeof spawnWorker>

const minimumNodeMajor = 22
const minimumNodeMinor = 12
const workerShutdownTimeoutMs = 2_000

export function assertSupportedNodeVersion(version: string): void {
  const [majorText, minorText] = version.split('.')
  const major = Number(majorText)
  const minor = Number(minorText)
  const supported =
    Number.isInteger(major) &&
    Number.isInteger(minor) &&
    (major > minimumNodeMajor ||
      (major === minimumNodeMajor && minor >= minimumNodeMinor))
  if (!supported) {
    throw new Error(
      `The mobile worker requires Node 22.12 or newer; found ${version}`,
    )
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

class NodeWorkerClient implements MobileWorkerClient {
  private readonly nodePath: string
  private readonly workerEntry: URL
  private readonly pending = new Map<number, PendingRequest>()
  private readonly listeners = new Set<(event: MobileWorkerEvent) => void>()
  private child?: WorkerProcess
  private startPromise?: Promise<void>
  private rejectStart?: (error: Error) => void
  private nextRequestId = 1
  private disposed = false
  private ready = false
  private failure?: Error
  private stderr = ''

  constructor(options: NodeWorkerClientOptions) {
    this.nodePath = options.nodePath ?? 'node'
    this.workerEntry =
      options.workerEntry ?? new URL('./worker.ts', import.meta.url)
  }

  async request(
    request: MobileWorkerRequest,
    signal?: AbortSignal,
  ): Promise<MobileWorkerResponse> {
    if (this.disposed) throw new Error('The mobile worker is disposed')
    if (this.failure) throw this.failure
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    await this.start()
    if (this.disposed) throw new Error('The mobile worker was disposed')
    if (this.failure) throw this.failure
    const child = this.child
    if (!child) throw new Error('The mobile worker is not running')

    const id = this.nextRequestId++
    const response = new Promise<MobileWorkerResponse>((resolve, reject) => {
      const onAbort = () => {
        this.pending.delete(id)
        reject(new DOMException('Aborted', 'AbortError'))
      }
      signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, {
        resolve: (payload) => {
          signal?.removeEventListener('abort', onAbort)
          resolve(payload)
        },
        reject: (error) => {
          signal?.removeEventListener('abort', onAbort)
          reject(error)
        },
      })
    })

    try {
      child.stdin.write(
        `${JSON.stringify({
          version: mobileWorkerProtocolVersion,
          type: 'request',
          id,
          payload: request,
        })}\n`,
      )
      child.stdin.flush()
    } catch (error) {
      const pending = this.pending.get(id)
      this.pending.delete(id)
      pending?.reject(
        error instanceof Error ? error : new Error(errorMessage(error)),
      )
    }
    return response
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const error = new Error('The mobile worker was disposed')
    this.rejectStart?.(error)
    this.rejectStart = undefined
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    this.listeners.clear()

    const child = this.child
    this.child = undefined
    if (!child || child.exitCode !== null) return
    child.kill(15)
    const forceKill = setTimeout(() => child.kill(9), workerShutdownTimeoutMs)
    await child.exited
    clearTimeout(forceKill)
  }

  subscribe(listener: (event: MobileWorkerEvent) => void): () => void {
    if (this.disposed) throw new Error('The mobile worker is disposed')
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private start(): Promise<void> {
    this.startPromise ??= this.launch()
    return this.startPromise
  }

  private launch(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const child = spawnWorker(this.nodePath, this.workerEntry)
      this.child = child
      this.rejectStart = reject

      void new Response(child.stderr).text().then((stderr) => {
        this.stderr = stderr
      })
      void this.readMessages(child, () => {
        this.ready = true
        this.rejectStart = undefined
        resolve()
      }).catch((error) => {
        this.fail(
          error instanceof Error ? error : new Error(errorMessage(error)),
        )
      })
      void child.exited.then((code) => {
        if (this.child === child) this.child = undefined
        if (this.disposed) return
        const detail = this.stderr.trim()
        const error = new Error(
          `Mobile worker exited before disposal (code ${code})` +
            (detail ? `: ${detail}` : ''),
        )
        this.fail(error)
      })
    })
  }

  private async readMessages(
    child: WorkerProcess,
    onReady: () => void,
  ): Promise<void> {
    const reader = child.stdout.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) return
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        this.handleMessage(line, onReady)
      }
    }
  }

  private handleMessage(line: string, onReady: () => void): void {
    try {
      if (this.ready) {
        this.handleResponse(line)
        return
      }
      const message = workerReadyMessageSchema.parse(JSON.parse(line))
      assertSupportedNodeVersion(message.nodeVersion)
      onReady()
    } catch (error) {
      throw new Error(`Invalid mobile worker message: ${errorMessage(error)}`)
    }
  }

  private handleResponse(line: string): void {
    const message = workerOutputMessageSchema.parse(JSON.parse(line))
    if (message.type === 'event') {
      for (const listener of [...this.listeners]) listener(message.payload)
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return
    this.pending.delete(message.id)
    if (message.ok) pending.resolve(message.payload)
    else pending.reject(new Error(message.error))
  }

  private fail(error: Error): void {
    this.failure ??= error
    this.rejectStart?.(this.failure)
    this.rejectStart = undefined
    for (const pending of this.pending.values()) pending.reject(this.failure)
    this.pending.clear()
    this.child?.kill(15)
  }
}

export function createNodeWorkerClient(
  options: NodeWorkerClientOptions = {},
): MobileWorkerClient {
  return new NodeWorkerClient(options)
}
