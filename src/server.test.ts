import { test, expect, describe, afterAll } from 'bun:test'
import { startServer, stopServer } from './server'
import type { Server } from 'bun'
import { spyOn } from 'bun:test'

// Suppress reporter console output during tests
const logSpy = spyOn(console, 'log').mockImplementation(() => {})

afterAll(() => {
  logSpy.mockRestore()
})

describe('startServer', () => {
  test('detects when a server is ready', async () => {
    // Start a real server on a random port
    const testServer = Bun.serve({
      port: 0,
      fetch() {
        return new Response('ok')
      },
    })

    try {
      const port = testServer.port!
      const managed = await startServer({
        command: 'echo noop',
        port,
        url: `http://localhost:${port}`,
        startupTimeout: 5000,
      })

      // The managed server should have been created
      expect(managed).toBeDefined()
      expect(managed.stop).toBeFunction()

      managed.stop()
    } finally {
      testServer.stop()
    }
  })

  test('throws on timeout when server is unreachable', async () => {
    expect(
      startServer({
        command: 'echo noop',
        port: 19999,
        url: 'http://localhost:19999',
        startupTimeout: 1000,
      }),
    ).rejects.toThrow('Server failed to start within 1000ms')
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

    // stopServer should swallow the error
    expect(() => stopServer(mockServer)).not.toThrow()
  })
})
