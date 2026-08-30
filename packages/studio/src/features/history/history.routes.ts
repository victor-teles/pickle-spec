import { requiredValue } from '../../required-value'
import {
  requestError,
  routeKey,
  type StudioHttpHandler,
  unavailable,
} from '../../server/http'
import type { StudioHistoryGateway, StudioRunsIndex } from './history.contracts'

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
  const exporters: Record<string, () => Promise<Response>> = {
    archive: async () =>
      new Response(await requiredValue(options.history).exportArchive(runId), {
        headers: {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="${runId}.pickle-run.json"`,
        },
      }),
    allure: async () => {
      const bytes = await requiredValue(options.history).exportAllure(runId)
      return new Response(bytes.buffer as ArrayBuffer, {
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${runId}-allure-results.zip"`,
        },
      })
    },
    html: async () => {
      const artifacts =
        url.searchParams.get('artifacts') === 'all' ? 'all' : 'failures'
      const html = await requiredValue(options.history).exportHtml(
        runId,
        artifacts,
      )
      return new Response(html, {
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'content-disposition': `attachment; filename="${runId}.html"`,
        },
      })
    },
  }
  const exporter = match[2] ? exporters[match[2]] : undefined
  return exporter ? exporter() : new Response('Not found', { status: 404 })
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
  const exportMatch = url.pathname.match(
    /^\/api\/history\/([^/]+)\/(html|archive|allure)$/,
  )
  return exportMatch && request.method === 'GET'
    ? exportHistory(options, url, exportMatch)
    : null
}

export function createHistoryRoutes(
  options: HistoryRoutesOptions,
): StudioHttpHandler {
  return (request, url) => handleHistoryRequest(options, request, url)
}
