import { afterAll, afterEach, describe, expect, mock, spyOn, test } from 'bun:test'

const logSpy = spyOn(console, 'log').mockImplementation(() => {})
const {
  setServerRuntimeForTests,
  startServer,
  stopServer,
} = await import(`./server.ts?server-test=${Date.now()}`)

afterAll(() => {
  logSpy.mockRestore()
})

afterEach(() => {
  setServerRuntimeForTests(null)
})

describe('startServer', () => {
  test('detects when a server is ready', async () => {
    let attempts = 0
    const kill = mock(() => {})

    setServerRuntimeForTests({
      spawn: mock(() => ({ kill })) as unknown as typeof Bun.spawn,
      fetch: mock(async () => {
        attempts++
        if (attempts < 3) {
          throw new Error('not ready')
        }
        return new Response('ok', { status: 200 })
      }) as unknown as typeof fetch,
      sleep: mock(async () => {}) as unknown as typeof Bun.sleep,
    })

    const managed = await startServer({
      command: 'echo noop',
      url: 'http://localhost:3456',
      startupTimeout: 5000,
    })

    expect(managed).toBeDefined()
    expect(managed.stop).toBeFunction()
    expect(attempts).toBe(3)

    managed.stop()
    expect(kill).toHaveBeenCalledTimes(1)
  })

  test('runs configured server commands through the platform shell', async () => {
    const spawn = mock(() => ({ kill: mock(() => {}) }))
    const command = 'bun run dev -- --message "hello world" && echo ready'

    setServerRuntimeForTests({
      spawn: spawn as unknown as typeof Bun.spawn,
      fetch: mock(async () => new Response('ok', { status: 200 })) as unknown as typeof fetch,
    })

    await startServer({
      command,
      url: 'http://localhost:3456',
    })

    expect(spawn).toHaveBeenCalledWith(
      process.platform === 'win32'
        ? ['cmd.exe', '/d', '/s', '/c', command]
        : ['/bin/sh', '-c', command],
      expect.objectContaining({ cwd: process.cwd() }),
    )
  })

  test('throws on timeout when server is unreachable', async () => {
    const kill = mock(() => {})

    setServerRuntimeForTests({
      spawn: mock(() => ({ kill })) as unknown as typeof Bun.spawn,
      fetch: mock(async () => {
        throw new Error('still down')
      }) as unknown as typeof fetch,
      sleep: mock(async () => {
        await Bun.sleep(1)
      }) as unknown as typeof Bun.sleep,
    })

    await expect(
      startServer({
        command: 'echo noop',
        url: 'http://localhost:4567',
        startupTimeout: 5,
      }),
    ).rejects.toThrow('Server failed to start within 5ms')

    expect(kill).toHaveBeenCalledTimes(1)
  })

  test('does not accept a readiness response after the startup deadline', async () => {
    const kill = mock(() => {})

    setServerRuntimeForTests({
      spawn: mock(() => ({ kill })) as unknown as typeof Bun.spawn,
      fetch: mock(async () => {
        await Bun.sleep(20)
        return new Response('late but healthy', { status: 200 })
      }) as unknown as typeof fetch,
      sleep: mock(async () => {}) as unknown as typeof Bun.sleep,
    })

    await expect(
      startServer({
        command: 'echo noop',
        url: 'http://localhost:4567',
        startupTimeout: 5,
      }),
    ).rejects.toThrow('Server failed to start within 5ms')

    expect(kill).toHaveBeenCalledTimes(1)
  })

  test('reuses an existing healthy server when configured', async () => {
    const spawn = mock(() => ({ kill: mock(() => {}) }))

    setServerRuntimeForTests({
      spawn: spawn as unknown as typeof Bun.spawn,
      fetch: mock(async () => new Response('ok', { status: 200 })) as unknown as typeof fetch,
      sleep: mock(async () => {}) as unknown as typeof Bun.sleep,
    })

    const managed = await startServer({
      command: 'echo noop',
      url: 'http://localhost:3456',
      reuseExisting: true,
    })

    expect(managed.reused).toBe(true)
    expect(spawn).not.toHaveBeenCalled()
  })

  test('applies the startup deadline to a reuseExisting readiness probe', async () => {
    const spawn = mock(() => ({ kill: mock(() => {}) }))

    setServerRuntimeForTests({
      spawn: spawn as unknown as typeof Bun.spawn,
      fetch: mock(async () => {
        await Bun.sleep(20)
        return new Response('late but healthy', { status: 200 })
      }) as unknown as typeof fetch,
    })

    await expect(
      startServer({
        command: 'echo noop',
        url: 'http://localhost:3456',
        reuseExisting: true,
        startupTimeout: 5,
      }),
    ).rejects.toThrow('Server failed to start within 5ms')

    expect(spawn).not.toHaveBeenCalled()
  })

  test('uses readinessPath with strict success statuses', async () => {
    let attempts = 0

    setServerRuntimeForTests({
      spawn: mock(() => ({ kill: mock(() => {}) })) as unknown as typeof Bun.spawn,
      fetch: mock(async (url: string | URL | Request) => {
        attempts++
        expect(String(url)).toBe('http://localhost:3456/health')
        return attempts === 1
          ? new Response('warming', { status: 404 })
          : new Response('ok', { status: 204 })
      }) as unknown as typeof fetch,
      sleep: mock(async () => {}) as unknown as typeof Bun.sleep,
    })

    const managed = await startServer({
      command: 'echo noop',
      url: 'http://localhost:3456',
      readinessPath: '/health',
      startupTimeout: 5000,
    })

    expect(attempts).toBe(2)
    expect(managed.reused).toBe(false)
  })
})

describe('stopServer', () => {
  test('does not throw when stopping an already stopped process', () => {
    const mockServer = {
      process: {} as any,
      stop: () => {
        throw new Error('already dead')
      },
    }

    expect(() => stopServer(mockServer)).not.toThrow()
  })
})
