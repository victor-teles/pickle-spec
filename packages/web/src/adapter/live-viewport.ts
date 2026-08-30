import type { Page, StagehandBrowser } from '@browserbasehq/stagehand'
import { z } from 'zod'
import { requiredValue } from '../required-value'
import type { BrowserOptions } from './configuration/web-options'

export type WebLiveViewportTarget = {
  scenarioId: string
  examplesRowId?: string
  profileId: string
  attempt?: number
}

export type WebLiveViewport =
  | {
      kind: 'frame'
      data: string
      mimeType: 'image/jpeg'
      width?: number
      height?: number
    }
  | { kind: 'browserbase'; sessionId: string; url: string }
  | { kind: 'closed' }

export type WebLiveViewportUpdate = WebLiveViewport & {
  target: WebLiveViewportTarget
}

export type WebLiveViewportController = {
  close(): Promise<void>
}

type CdpResponse = {
  id?: number
  result?: unknown
  error?: { message?: string }
  method?: string
  sessionId?: string
  params?: unknown
}

const attachedTargetSchema = z.object({ sessionId: z.string() })
const screencastFrameSchema = z.object({
  data: z.string(),
  sessionId: z.number(),
  metadata: z
    .object({
      deviceWidth: z.number().optional(),
      deviceHeight: z.number().optional(),
    })
    .optional(),
})
const browserbaseDebugSchema = z.object({
  debuggerFullscreenUrl: z.string().url(),
})

function browserbaseApiKey(options: BrowserOptions): string {
  return (
    options.browserbaseApiKey ?? requiredValue(process.env.BROWSERBASE_API_KEY)
  )
}

type BrowserContextWithDebuggerUrl = {
  rpcClient: {
    browserWebSocketDebuggerUrl?: string
  }
}

function browserDebuggerUrl(browser: StagehandBrowser): string {
  const debuggerUrl = (browser.context as BrowserContextWithDebuggerUrl)
    .rpcClient.browserWebSocketDebuggerUrl
  if (!debuggerUrl) throw new Error('Browser does not expose a CDP endpoint')
  return debuggerUrl
}

function validateBrowserbaseLiveUrl(value: string): string {
  const url = new URL(value)
  const browserbaseHost =
    url.hostname === 'browserbase.com' ||
    url.hostname.endsWith('.browserbase.com')
  if (url.protocol !== 'https:' || !browserbaseHost) {
    throw new Error('Browserbase returned an invalid live session URL')
  }
  return url.href
}

export async function loadBrowserbaseLiveViewport(
  sessionId: string,
  options: BrowserOptions,
  signal?: AbortSignal,
): Promise<WebLiveViewport> {
  const response = await fetch(
    `https://api.browserbase.com/v1/sessions/${encodeURIComponent(sessionId)}/debug`,
    {
      headers: { 'X-BB-API-Key': browserbaseApiKey(options) },
      signal,
    },
  )
  if (!response.ok) {
    throw new Error(
      `Browserbase live session request failed with ${response.status}`,
    )
  }
  const debug = browserbaseDebugSchema.parse(await response.json())
  return {
    kind: 'browserbase',
    sessionId,
    url: validateBrowserbaseLiveUrl(debug.debuggerFullscreenUrl),
  }
}

class CdpConnection {
  private nextId = 1
  private readonly pending = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >()

  private constructor(
    private readonly socket: WebSocket,
    private readonly onEvent: (message: CdpResponse) => void,
  ) {
    socket.addEventListener('message', this.handleMessage)
    socket.addEventListener('close', this.handleClose)
  }

