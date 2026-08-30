import type { ServerWebSocket } from 'bun'
import { type ServerHandler, serve } from 'srvx'
import type { StudioOptions, StudioServer } from './contracts'
import {
  createStudioRequestHandler,
  type StudioRequestHandler,
} from './request-handler'
import { createStudioRuntime, type StudioRuntime } from './runtime'
import type { StudioSocketData } from './socket-data'

export type * from './contracts'

const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1'])

function studioHostname(options: StudioOptions): string {
  const hostname = options.hostname ?? '127.0.0.1'
  const remote = !loopbackHosts.has(hostname)
  if (remote && !options.allowRemoteAccess) {
    throw new Error(
      `Studio refuses to bind to ${hostname} without explicit remote access`,
    )
  }
  if (remote) {
    console.warn(
      `Remote Studio access is enabled on ${hostname}. The session token grants access to local project data; use a trusted network.`,
    )
  }
  return hostname
}

function openBrowser(url: string): void {
  if (process.platform === 'darwin') {
    Bun.spawn(['open', url], { stdout: 'ignore', stderr: 'ignore' })
    return
  }
  if (process.platform === 'win32') {
    Bun.spawn(['cmd', '/c', 'start', '', url], {
      stdout: 'ignore',
      stderr: 'ignore',
    })
    return
  }
  Bun.spawn(['xdg-open', url], { stdout: 'ignore', stderr: 'ignore' })
}

function websocketHandlers(runtime: StudioRuntime) {
  return {
    open(socket: ServerWebSocket<StudioSocketData>) {
      runtime.openSocket(socket)
    },
    message() {},
    close(socket: ServerWebSocket<StudioSocketData>) {
      runtime.closeSocket(socket)
    },
  }
}

function startServer(
  options: StudioOptions,
  hostname: string,
  runtime: StudioRuntime,
  requestHandler: StudioRequestHandler,
) {
  return serve({
    hostname,
    port: options.port ?? 0,
    gracefulShutdown: false,
    silent: true,
    bun: { websocket: websocketHandlers(runtime) },
    fetch: requestHandler as ServerHandler,
  })
}

export async function startStudio(
  options: StudioOptions,
): Promise<StudioServer> {
  const hostname = studioHostname(options)
  const token = options.token ?? crypto.randomUUID()
  const runtime = await createStudioRuntime(options)
  const requestHandler = createStudioRequestHandler({
    hostname,
    runtime,
    token,
  })
  const server = startServer(options, hostname, runtime, requestHandler)

  await server.ready()
  if (!server.url) throw new Error('Studio server did not expose a URL')
  const url = `${new URL(server.url).origin}/?token=${token}`
  if (options.open) openBrowser(url)

  return {
    url,
    token,
    stop() {
      runtime.stop()
      void server.close(true)
    },
  }
}
