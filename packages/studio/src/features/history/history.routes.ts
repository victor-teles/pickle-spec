import { requiredValue } from '../../required-value'
import {
  requestError,
  routeKey,
  type StudioHttpHandler,
  unavailable,
} from '../../server/http'
import type {
  StudioHistoryGateway,
  StudioRunReportRequest,
  StudioRunsIndex,
} from './history.contracts'
import { studioRunReportDescriptor } from './history.contracts'

type HistoryComparisonRequest = {
  baselineRunId?: string
  candidateRunId?: string
}

interface HistoryRoutesOptions {
  activeRunIds(): readonly string[]
  history?: StudioHistoryGateway
}

function historyUnavailable(): Response {
  return unavailable('Test run history is unavailable')
}

async function historyIndex(options: HistoryRoutesOptions): Promise<Response> {
  if (!options.history) return historyUnavailable()
  return Response.json({
    ...(await options.history.list()),
    activeRunIds: [...options.activeRunIds()].sort(),
  } satisfies StudioRunsIndex)
}

async function compareHistory(
  options: HistoryRoutesOptions,
  request: Request,
): Promise<Response> {
  if (!options.history) return historyUnavailable()
  const body = (await request.json()) as HistoryComparisonRequest
  if (!body.baselineRunId || !body.candidateRunId) {
    return new Response('Select two test runs to compare', { status: 400 })
  }
  return Response.json(
    await options.history.compare(body.baselineRunId, body.candidateRunId),
  )
}

async function importHistory(
  options: HistoryRoutesOptions,
  request: Request,
): Promise<Response> {
  if (!options.history) return historyUnavailable()
  try {
    const archive = new Uint8Array(await request.arrayBuffer())
    return Response.json(await options.history.importArchive(archive))
  } catch (error) {
    return requestError(error)
  }
}

async function deleteEligible(
  options: HistoryRoutesOptions,
): Promise<Response> {
  return options.history
    ? Response.json(await options.history.deleteEligible())
    : historyUnavailable()
}

async function pinHistory(
  options: HistoryRoutesOptions,
  request: Request,
  match: RegExpMatchArray,
): Promise<Response> {
  if (!options.history) return historyUnavailable()
  const runId = decodeURIComponent(requiredValue(match[1]))
  if (request.method === 'POST') await options.history.pin(runId)
  else await options.history.unpin(runId)
  return Response.json({ runId, pinned: request.method === 'POST' })
}

async function exportHistory(
  options: HistoryRoutesOptions,
  url: URL,
  match: RegExpMatchArray,
): Promise<Response> {
  if (!options.history) return historyUnavailable()
  const runId = decodeURIComponent(requiredValue(match[1]))
  const format = decodeURIComponent(requiredValue(match[2]))
  const descriptor = studioRunReportDescriptor(format)
  if (!descriptor) return new Response('Not found', { status: 404 })
  try {
    const request: StudioRunReportRequest =
      descriptor.format === 'html'
        ? {
            runId,
            format: 'html',
            htmlArtifacts:
              url.searchParams.get('artifacts') === 'all' ? 'all' : 'failures',
          }
        : { runId, format: descriptor.format }
    const body = await options.history.exportReport(request)
    const responseBody =
      typeof body === 'string'
        ? body
        : (body.buffer.slice(
            body.byteOffset,
            body.byteOffset + body.byteLength,
          ) as ArrayBuffer)
    return new Response(responseBody, {
      headers: {
        'content-type': descriptor.contentType,
        'content-disposition': `attachment; filename="${runId}${descriptor.filenameSuffix}"`,
      },
    })
  } catch (error) {
    return requestError(error)
  }
}

async function handleHistoryRequest(
  options: HistoryRoutesOptions,
  request: Request,
  url: URL,
) {
  const exactRoutes: Record<string, () => Promise<Response>> = {
    'GET /api/history': () => historyIndex(options),
    'GET /api/runs': () => historyIndex(options),
    'POST /api/history/compare': () => compareHistory(options, request),
    'POST /api/history/import': () => importHistory(options, request),
    'POST /api/history/retention': () => deleteEligible(options),
  }
  const exact = exactRoutes[routeKey(request, url)]
  if (exact) return exact()

  const pinMatch = url.pathname.match(/^\/api\/history\/([^/]+)\/pin$/)
  if (pinMatch && ['POST', 'DELETE'].includes(request.method)) {
    return pinHistory(options, request, pinMatch)
  }
  const exportMatch = url.pathname.match(/^\/api\/history\/([^/]+)\/([^/]+)$/)
  return exportMatch && request.method === 'GET'
    ? exportHistory(options, url, exportMatch)
    : null
}

export function createHistoryRoutes(
  options: HistoryRoutesOptions,
): StudioHttpHandler {
  return (request, url) => handleHistoryRequest(options, request, url)
}
