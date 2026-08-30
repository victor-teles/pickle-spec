import type { Subprocess } from 'bun'
import { describe, expect, test } from 'vitest'
import {
  type ApplicationOutputLine,
  type ServerRuntime,
  startServer,
} from '../../../src/server/server'

function stream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

function runtimeWithOutput(input: {
  stdout: ReadableStream<Uint8Array>
  stderr: ReadableStream<Uint8Array>
  spawnOptions: unknown[]
}): ServerRuntime {
  return {
    fetch: async () => new Response(null, { status: 200 }),
    sleep: async () => {},
    spawn(command, options) {
      input.spawnOptions.push({ command, options })
      return {
        pid: 123,
        stdout: input.stdout,
        stderr: input.stderr,
        kill() {},
      } as Subprocess
    },
  }
}

describe('managed application output', () => {
  test('captures opted-in stdout lines across chunk boundaries without capturing stderr', async () => {
    const lines: ApplicationOutputLine[] = []
    const spawnOptions: unknown[] = []
    const managed = await startServer(
      {
        command: 'bun app.ts',
        url: 'http://localhost:3000',
        output: { stdout: true },
      },
      {
        runtime: runtimeWithOutput({
          stdout: stream('first', ' line\nsecond line\npartial'),
          stderr: stream('private error\n'),
          spawnOptions,
        }),
        now: () => new Date('2026-08-23T12:00:00.000Z'),
        onOutput(line) {
          lines.push(line)
        },
      },
    )

    await managed?.outputComplete

    expect(lines).toEqual([
      {
        occurredAt: '2026-08-23T12:00:00.000Z',
        stream: 'stdout',
        line: 'first line',
      },
      {
        occurredAt: '2026-08-23T12:00:00.000Z',
        stream: 'stdout',
        line: 'second line',
      },
      {
        occurredAt: '2026-08-23T12:00:00.000Z',
        stream: 'stdout',
        line: 'partial',
      },
    ])
    expect(spawnOptions).toEqual([
      expect.objectContaining({
        options: expect.objectContaining({ stdout: 'pipe', stderr: 'ignore' }),
      }),
    ])
  })

  test('captures stderr independently', async () => {
    const lines: ApplicationOutputLine[] = []
    const managed = await startServer(
      {
        command: 'bun app.ts',
        url: 'http://localhost:3000',
        output: { stderr: true },
      },
      {
        runtime: runtimeWithOutput({
          stdout: stream('ignored\n'),
          stderr: stream('warning\n'),
          spawnOptions: [],
        }),
        onOutput(line) {
          lines.push(line)
        },
      },
    )

    await managed?.outputComplete

    expect(
      lines.map(({ stream: outputStream, line }) => ({
        stream: outputStream,
        line,
      })),
    ).toEqual([{ stream: 'stderr', line: 'warning' }])
  })

  test('reports opted-in output as unsupported when the application is reused', async () => {
    const managed = await startServer(
      {
        command: 'bun app.ts',
        url: 'http://localhost:3000',
        reuseExisting: true,
        output: { stdout: true, stderr: true },
      },
      {
        runtime: {
          fetch: async () => new Response(null, { status: 200 }),
          sleep: async () => {},
          spawn() {
            throw new Error('must not spawn')
          },
        },
      },
    )

    expect(managed?.mode).toBe('reused')
    expect(managed?.outputAvailability).toEqual({
      stdout: 'not-supported',
      stderr: 'not-supported',
    })
  })
})