  static async connect(
    url: string,
    onEvent: (message: CdpResponse) => void,
  ): Promise<CdpConnection> {
    const socket = new WebSocket(url)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error('CDP connection timed out')),
        3_000,
      )
      socket.addEventListener(
        'open',
        () => {
          clearTimeout(timeout)
          resolve()
        },
        { once: true },
      )
      socket.addEventListener(
        'error',
        () => {
          clearTimeout(timeout)
          reject(new Error('Could not open the browser viewport stream'))
        },
        { once: true },
      )
    }).catch((error) => {
      socket.close()
      throw error
    })
    return new CdpConnection(socket, onEvent)
  }

  async command(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
  ): Promise<unknown> {
    const id = this.nextId++
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
    })
    this.socket.send(JSON.stringify({ id, method, params, sessionId }))
    return response
  }

  send(method: string, params: Record<string, unknown>, sessionId?: string) {
    this.socket.send(
      JSON.stringify({ id: this.nextId++, method, params, sessionId }),
    )
  }

  close(): void {
    this.socket.removeEventListener('message', this.handleMessage)
    this.socket.removeEventListener('close', this.handleClose)
    this.socket.close()
    this.rejectPending(new Error('Browser viewport stream closed'))
  }

  private readonly handleMessage = (event: MessageEvent) => {
    let message: CdpResponse
    try {
      message = JSON.parse(String(event.data)) as CdpResponse
    } catch {
      return
    }
    if (message.id !== undefined) {
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) {
        pending.reject(new Error(message.error.message ?? 'CDP command failed'))
      } else {
        pending.resolve(message.result)
      }
      return
    }
    this.onEvent(message)
  }

  private readonly handleClose = () => {
    this.rejectPending(new Error('Browser viewport stream closed'))
  }

  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
  }
}

export async function startCdpScreencast(input: {
  browser: StagehandBrowser
  page: Page
  onViewport: (viewport: WebLiveViewport) => void
}): Promise<WebLiveViewportController> {
  let attachedSessionId: string | undefined
  const connection = await CdpConnection.connect(
    browserDebuggerUrl(input.browser),
    (message) => {
      if (
        message.method !== 'Page.screencastFrame' ||
        message.sessionId !== attachedSessionId
      ) {
        return
      }
      const frame = screencastFrameSchema.safeParse(message.params)
      if (!frame.success || !attachedSessionId) return
      connection.send(
        'Page.screencastFrameAck',
        { sessionId: frame.data.sessionId },
        attachedSessionId,
      )
      input.onViewport({
        kind: 'frame',
        data: frame.data.data,
        mimeType: 'image/jpeg',
      })
    },
  )

  try {
    const attached = attachedTargetSchema.parse(
      await connection.command('Target.attachToTarget', {
        targetId: input.page.pageId,
        flatten: true,
      }),
    )
    attachedSessionId = attached.sessionId
    await connection.command(
      'Page.startScreencast',
      {
        format: 'jpeg',
        quality: 70,
        maxWidth: 1280,
        maxHeight: 720,
        everyNthFrame: 1,
      },
      attachedSessionId,
    )
  } catch (error) {
    connection.close()
    throw error
  }

  let closed = false
  return {
    async close() {
      if (closed) return
      closed = true
      if (attachedSessionId) {
        connection.send('Page.stopScreencast', {}, attachedSessionId)
        connection.send('Target.detachFromTarget', {
          sessionId: attachedSessionId,
        })
      }
      connection.close()
    },
  }
}

export async function startStagehandLiveViewport(input: {
  browser: StagehandBrowser
  options: BrowserOptions
  onViewport: (viewport: WebLiveViewport) => void
  signal?: AbortSignal
}): Promise<WebLiveViewportController> {
  if (input.browser.provider === 'browserbase') {
    if (!input.browser.sessionId) {
      throw new Error('Browserbase session did not expose a session ID')
    }
    input.onViewport(
      await loadBrowserbaseLiveViewport(
        input.browser.sessionId,
        input.options,
        input.signal,
      ),
    )
    return { close: async () => {} }
  }
  const page = await input.browser.context.activePage()
  if (!page) throw new Error('No active browser page')
  return startCdpScreencast({
    browser: input.browser,
    page,
    onViewport: input.onViewport,
  })
}
