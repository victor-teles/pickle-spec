import { type DiagnosticEntry, diagnosticLevels } from '@pickle-spec/runner'
import { z } from 'zod'

export type CollectedWebActivity = {
  occurredAt: string
  description: string
}

export type CollectedWebEvidence = {
  diagnostics: DiagnosticEntry[]
  activity: CollectedWebActivity[]
}

type ObservablePage = {
  evaluate(expression: string): Promise<unknown>
}

const bufferedEvidenceEntrySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('diagnostic'),
    occurredAt: z.iso.datetime(),
    level: z.enum(diagnosticLevels),
    origin: z.enum(['console', 'network']),
    message: z.string(),
  }),
  z.object({
    kind: z.literal('activity'),
    occurredAt: z.iso.datetime(),
    description: z.string(),
  }),
])

const bufferedEvidenceSchema = z.object({
  entries: z.array(bufferedEvidenceEntrySchema),
  droppedCount: z.number().int().nonnegative(),
})

const evidenceBufferKey = '__pickleSpecWebEvidenceV1'

export const installWebEvidenceScript = `(() => {
  const key = '${evidenceBufferKey}'
  if (globalThis[key]?.entries) return
  const buffer = { entries: [], droppedCount: 0 }
  const maxEntries = 500
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: buffer,
  })
  const record = (entry) => {
    if (buffer.entries.length >= maxEntries) {
      buffer.droppedCount++
      return
    }
    buffer.entries.push({ occurredAt: new Date().toISOString(), ...entry })
  }
  const sanitizeUrl = (value) => {
    try {
      const url = new URL(String(value), location.href)
      url.username = ''
      url.password = ''
      for (const name of url.searchParams.keys()) {
        if (/token|secret|password|passwd|authorization|api[-_]?key|session|cookie/i.test(name)) {
          url.searchParams.set(name, '<redacted>')
        }
      }
      return url.toString()
    } catch {
      return '<invalid-url>'
    }
  }
  const recordNetwork = (method, url, status, failure) => {
    const message = String(method).toUpperCase() + ' ' + sanitizeUrl(url) +
      (failure ? ' failed: ' : ' completed: ') + String(status)
    const level = failure
      ? (Number(status) >= 500 ? 'error' : 'warning')
      : 'info'
    record({ kind: 'diagnostic', level, origin: 'network', message })
  }
  const display = (value) => {
    if (typeof value === 'string') return value
    if (value instanceof Error) return value.stack || value.message
    try {
      const serialized = JSON.stringify(value)
      return serialized === undefined ? String(value) : serialized
    } catch {
      return String(value)
    }
  }
  const consoleLevels = {
    debug: 'debug',
    info: 'info',
    log: 'info',
    warn: 'warning',
    error: 'error',
  }
  for (const [method, level] of Object.entries(consoleLevels)) {
    const original = console[method]
    if (typeof original !== 'function') continue
    console[method] = function (...args) {
      record({
        kind: 'diagnostic',
        level,
        origin: 'console',
        message: args.map(display).join(' '),
      })
      return Reflect.apply(original, this, args)
    }
  }
  record({ kind: 'activity', description: 'Navigate ' + sanitizeUrl(location.href) })
  addEventListener('error', (event) => {
    const target = event.target
    const resourceUrl = target && (
      target.currentSrc || target.src || target.href
    )
    if (resourceUrl) {
      recordNetwork('RESOURCE', resourceUrl, 'load error', true)
      return
    }
    record({
      kind: 'diagnostic',
      level: 'error',
      origin: 'console',
      message: event.message || 'Uncaught browser error',
    })
  }, true)
  addEventListener('unhandledrejection', (event) => record({
    kind: 'diagnostic',
    level: 'error',
    origin: 'console',
    message: String(event.reason ?? 'Unhandled promise rejection'),
  }))
  if (typeof fetch === 'function') {
    const originalFetch = fetch
    globalThis.fetch = async function (...args) {
      const request = args[0]
      const requestUrl = typeof request === 'string'
        ? request
        : String(request?.url ?? request)
      const method = String(args[1]?.method ?? request?.method ?? 'GET')
      try {
        const response = await Reflect.apply(originalFetch, this, args)
        recordNetwork(method, response.url || requestUrl, response.status, !response.ok)
        return response
      } catch (error) {
        recordNetwork(method, requestUrl, display(error), true)
        throw error
      }
    }
  }
  if (typeof XMLHttpRequest === 'function') {
    const requestKey = '__pickleSpecRequestV1'
    const originalOpen = XMLHttpRequest.prototype.open
    const originalSend = XMLHttpRequest.prototype.send
    XMLHttpRequest.prototype.open = function (method, url, ...args) {
      this[requestKey] = { method, url: String(url) }
      return Reflect.apply(originalOpen, this, [method, url, ...args])
    }
    XMLHttpRequest.prototype.send = function (...args) {
      const request = this[requestKey] || { method: 'XHR', url: 'request' }
      let recorded = false
      const failed = (event) => {
        if (recorded) return
        recorded = true
        recordNetwork(request.method, request.url, event.type, true)
      }
      this.addEventListener('error', failed, { once: true })
      this.addEventListener('abort', failed, { once: true })
      this.addEventListener('timeout', failed, { once: true })
      this.addEventListener('loadend', () => {
        if (recorded) return
        recorded = true
        recordNetwork(
          request.method,
          this.responseURL || request.url,
          this.status,
          this.status >= 400,
        )
      }, { once: true })
      return Reflect.apply(originalSend, this, args)
    }
  }
  if (typeof PerformanceObserver !== 'function') return
  const observe = (entry) => {
    const activity = 'Resource ' +
      (entry.initiatorType || 'request') + ' ' + sanitizeUrl(entry.name)
    record({ kind: 'activity', description: activity })
  }
  const observer = new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) observe(entry)
  })
  try {
    observer.observe({ type: 'resource', buffered: true })
  } catch {
    observer.observe({ entryTypes: ['resource'] })
  }
})()`

