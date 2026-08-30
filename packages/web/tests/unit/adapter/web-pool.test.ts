import { afterEach, describe, expect, test, vi } from 'vitest'
import type {
  WebAutomation,
  WebAutomationFactory,
  WebBrowserProcess,
<<<<<<<< HEAD:packages/web/src/adapter/session/web-pool.test.ts
} from '../web-adapter'
import { IsolationVerificationError, WebProcessPool } from './web-pool'
========
} from '../../../src/adapter/web-adapter'
import {
  IsolationVerificationError,
  WebProcessPool,
} from '../../../src/adapter/web-pool'
>>>>>>>> origin/main:packages/web/tests/unit/adapter/web-pool.test.ts

function isolatedAutomation(
  overrides: Partial<WebAutomation> = {},
): WebAutomation {
  return {
    async navigate() {},
    async observe() {
      return []
    },
    async act() {
      return { success: true }
    },
    async verify() {
      return { meetsExpectation: true, actualState: 'Ready' }
    },
    async screenshot() {
      return new Uint8Array()
    },
    async readIsolationState() {
      return { cookieCount: 0, storageKeyCount: 0 }
    },
    async close() {},
    ...overrides,
  }
}

function mockProcess(
  automation: WebAutomation | (() => WebAutomation),
): WebBrowserProcess {
  return {
    openContext: vi.fn(async () =>
      typeof automation === 'function' ? automation() : automation,
    ),
    close: vi.fn(async () => {}),
  }
}

function mockFactory(process: WebBrowserProcess | (() => WebBrowserProcess)) {
  const launch = vi.fn(async () =>
    typeof process === 'function' ? process() : process,
  )
  const factory: WebAutomationFactory = { launch }
  return { factory, launch }
}

async function cancellationOutcome(
  operation: Promise<unknown>,
): Promise<string> {
  return Promise.race([
    operation.then(
      () => 'resolved',
      (error: unknown) => (error instanceof Error ? error.name : 'rejected'),
    ),
    Bun.sleep(25).then(() => 'still-pending'),
  ])
}

