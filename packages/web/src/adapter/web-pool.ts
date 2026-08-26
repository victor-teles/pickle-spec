import { abortError } from './abort'
import type { ResolvedFidelity } from './fidelity'
import type {
  WebAutomation,
  WebAutomationFactory,
  WebBrowserProcess,
  WebIsolationState,
} from './web-automation'
import type { BrowserOptions } from './web-options'

const defaultIdleTimeoutMs = 30_000

export class IsolationVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IsolationVerificationError'
  }
}

interface PooledProcess {
  process: WebBrowserProcess
  mode: 'adaptive' | 'replay'
  idleTimer?: ReturnType<typeof setTimeout>
}

export interface WebProcessPoolOptions {
  factory: WebAutomationFactory
  idleTimeoutMs?: number
}

export interface WebLogicalSession {
  automation: WebAutomation
  release(): Promise<void>
}

function isDirty(state: WebIsolationState): boolean {
  return state.cookieCount > 0 || state.storageKeyCount > 0
}

export class WebProcessPool {
  private readonly factory: WebAutomationFactory
  private readonly idleTimeoutMs: number
  private readonly available: PooledProcess[] = []
  private disposed = false

  constructor(options: WebProcessPoolOptions) {
    this.factory = options.factory
    this.idleTimeoutMs = options.idleTimeoutMs ?? defaultIdleTimeoutMs
  }

  async openLogicalSession(
    browserOptions: BrowserOptions,
    signal?: AbortSignal,
    fidelity?: ResolvedFidelity,
    mode?: 'adaptive' | 'replay',
  ): Promise<WebLogicalSession> {
    if (this.disposed) {
      throw new Error('Web process pool is disposed')
    }
    if (signal?.aborted) {
      throw abortError()
    }

    const executionMode = mode ?? 'adaptive'
    const pooled = await this.checkout(browserOptions, signal, executionMode)
    try {
      const automation = await pooled.process.openContext({
        browser: browserOptions,
        mode,
        fidelity,
        signal,
      })
      const isolation = await automation.readIsolationState()
      if (isDirty(isolation)) {
        await this.closeProcess(pooled)
        throw new IsolationVerificationError(
          'Logical session isolation verification failed',
        )
      }
      let released = false
      const release = async () => {
        if (released) return
        released = true
        const state = await automation.readIsolationState()
        if (isDirty(state)) {
          await this.closeProcess(pooled)
          return
        }
        await this.release(pooled)
      }
      return { automation, release }
    } catch (error) {
      if (error instanceof IsolationVerificationError) throw error
      await this.closeProcess(pooled)
      throw error
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const processes = this.available.splice(0)
    await Promise.all(processes.map((entry) => this.closeProcess(entry)))
  }

  private async checkout(
    browserOptions: BrowserOptions,
    signal?: AbortSignal,
    mode: 'adaptive' | 'replay' = 'adaptive',
  ): Promise<PooledProcess> {
    const pooledIndex = this.available.findLastIndex(
      (candidate) => candidate.mode === mode,
    )
    const pooled =
      pooledIndex < 0 ? undefined : this.available.splice(pooledIndex, 1)[0]
    if (pooled) {
      this.clearIdleTimer(pooled)
      return pooled
    }
    const process = await this.factory.launch({
      browser: browserOptions,
      signal,
    })
    return { process, mode }
  }

  private async release(pooled: PooledProcess): Promise<void> {
    if (this.disposed) {
      await this.closeProcess(pooled)
      return
    }
    this.clearIdleTimer(pooled)
    pooled.idleTimer = setTimeout(() => {
      void this.closeIdle(pooled)
    }, this.idleTimeoutMs)
    this.available.push(pooled)
  }

  private async closeIdle(pooled: PooledProcess): Promise<void> {
    const index = this.available.indexOf(pooled)
    if (index === -1) return
    this.available.splice(index, 1)
    await this.closeProcess(pooled)
  }

  private async closeProcess(pooled: PooledProcess): Promise<void> {
    this.clearIdleTimer(pooled)
    await pooled.process.close()
  }

  private clearIdleTimer(pooled: PooledProcess): void {
    if (pooled.idleTimer) clearTimeout(pooled.idleTimer)
    pooled.idleTimer = undefined
  }
}
