import type { Page, StagehandBrowser } from '@browserbasehq/stagehand'
import { expect, test } from 'vitest'
import { startCdpScreencast } from './live-viewport'

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
        const command = JSON.parse(String(data)) as {
          id: number
          method: string
          sessionId?: string
        }
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
  const browser = {
    context: {
      rpcClient: {
        browserWebSocketDebuggerUrl: `ws://127.0.0.1:${server.port}`,
      },
    },
  } as unknown as StagehandBrowser
  const page = { pageId: 'page-1' } as Page

  try {
    const controller = await startCdpScreencast({
      browser,
      page,
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
    server.stop(true)
  }
})