describe('WebProcessPool', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  test('reuses a browser process for consecutive logical sessions', async () => {
    const { factory, launch } = mockFactory(mockProcess(isolatedAutomation()))
    const pool = new WebProcessPool({ factory, idleTimeoutMs: 60_000 })

    const first = await pool.openLogicalSession({}, undefined)
    await first.automation.close()
    await first.release()

    const second = await pool.openLogicalSession({}, undefined)
    await second.automation.close()
    await second.release()
    await pool.dispose()

    expect(launch).toHaveBeenCalledTimes(1)
  })

  test('cancels browser launch and closes a process that resolves late', async () => {
    const launched = Promise.withResolvers<WebBrowserProcess>()
    const process = mockProcess(isolatedAutomation())
    const pool = new WebProcessPool({
      factory: { launch: () => launched.promise },
    })
    const controller = new AbortController()
    const opening = pool.openLogicalSession({}, controller.signal)

    controller.abort()
    const outcome = await cancellationOutcome(opening)
    launched.resolve(process)
    await opening.catch(() => undefined)
    await Bun.sleep(0)

    expect(outcome).toBe('AbortError')
    expect(process.close).toHaveBeenCalledTimes(1)
  })

  test('cancels context setup and closes resources that resolve late', async () => {
    const opened = Promise.withResolvers<WebAutomation>()
    const automation = isolatedAutomation()
    const process: WebBrowserProcess = {
      openContext: () => opened.promise,
      close: vi.fn(async () => {}),
    }
    const pool = new WebProcessPool({
      factory: { launch: async () => process },
    })
    const controller = new AbortController()
    const opening = pool.openLogicalSession({}, controller.signal)

    await Bun.sleep(0)
    controller.abort()
    const outcome = await cancellationOutcome(opening)
    opened.resolve(automation)
    const session = await opening.catch(() => undefined)
    if (session) {
      await session.automation.close()
      await session.release()
    }
    await Bun.sleep(0)

    expect(outcome).toBe('AbortError')
    expect(process.close).toHaveBeenCalledTimes(1)
  })

  test('discards an interrupted browser process instead of reusing it', async () => {
    const { factory, launch } = mockFactory(() =>
      mockProcess(isolatedAutomation()),
    )
    const pool = new WebProcessPool({ factory, idleTimeoutMs: 60_000 })

    const interrupted = await pool.openLogicalSession({}, undefined)
    await interrupted.automation.close()
    await interrupted.discard()

    const recovered = await pool.openLogicalSession({}, undefined)
    await recovered.automation.close()
    await recovered.release()
    await pool.dispose()

    expect(launch).toHaveBeenCalledTimes(2)
  })

  test('never carries an inference process into Replay', async () => {
    const { factory, launch } = mockFactory(() =>
      mockProcess(isolatedAutomation()),
    )
    const pool = new WebProcessPool({ factory, idleTimeoutMs: 60_000 })

    const adaptive = await pool.openLogicalSession(
      { modelApiKey: 'adaptive-only' },
      undefined,
      undefined,
      'adaptive',
    )
    await adaptive.automation.close()
    await adaptive.release()

    const replay = await pool.openLogicalSession(
      {},
      undefined,
      undefined,
      'replay',
    )
    await replay.automation.close()
    await replay.release()
    await pool.dispose()

    expect(launch).toHaveBeenCalledTimes(2)
  })

  test('retires a process when release finds a dirty logical session', async () => {
    const launch = vi.fn(async () => {
      let readCount = 0
      return mockProcess(
        isolatedAutomation({
          async readIsolationState() {
            readCount++
            if (readCount === 1) return { cookieCount: 0, storageKeyCount: 0 }
            return { cookieCount: 2, storageKeyCount: 0 }
          },
        }),
      )
    })
    const pool = new WebProcessPool({ factory: { launch } })

    const session = await pool.openLogicalSession({}, undefined)
    await session.automation.close()
    await session.release()

    const recovered = await pool.openLogicalSession({}, undefined)
    await recovered.automation.close()
    await recovered.release()
    await pool.dispose()

    expect(launch).toHaveBeenCalledTimes(2)
  })

  test('retires a process when isolation verification fails', async () => {
    let launchCount = 0
    const launch = vi.fn(async () => {
      launchCount++
      const process =
        launchCount === 1
          ? mockProcess(
              isolatedAutomation({
                async readIsolationState() {
                  return { cookieCount: 1, storageKeyCount: 0 }
                },
              }),
            )
          : mockProcess(isolatedAutomation())
      return process
    })
    const pool = new WebProcessPool({ factory: { launch } })

    await expect(pool.openLogicalSession({}, undefined)).rejects.toThrow(
      IsolationVerificationError,
    )

    const recovered = await pool.openLogicalSession({}, undefined)
    await recovered.automation.close()
    await recovered.release()
    await pool.dispose()

    expect(launch).toHaveBeenCalledTimes(2)
  })

  test('waits for logical session close before returning a process to the pool', async () => {
    let closeStarted = false
    let closeFinished = false
    const automation = isolatedAutomation({
      async close() {
        closeStarted = true
        await Bun.sleep(20)
        closeFinished = true
      },
    })
    const { factory } = mockFactory(mockProcess(automation))
    const pool = new WebProcessPool({ factory, idleTimeoutMs: 60_000 })

    const session = await pool.openLogicalSession({}, undefined)
    const releasePromise = (async () => {
      await session.automation.close()
      await session.release()
    })()
    expect(closeFinished).toBe(false)
    await releasePromise
    expect(closeStarted).toBe(true)
    expect(closeFinished).toBe(true)

    await pool.openLogicalSession({}, undefined)
    await pool.dispose()
  })

  test('closes idle processes after the configured timeout', async () => {
    const process = mockProcess(isolatedAutomation())
    const { factory } = mockFactory(process)
    const pool = new WebProcessPool({ factory, idleTimeoutMs: 5 })

    const session = await pool.openLogicalSession({}, undefined)
    await session.automation.close()
    await session.release()

    await Bun.sleep(15)
    expect(process.close).toHaveBeenCalledTimes(1)

    await pool.dispose()
  })

  test('dispose closes warm processes immediately', async () => {
    const process = mockProcess(isolatedAutomation())
    const { factory } = mockFactory(process)
    const pool = new WebProcessPool({ factory, idleTimeoutMs: 60_000 })

    const session = await pool.openLogicalSession({}, undefined)
    await session.automation.close()
    await session.release()
    await pool.dispose()

    expect(process.close).toHaveBeenCalledTimes(1)
  })
})
