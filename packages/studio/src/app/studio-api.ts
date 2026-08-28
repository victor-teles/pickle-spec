export type StudioApi = <Value>(
  path: string,
  init?: RequestInit,
) => Promise<Value>

export const studioToken =
  new URLSearchParams(location.search).get('token') ?? ''

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
