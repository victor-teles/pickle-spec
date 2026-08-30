export type StudioHttpResponse = Response | null | undefined

export type StudioHttpHandler = (
  request: Request,
  url: URL,
) => Promise<StudioHttpResponse>

export function requestError(error: unknown, status = 400): Response {
  const message = error instanceof Error ? error.message : String(error)
  return new Response(message, { status })
}

export function routeKey(request: Request, url: URL): string {
  return `${request.method} ${url.pathname}`
}

export function unavailable(message: string): Response {
  return new Response(message, { status: 501 })
}
