import type { ServerWebSocket } from 'bun'
import type { ServerRequest } from 'srvx'
import { staticMiddleware } from 'srvx/static'
import { createDocumentRoutes } from '../features/documents/document.routes'
import {
  createSpecificationWorkspace,
  type SpecificationWorkspace,
} from '../features/documents/documents'
import { createWorkspaceEventHub } from '../features/documents/workspace-event-hub'
import { createExecutionCacheRoutes } from '../features/execution-cache/execution-cache.routes'
import { createGitRoutes } from '../features/git/git.routes'
import { createHistoryRoutes } from '../features/history/history.routes'
import {
  createProjectModule,
  type StudioProjectModule,
} from '../features/project/project'
import { createProjectRoutes } from '../features/project/project.routes'
import { createRunRoutes } from '../features/runs/run.routes'
import {
  createRunEventHub,
  type RunEventHub,
} from '../features/runs/run-event-hub'
import type { StudioOptions } from './contracts'
import { createGitWorkspace, type GitWorkspace } from './git'
import type { StudioHttpHandler, StudioHttpResponse } from './http'
import type { StudioSocketData } from './socket-data'
import {
  buildStartApp,
  type StartServerEntry,
  startClientDirectory,
} from './start-app'

export interface StudioRuntime {
  closeSocket(socket: ServerWebSocket<StudioSocketData>): void
  handleApi(request: Request, url: URL): Promise<StudioHttpResponse>
  openSocket(socket: ServerWebSocket<StudioSocketData>): void
  serveAsset(request: Request, url: URL): Promise<Response | null>
  startResponse(request: Request): Promise<Response>
  stop(): void
}

function upgrade(
  request: Request,
  data: StudioSocketData,
): Response | undefined {
  const serverRequest = request as ServerRequest
  const upgraded = serverRequest.runtime?.bun?.server?.upgrade(request, {
    data,
  })
  return upgraded
    ? undefined
    : new Response('WebSocket upgrade failed', { status: 400 })
}

async function handleApi(
  handlers: readonly StudioHttpHandler[],
  request: Request,
  url: URL,
): Promise<StudioHttpResponse> {
  for (const handler of handlers) {
    const response = await handler(request, url)
    if (response !== null) return response
  }
  return new Response('Not found', { status: 404 })
}

interface FeatureModules {
  documents: SpecificationWorkspace
  git: GitWorkspace
  project: StudioProjectModule
  runEvents: RunEventHub
}

function createFeatureHandlers(
  options: StudioOptions,
  modules: FeatureModules,
): readonly StudioHttpHandler[] {
  return [
    createProjectRoutes({
      loadProject: modules.project.load,
      management: options.management,
    }),
    createHistoryRoutes({
      activeRunIds: modules.runEvents.activeRunIds,
      history: options.history,
    }),
    createExecutionCacheRoutes({ executionCache: options.executionCache }),
    createGitRoutes(modules.git),
    createDocumentRoutes({
      authoring: options.authoring,
      documents: modules.documents,
      upgrade: (request) => upgrade(request, { kind: 'workspace' }),
    }),
    createRunRoutes({
      events: modules.runEvents,
      gateway: options.gateway,
      projectRoot: options.project.root,
      upgrade: (request, runId) => upgrade(request, { kind: 'run', runId }),
    }),
  ]
}

async function startResponse(
  startApp: StartServerEntry,
  options: StudioOptions,
  project: StudioProjectModule,
  runEvents: RunEventHub,
  request: Request,
): Promise<Response> {
  return startApp.fetch(request, {
    context: {
      studio: {
        loadProject: project.load,
        async listRuns() {
          if (!options.history) {
            throw new Error('Test run history is unavailable')
          }
          return {
            ...(await options.history.list()),
            activeRunIds: [...runEvents.activeRunIds()].sort(),
          }
        },
      },
    },
  })
}

export async function createStudioRuntime(
  options: StudioOptions,
): Promise<StudioRuntime> {
  const startApp = await buildStartApp()
  const project = createProjectModule(options)
  const documents =
    options.documents ??
    createSpecificationWorkspace({
      root: options.project.root,
      globs: options.specificationGlobs ?? 'features/**/*.feature',
      language: options.language,
    })
  const git = options.git ?? createGitWorkspace(options.project.root)
  const runEvents = createRunEventHub()
  const workspaceEvents = createWorkspaceEventHub()
  const stopWatch = await documents.watch(workspaceEvents.publish)
  const staticAssets = staticMiddleware({
    dir: startClientDirectory,
    immutable: true,
    maxAge: 31_536_000,
  })
  const apiHandlers = createFeatureHandlers(options, {
    documents,
    git,
    project,
    runEvents,
  })

  return {
    closeSocket(socket) {
      if (socket.data.kind === 'workspace') workspaceEvents.close(socket)
      else runEvents.close(socket)
    },
    handleApi: (request, url) => handleApi(apiHandlers, request, url),
    openSocket(socket) {
      if (socket.data.kind === 'workspace') workspaceEvents.open(socket)
      else runEvents.open(socket)
    },
    async serveAsset(request, url) {
      if (url.pathname === '/favicon.ico') {
        return new Response(null, { status: 204 })
      }
      if (!url.pathname.startsWith('/assets/')) return null
      return staticAssets(
        request,
        () => new Response('Not found', { status: 404 }),
      )
    },
    startResponse: (request) =>
      startResponse(startApp, options, project, runEvents, request),
    stop: stopWatch,
  }
}
