import { afterEach, describe, expect, mock, test } from 'bun:test'
import type {
  WebAutomation,
  WebAutomationFactory,
  WebBrowserProcess,
} from './web-adapter'
import { IsolationVerificationError, WebProcessPool } from './web-pool'

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
    openContext: mock(async () =>
      typeof automation === 'function' ? automation() : automation,
    ),
    close: mock(async () => {}),
  }
}

function mockFactory(process: WebBrowserProcess | (() => WebBrowserProcess)) {
  const launch = mock(async () =>
    typeof process === 'function' ? process() : process,
  )
  const factory: WebAutomationFactory = { launch }
  return { factory, launch }
}

describe('WebProcessPool', () => {
  afterEach(() => {
    mock.restore()
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
    const launch = mock(async () => {
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
    const launch = mock(async () => {
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
