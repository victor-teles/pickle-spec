import { basename } from 'node:path'
import { requiredValue } from '../../required-value'
import {
  requestError,
  routeKey,
  type StudioHttpHandler,
  unavailable,
} from '../../server/http'
import { resolveStudioArtifactPath } from '../../server/studio-artifact-path'
import type {
  StudioRunGateway,
  StudioRunRequest,
  StudioRunSnapshot,
  StudioRunStreamEvent,
} from './run.contracts'
import type { RunEventHub } from './run-event-hub'

interface RunRoutesOptions {
  events: RunEventHub
  gateway?: StudioRunGateway
  projectRoot: string
  upgrade(request: Request, runId: string): Response | undefined
}

type PendingRun = {
  runId: string
  pending: StudioRunStreamEvent[]
}

function publishRunEvent(
  options: RunRoutesOptions,
  state: PendingRun,
  event: StudioRunStreamEvent,
): void {
  const runState = state
  if (event.type === 'run-started') runState.runId = event.run.id
  if (!runState.runId) {
    runState.pending.push(event)
    return
  }
  for (const pendingEvent of runState.pending.splice(0)) {
    options.events.publish(runState.runId, pendingEvent)
  }
  options.events.publish(runState.runId, event)
}

async function startRun(
  options: RunRoutesOptions,
  request: Request,
): Promise<Response> {
  if (!options.gateway) return unavailable('Test runs are unavailable')
  const body = (await request.json().catch(() => ({}))) as StudioRunRequest
  const state: PendingRun = { runId: '', pending: [] }
  try {
    const started = await options.gateway.start(body, (event) =>
      publishRunEvent(options, state, event),
    )
    state.runId = started.id
    for (const event of state.pending.splice(0)) {
      options.events.publish(state.runId, event)
    }
    options.events.markActive(started.id)
    void started.done.then(
      () => options.events.finish(started.id),
      () => options.events.finish(started.id),
    )
    return Response.json({ id: started.id })
  } catch (error) {
    return requestError(error, 500)
  }
}

async function cancelRun(
  options: RunRoutesOptions,
  match: RegExpMatchArray,
): Promise<Response> {
  if (!options.gateway) return unavailable('Test runs are unavailable')
  await options.gateway.cancel(decodeURIComponent(requiredValue(match[1])))
  return new Response(null, { status: 204 })
}

async function runSnapshot(
  options: RunRoutesOptions,
  match: RegExpMatchArray,
): Promise<Response> {
  if (!options.gateway) return unavailable('Test runs are unavailable')
  const runId = decodeURIComponent(requiredValue(match[1]))
  const result = await options.gateway.snapshot(runId)
  const scheduled = options.events
    .bufferedEvents(runId)
    .find((event) => event.type === 'run-scheduled')
  return Response.json({
    ...result,
    schedule:
      scheduled?.type === 'run-scheduled' ? scheduled.schedule : undefined,
  } satisfies StudioRunSnapshot)
}

function artifactPath(options: RunRoutesOptions, url: URL): string | Response {
  const resolved = resolveStudioArtifactPath(
    url.searchParams.get('path'),
    options.projectRoot,
  )
  if (resolved.kind === 'missing-query') {
    return new Response('Missing path', { status: 400 })
  }
  if (resolved.kind === 'forbidden') {
    return new Response('Forbidden', { status: 403 })
  }
  return resolved.path
}

function artifactResponse(
  request: Request,
  url: URL,
  path: string,
  file: ReturnType<typeof Bun.file>,
): Response {
  const headers = {
    'content-type': file.type || 'application/octet-stream',
    'content-length': String(file.size),
  }
  if (request.method === 'HEAD') return new Response(null, { headers })
  if (url.searchParams.get('download') !== 'true') {
    return new Response(file, { headers })
  }
  const requestedName = url.searchParams.get('name')
  const downloadName = basename(requestedName || path).replace(/["\r\n]/g, '_')
  return new Response(file, {
    headers: {
      'content-disposition': `attachment; filename="${downloadName}"`,
    },
  })
}

async function readArtifact(
  options: RunRoutesOptions,
  request: Request,
  url: URL,
): Promise<Response> {
  const path = artifactPath(options, url)
  if (path instanceof Response) return path
  const file = Bun.file(path)
  if (!(await file.exists())) return new Response('Not found', { status: 404 })
  return artifactResponse(request, url, path, file)
}

async function handleRunResource(
  options: RunRoutesOptions,
  request: Request,
  url: URL,
) {
  const cancelMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/cancel$/)
  if (cancelMatch && request.method === 'POST') {
    return cancelRun(options, cancelMatch)
  }
  const eventsMatch = url.pathname.match(/^\/api\/runs\/([^/]+)\/events$/)
  if (eventsMatch && request.method === 'GET') {
    const runId = decodeURIComponent(requiredValue(eventsMatch[1]))
    return options.upgrade(request, runId)
  }
  const runMatch = url.pathname.match(/^\/api\/runs\/([^/]+)$/)
  return runMatch && request.method === 'GET'
    ? runSnapshot(options, runMatch)
    : null
}

async function handleRunRequest(
  options: RunRoutesOptions,
  request: Request,
  url: URL,
) {
  const exactRoutes: Record<string, () => Promise<Response>> = {
    'POST /api/runs': () => startRun(options, request),
    'GET /api/artifact': () => readArtifact(options, request, url),
    'HEAD /api/artifact': () => readArtifact(options, request, url),
  }
  const exact = exactRoutes[routeKey(request, url)]
  return exact ? exact() : handleRunResource(options, request, url)
}

export function createRunRoutes(options: RunRoutesOptions): StudioHttpHandler {
  return (request, url) => handleRunRequest(options, request, url)
}
