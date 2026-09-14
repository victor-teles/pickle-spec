import { studioRunRequestSchema } from './run.schemas'
import { basename } from 'node:path'
import { requiredValue } from '../../required-value'
import {
  requestError,
  routeKey,
  type StudioHttpHandler,
  unavailable,
} from '../../server/http'
import { readStudioArtifact } from '../../server/studio-artifact-path'
import type {
  StudioRunGateway,
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
  const parsed = studioRunRequestSchema.safeParse(
    await request.json().catch(() => ({})),
  )
  if (!parsed.success) return requestError(parsed.error)
  const state: PendingRun = { runId: '', pending: [] }
  try {
    const started = await options.gateway.start(parsed.data, (event) =>
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

function artifactResponse(
  request: Request,
  url: URL,
  path: string,
  size: number,
  body?: ReadableStream,
): Response {
  const contentType = Bun.file(path).type || 'application/octet-stream'
  const headers = {
    'content-type': contentType,
    'content-length': String(size),
  }
  if (request.method === 'HEAD') return new Response(null, { headers })
  if (url.searchParams.get('download') !== 'true') {
    return new Response(body, { headers })
  }
  const requestedName = url.searchParams.get('name')
  const downloadName = basename(requestedName || path).replace(/["\r\n]/g, '_')
  return new Response(body, {
    headers: {
      'content-disposition': `attachment; filename="${downloadName}"`,
      'content-type': contentType,
    },
  })
}

async function readArtifact(
  options: RunRoutesOptions,
  request: Request,
  url: URL,
): Promise<Response> {
  const artifact = await readStudioArtifact(
    url.searchParams.get('path'),
    options.projectRoot,
    request.method !== 'HEAD',
  )
  if (artifact.kind === 'missing-query') {
    return new Response('Missing path', { status: 400 })
  }
  if (artifact.kind === 'missing') {
    return new Response('Not found', { status: 404 })
  }
  if (artifact.kind === 'forbidden') {
    return new Response('Forbidden', { status: 403 })
  }
  return artifactResponse(
    request,
    url,
    artifact.path,
    artifact.size,
    artifact.body,
  )
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
  const exactRoutes = new Map(
    Object.entries({
      'POST /api/runs': () => startRun(options, request),
      'GET /api/artifact': () => readArtifact(options, request, url),
      'HEAD /api/artifact': () => readArtifact(options, request, url),
    }),
  )
  const exact = exactRoutes.get(routeKey(request, url))
  return exact ? exact() : handleRunResource(options, request, url)
}

export function createRunRoutes(options: RunRoutesOptions): StudioHttpHandler {
  return (request, url) => handleRunRequest(options, request, url)
}
