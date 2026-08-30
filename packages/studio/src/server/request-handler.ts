import type { ServerRequest } from 'srvx'
import { parseStudioRoute } from '../app/studio-route'
import { secureStudioResponse } from './response-security'
import type { StudioRuntime } from './runtime'

const sessionCookie = 'pickle_studio_token'

interface RequestHandlerOptions {
  hostname: string
  runtime: StudioRuntime
  token: string
}

interface RequestContext {
  origin: string
  request: ServerRequest
  url: URL
}

export type StudioRequestHandler = (
  request: ServerRequest,
) => Promise<Response | undefined>

function browserHostname(hostname: string): string {
  return hostname.includes(':') ? `[${hostname}]` : hostname
}

function requestToken(request: Request): string | undefined {
  const authorization = request.headers.get('authorization')
  if (authorization?.startsWith('Bearer ')) {
    const bearerToken = authorization.slice(7)
    if (bearerToken) return bearerToken
  }
  const query = new URL(request.url).searchParams.get('token')
  if (query) return query
  const cookie = request.headers.get('cookie')
  if (!cookie) return undefined
  for (const part of cookie.split(';')) {
    const [name, ...rest] = part.trim().split('=')
    if (name === sessionCookie) return decodeURIComponent(rest.join('='))
  }
}

class StudioRequestRouter {
  constructor(private readonly options: RequestHandlerOptions) {}

  async handle(request: ServerRequest): Promise<Response | undefined> {
    const context = this.context(request)
    if (context instanceof Response) return context
    const response = await this.route(context)
    return response
      ? await secureStudioResponse(response, context.origin)
      : undefined
  }

  private context(request: ServerRequest): RequestContext | Response {
    const localServer = request.runtime?.bun?.server
    if (!localServer) {
      return new Response('Studio server unavailable', { status: 500 })
    }
    return {
      origin: `http://${browserHostname(this.options.hostname)}:${localServer.port}`,
      request,
      url: new URL(request.url),
    }
  }

  private async route(context: RequestContext) {
    const publicResponse =
      (await this.options.runtime.serveAsset(context.request, context.url)) ??
      (await this.studioPage(context))
    if (publicResponse) return this.authorize(context, publicResponse)
    if (!this.authorized(context)) {
      return new Response('Unauthorized', { status: 401 })
    }
    return this.authenticated(context)
  }

  private async studioPage(context: RequestContext): Promise<Response | null> {
    if (context.request.method !== 'GET') return null
    const routeKind = parseStudioRoute(context.url.href).kind
    if (context.url.pathname !== '/index.html' && routeKind === 'not-found') {
      return null
    }
    const response = await this.options.runtime.startResponse(context.request)
    response.headers.append(
      'set-cookie',
      `${sessionCookie}=${encodeURIComponent(this.options.token)}; Path=/; HttpOnly; SameSite=Strict`,
    )
    return response
  }

  private authenticated(context: RequestContext) {
    if (context.url.pathname.startsWith('/api/')) {
      return this.options.runtime.handleApi(context.request, context.url)
    }
    if (
      context.request.method === 'GET' &&
      !context.url.pathname.startsWith('/_serverFn/')
    ) {
      return new Response('Not found', { status: 404 })
    }
    return this.options.runtime.startResponse(context.request)
  }

  private authorized(context: RequestContext): boolean {
    if (requestToken(context.request) !== this.options.token) return false
    const origin = context.request.headers.get('origin')
    return !origin || origin === context.origin
  }

  private authorize(context: RequestContext, response: Response): Response {
    return this.authorized(context)
      ? response
      : new Response('Unauthorized', { status: 401 })
  }
}

export function createStudioRequestHandler(
  options: RequestHandlerOptions,
): StudioRequestHandler {
  const router = new StudioRequestRouter(options)
  return (request) => router.handle(request)
}
