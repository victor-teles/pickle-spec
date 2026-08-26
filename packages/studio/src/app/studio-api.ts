export type StudioApi = <Value>(
  path: string,
  init?: RequestInit,
) => Promise<Value>

function consumeStudioToken() {
  const token = new URLSearchParams(location.search).get('token') ?? ''
  if (!token) return token

  const address = new URL(location.href)
  address.searchParams.delete('token')
  history.replaceState(
    null,
    '',
    `${address.pathname}${address.search}${address.hash}`,
  )
  return token
}

export const studioToken = consumeStudioToken()

export const studioApi: StudioApi = async <Value>(
  path: string,
  init?: RequestInit,
) => {
  const headers = new Headers(init?.headers)
  if (studioToken) headers.set('authorization', `Bearer ${studioToken}`)
  const response = await fetch(path, {
    ...init,
    headers,
  })
  if (!response.ok) throw new Error(await response.text())
  return response.json() as Promise<Value>
}
