import { z } from 'zod'
import { expect, test } from 'vitest'
import { startCdpScreencast } from '../../../../src/adapter/live-viewport'

test('streams CDP frames, acknowledges them, and stops the target session', async () => {
  const methods: string[] = []
  const frame = Promise.withResolvers<string>()
  const acknowledged = Promise.withResolvers<void>()
  const stopped = Promise.withResolvers<void>()
  const server = Bun.serve({
    port: 0,
    fetch(request, webServer) {
      return webServer.upgrade(request)
        ? undefined
        : new Response('Upgrade failed', { status: 400 })
    },
    websocket: {
      message(socket, data) {
        const command = z
          .object({
            id: z.number(),
            method: z.string(),
            sessionId: z.string().optional(),
          })
          .parse(JSON.parse(String(data)))
        methods.push(command.method)
        if (command.method === 'Target.attachToTarget') {
          socket.send(
            JSON.stringify({ id: command.id, result: { sessionId: 'cdp-1' } }),
          )
        }
        if (command.method === 'Page.startScreencast') {
          socket.send(
            JSON.stringify({
              id: command.id,
              sessionId: command.sessionId,
              result: {},
            }),
          )
          socket.send(
            JSON.stringify({
              method: 'Page.screencastFrame',
              sessionId: 'cdp-1',
              params: { data: 'jpeg-frame', sessionId: 7 },
            }),
          )
        }
        if (command.method === 'Page.screencastFrameAck') {
          acknowledged.resolve()
        }
        if (command.method === 'Target.detachFromTarget') stopped.resolve()
      },
    },
  })

  try {
    const controller = await startCdpScreencast({
      debuggerUrl: `ws://127.0.0.1:${server.port}`,
      pageId: 'page-1',
      onViewport(viewport) {
        if (viewport.kind === 'frame') frame.resolve(viewport.data)
      },
    })
    expect(await frame.promise).toBe('jpeg-frame')
    await acknowledged.promise
    expect(methods).toContain('Page.screencastFrameAck')

    await controller.close()
    await stopped.promise
    expect(methods).toContain('Page.stopScreencast')
    expect(methods).toContain('Target.detachFromTarget')
  } finally {
    void server.stop(true)
  }
})
