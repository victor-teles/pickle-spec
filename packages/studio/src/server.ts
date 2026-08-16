import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join, resolve } from 'node:path'
import type { RunEvent, TestRunManifest } from '@pickle-spec/runner'
import tailwind from 'bun-plugin-tailwind'

export interface StudioScenario {
  id: string
  name: string
}

export interface StudioSpecification {
  id: string
  name: string
  uri: string
  scenarios: readonly StudioScenario[]
}

export interface StudioProject {
  name: string
  root: string
  profiles: readonly string[]
  suites: readonly string[]
  specifications: readonly StudioSpecification[]
}

export interface StudioRunRequest {
  suite?: string
  profiles?: readonly string[]
  paths?: readonly string[]
  scenarioName?: string
}

export interface StudioRunSnapshot {
  id: string
  events: RunEvent[]
  manifest?: TestRunManifest
}

export interface StudioRunGateway {
  start(
    request: StudioRunRequest | undefined,
    onEvent: (event: RunEvent) => void,
  ): Promise<{ id: string; done?: Promise<unknown> }>
  snapshot(id: string): Promise<StudioRunSnapshot>
  cancel(id: string): Promise<void>
}

export interface StudioOptions {
  project: StudioProject
  gateway?: StudioRunGateway
  hostname?: string
  port?: number
  token?: string
  open?: boolean
}

export interface StudioServer {
  url: string
  token: string
  stop(): void
}

type HtmlAsset = {
  index: string
  files: Map<string, Blob>
  outdir: string
}

type StudioStreamEvent =
  | RunEvent
  | { type: 'run-finished'; run: { id: string } }

const sessionCookie = 'pickle_studio_token'
const loopbackHosts = new Set(['127.0.0.1', 'localhost', '::1'])

const htmlEntry = join(import.meta.dir, 'index.html')

async function buildUi(): Promise<HtmlAsset> {
  const outdir = await mkdtemp(join(tmpdir(), 'pickle-studio-ui-'))
  const result = await Bun.build({
    entrypoints: [htmlEntry],
    outdir,
    target: 'browser',
    plugins: [tailwind],
  })
  if (!result.success) {
    await rm(outdir, { recursive: true, force: true })
    throw new Error('Studio UI failed to build')
  }
  const files = new Map<string, Blob>()
  for (const output of result.outputs) {
    const name = basename(output.path)
    files.set(name, output)
    files.set(`/${name}`, output)
  }
  const index = files.get('index.html')
  if (!index) {
    await rm(outdir, { recursive: true, force: true })
    throw new Error('Studio UI build did not produce index.html')
  }
  return { index: await index.text(), files, outdir }
}

function requestToken(request: Request): string | undefined {
  const authorization = request.headers.get('authorization')
  if (authorization?.startsWith('Bearer ')) return authorization.slice(7)
  const query = new URL(request.url).searchParams.get('token')
  if (query) return query
  const cookie = request.headers.get('cookie')
  if (!cookie) return undefined
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === sessionCookie) return decodeURIComponent(rest.join('='))
  }
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

