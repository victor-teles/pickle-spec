const impeccableLiveDev =
  Bun.env.NODE_ENV === 'development' ? ['http://localhost:8400'] : []

async function inlineScriptHashes(html: string): Promise<string[]> {
  const scripts = [
    ...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g),
  ]
  return Promise.all(
    scripts.map(async (match) => {
      const source = (match[1] ?? '').replaceAll('\0', '\uFFFD')
      const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(source),
      )
      return `'sha256-${Buffer.from(digest).toString('base64')}'`
    }),
  )
}

export async function secureStudioResponse(
  response: Response,
  origin: string,
): Promise<Response> {
  const websocketOrigin = origin.replace(/^http/, 'ws')
  const headers = new Headers(response.headers)
  const htmlResponse = response.headers
    .get('content-type')
    ?.startsWith('text/html')
  const body = htmlResponse ? await response.text() : response.body
  const scriptHashes = htmlResponse
    ? await inlineScriptHashes(body as string)
    : []
  headers.set('cache-control', 'no-store')
  headers.set(
    'content-security-policy',
    [
      "default-src 'none'",
      "base-uri 'none'",
      ["connect-src 'self'", websocketOrigin, ...impeccableLiveDev].join(' '),
      "font-src 'self' data:",
      "form-action 'self'",
      "frame-src 'self' https://browserbase.com https://*.browserbase.com",
      "frame-ancestors 'none'",
      "img-src 'self' data: blob:",
      "media-src 'self'",
      ["script-src 'self'", ...scriptHashes, ...impeccableLiveDev].join(' '),
      "style-src 'self' 'unsafe-inline'",
    ].join('; '),
  )
  headers.set('referrer-policy', 'no-referrer')
  headers.set('x-content-type-options', 'nosniff')
  return new Response(body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  })
}
