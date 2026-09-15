import { spawn } from 'node:child_process'
import type { Server as HttpServer } from 'node:http'
import { serve } from 'srvx/node'
import type { StudioOptions, StudioServer } from './contracts'
import { createStudioRequestHandler } from './request-handler'
import { createStudioRuntime } from './runtime'
import type { StudioSocketData } from './socket-data'
import { attachStudioWebSockets } from './websocket'

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
  let command = ['xdg-open', url]
  if (process.platform === 'darwin') command = ['open', url]
  if (process.platform === 'win32') command = ['cmd', '/c', 'start', '', url]
  const child = spawn(command[0] ?? '', command.slice(1), { stdio: 'ignore' })
  child.once('error', (error) =>
    console.warn(`Unable to open Studio browser: ${error.message}`),
  )
  child.unref()
}

export async function startStudio(
  options: StudioOptions,
): Promise<StudioServer> {
  const hostname = studioHostname(options)
  const token = options.token ?? crypto.randomUUID()
  const upgrades = new WeakMap<Request, StudioSocketData>()
  const runtime = await createStudioRuntime(options, (request, data) => {
    if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('WebSocket upgrade required', { status: 400 })
    }
    upgrades.set(request, data)
    return
  })
  const origin = () => {
    if (!server.url) throw new Error('Studio server did not expose a URL')
    return new URL(server.url).origin
  }
  const requestHandler = createStudioRequestHandler({ runtime, token, origin })
  const server = serve({
    hostname,
    port: options.port ?? 0,
    gracefulShutdown: false,
    silent: true,
    fetch: async (request) =>
      (await requestHandler(request)) ??
      new Response('Invalid upgrade', { status: 400 }),
  })
  const httpServer = server.node?.server
  if (!httpServer) {
    runtime.stop()
    throw new Error('Studio Node.js server is unavailable')
  }
  const closeSockets = attachStudioWebSockets(
    httpServer as HttpServer,
    origin,
    requestHandler,
    runtime,
    upgrades,
  )
  try {
    await server.ready()
  } catch (error) {
    closeSockets()
    runtime.stop()
    throw error
  }
  const url = `${origin()}/?token=${token}`
  if (options.open) openBrowser(url)
  return {
    url,
    token,
    stop() {
      closeSockets()
      runtime.stop()
      void server.close(true)
    },
  }
}
