import type {
  SpecificationMetadata,
  StructuredSpecification,
} from '@pickle-spec/spec'
import { specificationSourceDiff } from '@pickle-spec/spec'
import {
  requestError,
  routeKey,
  type StudioHttpHandler,
  unavailable,
} from '../../server/http'
import type { StudioAuthoringGateway } from '../project/project.contracts'
import { DocumentConflictError, type SpecificationWorkspace } from './documents'

type DocumentPreviewRequest = {
  uri: string
  source: string
  specification?: StructuredSpecification
  metadata?: SpecificationMetadata
  diffAgainst?: string
}

type DocumentWriteRequest = {
  uri: string
  source: string
  expectedRevision?: string
  create?: boolean
}

type DocumentProposeRequest = {
  prompt: string
  uri?: string
  currentSource?: string
}

interface DocumentRoutesOptions {
  authoring?: StudioAuthoringGateway
  documents: SpecificationWorkspace
  upgrade(request: Request): Response | undefined
}

function conflictResponse(error: DocumentConflictError, source: string) {
  return Response.json(
    {
      code: error.code,
      uri: error.uri,
      diskSource: error.diskSource,
      revision: error.revision,
      diff: specificationSourceDiff(source, error.diskSource),
    },
    { status: 409 },
  )
}

async function readDocument(
  options: DocumentRoutesOptions,
  url: URL,
): Promise<Response> {
  const uri = url.searchParams.get('uri')
  if (!uri) return new Response('Missing uri', { status: 400 })
  try {
    return Response.json(await options.documents.read(uri))
  } catch (error) {
    return requestError(error, 404)
  }
}

async function previewDocument(
  options: DocumentRoutesOptions,
  request: Request,
): Promise<Response> {
  const body = (await request.json()) as DocumentPreviewRequest
  try {
    return Response.json(
      options.documents.preview({
        uri: body.uri,
        source: body.source,
        specification: body.specification,
        metadata: body.metadata,
        diffAgainst: body.diffAgainst,
      }),
    )
  } catch (error) {
    return requestError(error)
  }
}

async function writeDocument(
  options: DocumentRoutesOptions,
  request: Request,
): Promise<Response> {
  const body = (await request.json()) as DocumentWriteRequest
  try {
    return Response.json(
      await options.documents.write({
        uri: body.uri,
        source: body.source,
        expectedRevision: body.expectedRevision,
        create: body.create,
      }),
    )
  } catch (error) {
    return error instanceof DocumentConflictError
      ? conflictResponse(error, body.source)
      : requestError(error)
  }
}

async function proposeDocument(
  options: DocumentRoutesOptions,
  request: Request,
): Promise<Response> {
  if (!options.authoring?.propose) {
    return unavailable('AI assistance is unavailable')
  }
  const body = (await request.json()) as DocumentProposeRequest
  try {
    return Response.json(
      await options.documents.propose({
        prompt: body.prompt,
        uri: body.uri,
        currentSource: body.currentSource,
        author: options.authoring.propose,
      }),
    )
  } catch (error) {
    return requestError(error)
  }
}

export function createDocumentRoutes(
  options: DocumentRoutesOptions,
): StudioHttpHandler {
  return async function handleDocumentRequest(request, url) {
    if (request.method === 'GET' && url.pathname === '/api/workspace/events') {
      return options.upgrade(request)
    }
    const routes: Record<string, () => Promise<Response>> = {
      'GET /api/documents': () => readDocument(options, url),
      'GET /api/documents/completions': async () =>
        Response.json(await options.documents.completions()),
      'POST /api/documents/preview': () => previewDocument(options, request),
      'PUT /api/documents': () => writeDocument(options, request),
      'POST /api/documents/propose': () => proposeDocument(options, request),
    }
    return routes[routeKey(request, url)]?.() ?? null
  }
}
