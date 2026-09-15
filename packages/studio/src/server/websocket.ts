import type { Server } from 'node:http'
import type { Duplex } from 'node:stream'
import { WebSocketServer } from 'ws'
import type { StudioRequestHandler } from './request-handler'
import type { StudioRuntime } from './runtime'
import type { StudioSocket, StudioSocketData } from './socket-data'

async function rejectUpgrade(
  socket: Duplex,
  response: Response,
): Promise<void> {
  const body = Buffer.from(await response.arrayBuffer())
  const headers = new Headers(response.headers)
  headers.set('connection', 'close')
  headers.set('content-length', String(body.byteLength))
  socket.end(
    Buffer.concat([
      Buffer.from(
        `HTTP/1.1 ${response.status} ${response.statusText || 'Rejected'}\r\n${[...headers].map(([name, value]) => `${name}: ${value}\r\n`).join('')}\r\n`,
      ),
      body,
    ]),
  )
}

export function attachStudioWebSockets(
  server: Server,
  origin: () => string,
  handler: StudioRequestHandler,
  runtime: StudioRuntime,
  upgrades: WeakMap<Request, StudioSocketData>,
): () => void {
  const sockets = new WebSocketServer({
    noServer: true,
    maxPayload: 1024 * 1024,
  })
  server.on('upgrade', (incoming, socket, head) => {
    const headers = new Headers()
    for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
      headers.append(
        incoming.rawHeaders[index] ?? '',
        incoming.rawHeaders[index + 1] ?? '',
      )
    }
    const request = new Request(new URL(incoming.url ?? '/', origin()), {
      headers,
    })
    void handler(request)
      .then(async (response) => {
        const data = upgrades.get(request)
        if (response || !data) {
          await rejectUpgrade(
            socket,
            response ?? new Response('Invalid upgrade', { status: 400 }),
          )
          return
        }
        sockets.handleUpgrade(incoming, socket, head, (connection) => {
          const client: StudioSocket = {
            data,
            send: (message) => {
              connection.send(message)
            },
          }
          connection.on('error', () => connection.close())
          connection.once('close', () => runtime.closeSocket(client))
          runtime.openSocket(client)
        })
      })
      .catch(() => socket.destroy())
  })
  return () => {
    for (const socket of sockets.clients) socket.terminate()
    sockets.close()
  }
}