const consumeWebEvidenceScript = `(() => {
  const buffer = globalThis['${evidenceBufferKey}']
  if (!buffer?.entries) return { entries: [], droppedCount: 0 }
  const result = {
    entries: buffer.entries.splice(0),
    droppedCount: buffer.droppedCount,
  }
  buffer.droppedCount = 0
  return result
})()`

function isObservablePage(value: unknown): value is ObservablePage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as ObservablePage).evaluate === 'function',
  )
}

function errorText(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  return String(value)
}

export function createWebEvidenceCollector(
  now = () => new Date().toISOString(),
) {
  const diagnostics: DiagnosticEntry[] = []
  const activity: CollectedWebActivity[] = []

  function recordDiagnostic(
    origin: DiagnosticEntry['origin'],
    message: string,
    occurredAt = now(),
  ) {
    diagnostics.push({ occurredAt, level: 'warning', origin, message })
  }

  function recordAdapterFailure(message: string, error: unknown) {
    recordDiagnostic('adapter', `${message}: ${errorText(error)}`)
  }

  function consume(): CollectedWebEvidence {
    return {
      diagnostics: diagnostics.splice(0).sort(byOccurredAt),
      activity: activity.splice(0).sort(byOccurredAt),
    }
  }

  function recordBufferedEntry(
    entry: z.infer<typeof bufferedEvidenceEntrySchema>,
  ): void {
    if (entry.kind === 'diagnostic') {
      const { kind: _kind, ...diagnostic } = entry
      diagnostics.push(diagnostic)
      return
    }
    const { kind: _kind, ...browserActivity } = entry
    activity.push(browserActivity)
  }

  async function collectPage(page: unknown): Promise<void> {
    if (!isObservablePage(page)) return
    try {
      const parsed = bufferedEvidenceSchema.safeParse(
        await page.evaluate(consumeWebEvidenceScript),
      )
      if (!parsed.success) {
        recordDiagnostic(
          'adapter',
          'Browser evidence buffer returned invalid data',
        )
        return
      }
      for (const entry of parsed.data.entries) recordBufferedEntry(entry)
      if (parsed.data.droppedCount > 0) {
        recordDiagnostic(
          'adapter',
          `Browser evidence truncated; ${parsed.data.droppedCount} entries were dropped`,
        )
      }
    } catch (error) {
      recordAdapterFailure('Browser evidence collection failed', error)
    }
  }

  async function collect(
    pages: readonly unknown[],
  ): Promise<CollectedWebEvidence> {
    for (const page of pages) {
      await collectPage(page)
    }
    return consume()
  }

  return { collect, consume, recordAdapterFailure }
}

type WebEvidenceCollector = ReturnType<typeof createWebEvidenceCollector>

export async function instrumentWebEvidencePages(
  pages: readonly unknown[],
  collector: WebEvidenceCollector,
): Promise<unknown[]> {
  const instrumented = await Promise.all(
    pages.map(async (page) => {
      if (!isObservablePage(page)) return
      try {
        await page.evaluate(installWebEvidenceScript)
        return page
      } catch (error) {
        collector.recordAdapterFailure(
          'Browser evidence instrumentation failed',
          error,
        )
        return
      }
    }),
  )
  return instrumented.filter((page) => page !== undefined)
}

function byOccurredAt(
  left: { occurredAt: string },
  right: { occurredAt: string },
): number {
  return Date.parse(left.occurredAt) - Date.parse(right.occurredAt)
}
