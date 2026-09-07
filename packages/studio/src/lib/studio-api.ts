import type { z } from 'zod'

export type StudioApi = <Value>(
  path: string,
  schema: z.ZodType<Value>,
  init?: RequestInit,
) => Promise<Value>

export const studioToken =
  typeof location === 'undefined'
    ? ''
    : (new URLSearchParams(location.search).get('token') ?? '')

export const studioApi: StudioApi = async <Value>(
  path: string,
  schema: z.ZodType<Value>,
  init?: RequestInit,
) => {
  const headers = new Headers(init?.headers)
  if (studioToken) headers.set('authorization', `Bearer ${studioToken}`)
  const response = await fetch(path, {
    ...init,
    headers,
  })
  if (!response.ok) throw new Error(await response.text())
  return schema.parse(await response.json())
}