export async function startStudio(
  options: StudioOptions,
): Promise<StudioServer> {
  const hostname = options.hostname ?? '127.0.0.1'
  if (!loopbackHosts.has(hostname)) {
    console.warn(
      `Studio is bound to ${hostname}. Remote access exposes the session token.`,
    )
  }
  const token = options.token ?? crypto.randomUUID()
  const ui = await buildUi()
  const listeners = new Map<string, Set<(event: StudioStreamEvent) => void>>()
  const buffers = new Map<string, StudioStreamEvent[]>()

  function publish(id: string, event: StudioStreamEvent): void {
    if (!id) return
    const events = buffers.get(id) ?? []
    events.push(event)
    buffers.set(id, events)
    for (const listener of listeners.get(id) ?? []) listener(event)
  }

  function authorized(request: Request, origin: string): boolean {
    if (requestToken(request) !== token) return false
    const header = request.headers.get('origin')
    return !header || header === origin
  }

  const server = Bun.serve<{
    runId: string
    listener?: (event: StudioStreamEvent) => void
  }>({
    hostname,
    port: options.port ?? 0,
    websocket: {
      open(ws) {
        const runId = ws.data.runId
        for (const event of buffers.get(runId) ?? []) {
          ws.send(JSON.stringify(event))
        }
        const listener = (event: StudioStreamEvent) => {
          ws.send(JSON.stringify(event))
        }
        const set = listeners.get(runId) ?? new Set()
        set.add(listener)
        listeners.set(runId, set)
        ws.data = { runId, listener }
      },
      message() {},
      close(ws) {
        if (!ws.data.listener) return
        listeners.get(ws.data.runId)?.delete(ws.data.listener)
      },
    },
    async fetch(request, server) {
      const url = new URL(request.url)
      const origin = `http://${hostname}:${server.port}`
      if (url.pathname === '/' || url.pathname === '/index.html') {
        if (!authorized(request, origin)) {
          return new Response('Unauthorized', { status: 401 })
        }
        return new Response(ui.index, {
          headers: {
            'content-type': 'text/html; charset=utf-8',
            'set-cookie': `${sessionCookie}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`,
          },
        })
      }
      const asset =
        ui.files.get(url.pathname) ?? ui.files.get(basename(url.pathname))
      if (asset && request.method === 'GET') {
        if (!authorized(request, origin)) {
          return new Response('Unauthorized', { status: 401 })
        }
        return new Response(asset)
      }
      if (!authorized(request, origin)) {
        return new Response('Unauthorized', { status: 401 })
      }
      if (url.pathname === '/api/project' && request.method === 'GET') {
        return Response.json(options.project)
      }
      if (url.pathname === '/api/runs' && request.method === 'POST') {
        if (!options.gateway) {
          return new Response('Test runs are unavailable', { status: 501 })
        }
        const body = (await request
          .json()
          .catch(() => ({}))) as StudioRunRequest
        let runId = ''
        try {
          const started = await options.gateway.start(body, (event) => {
            if (event.type === 'run-started') runId = event.run.id
            publish(runId, event)
          })
          runId = started.id
          void started.done?.then(
            () => publish(runId, { type: 'run-finished', run: { id: runId } }),
            () => publish(runId, { type: 'run-finished', run: { id: runId } }),
          )
          return Response.json({ id: started.id })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          return new Response(message, { status: 500 })
        }
      }
      if (url.pathname === '/api/artifact' && request.method === 'GET') {
        const filePath = url.searchParams.get('path')
        if (!filePath) return new Response('Missing path', { status: 400 })
        const resolved = resolve(filePath)
        const allowed = resolve(options.project.root, '.pickle', 'runs')
        if (resolved !== allowed && !resolved.startsWith(`${allowed}/`)) {
          return new Response('Forbidden', { status: 403 })
        }
        const file = Bun.file(resolved)
        if (!(await file.exists()))
          return new Response('Not found', { status: 404 })
        return new Response(file)
      }
      const cancelMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/)
      if (cancelMatch && request.method === 'POST') {
        if (!options.gateway) {
          return new Response('Test runs are unavailable', { status: 501 })
        }
        await options.gateway.cancel(decodeURIComponent(cancelMatch[1]!))
        return new Response(null, { status: 204 })
      }
      const eventsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/)
      if (eventsMatch && request.method === 'GET') {
        const runId = decodeURIComponent(eventsMatch[1]!)
        const upgraded = server.upgrade(request, { data: { runId } })
        if (upgraded) return
        return new Response('WebSocket upgrade failed', { status: 400 })
      }
      const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/)
      if (runMatch && request.method === 'GET') {
        if (!options.gateway) {
          return new Response('Test runs are unavailable', { status: 501 })
        }
        return Response.json(
          await options.gateway.snapshot(decodeURIComponent(runMatch[1]!)),
        )
      }
      return new Response('Not found', { status: 404 })
    },
  })

  const url = `http://${hostname}:${server.port}/?token=${token}`
  if (options.open) openBrowser(url)

  return {
    url,
    token,
    stop() {
      server.stop(true)
      void rm(ui.outdir, { recursive: true, force: true })
    },
  }
}
