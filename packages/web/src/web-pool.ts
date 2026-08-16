import type { BrowserOptions, WebAutomationFactory } from './web-adapter'

export class IsolationVerificationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'IsolationVerificationError'
  }
}

interface PooledProcess {
  process: Awaited<ReturnType<WebAutomationFactory['launch']>>
  idleTimer?: ReturnType<typeof setTimeout>
}

export interface WebProcessPoolOptions {
  factory: WebAutomationFactory
  idleTimeoutMs?: number
}

export class WebProcessPool {
  private readonly factory: WebAutomationFactory
  private readonly idleTimeoutMs: number
  private readonly available: PooledProcess[] = []
  private disposed = false

  constructor(options: WebProcessPoolOptions) {
    this.factory = options.factory
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30_000
  }

  async openLogicalSession(
    browserOptions: BrowserOptions,
    signal?: AbortSignal,
  ) {
    if (this.disposed) {
      throw new Error('Web process pool is disposed')
    }
    if (signal?.aborted) {
      throw new DOMException('Scenario cancelled', 'AbortError')
    }

    const pooled = await this.checkout(browserOptions, signal)
    try {
      const automation = await pooled.process.openContext({
        browser: browserOptions,
        signal,
      })
      const isolation = await automation.readIsolationState()
      if (isolation.cookieCount > 0 || isolation.storageKeyCount > 0) {
        await this.retire(pooled)
        throw new IsolationVerificationError(
          'Logical session isolation verification failed',
        )
      }
      let released = false
      const release = async () => {
        if (released) return
        released = true
        const state = await automation.readIsolationState()
        if (state.cookieCount > 0 || state.storageKeyCount > 0) {
          await this.retire(pooled)
          return
        }
        await this.release(pooled)
      }
      return { automation, release }
    } catch (error) {
      if (!(error instanceof IsolationVerificationError)) {
        await this.retire(pooled)
      }
      throw error
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    this.disposed = true
    const processes = this.available.splice(0)
    await Promise.all(processes.map((entry) => this.closePooled(entry)))
  }

  private async checkout(
    browserOptions: BrowserOptions,
    signal?: AbortSignal,
  ): Promise<PooledProcess> {
    while (this.available.length > 0) {
      const pooled = this.available.pop()!
      if (pooled.idleTimer) clearTimeout(pooled.idleTimer)
      pooled.idleTimer = undefined
      return pooled
    }
    const process = await this.factory.launch({
      browser: browserOptions,
      signal,
    })
    return { process }
  }

  private async release(pooled: PooledProcess): Promise<void> {
    if (this.disposed) {
      await pooled.process.close()
      return
    }
    if (pooled.idleTimer) clearTimeout(pooled.idleTimer)
    pooled.idleTimer = setTimeout(() => {
      void this.closeIdle(pooled)
    }, this.idleTimeoutMs)
    this.available.push(pooled)
  }

  private async retire(pooled: PooledProcess): Promise<void> {
    if (pooled.idleTimer) clearTimeout(pooled.idleTimer)
    await pooled.process.close()
  }

  private async closeIdle(pooled: PooledProcess): Promise<void> {
    const index = this.available.indexOf(pooled)
    if (index === -1) return
    this.available.splice(index, 1)
    await pooled.process.close()
  }

  private async closePooled(pooled: PooledProcess): Promise<void> {
    if (pooled.idleTimer) clearTimeout(pooled.idleTimer)
    await pooled.process.close()
  }
}
