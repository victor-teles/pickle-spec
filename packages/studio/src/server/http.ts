export type StudioHttpResponse = Response | null | undefined

export type StudioHttpHandler = (
  request: Request,
  url: URL,
) => Promise<StudioHttpResponse>

export function requestError(cause: unknown, status = 400): Response {
  const message = cause instanceof Error ? cause.message : String(cause)
  return new Response(message, { status })
}

export function routeKey(request: Request, url: URL): string {
  return `${request.method} ${url.pathname}`
}

export function unavailable(message: string): Response {
  return new Response(message, { status: 501 })
}
