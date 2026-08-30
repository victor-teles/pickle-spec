const evidenceBufferKey = '__pickleSpecWebEvidenceV1'

export const installWebEvidenceScript = `(() => {
  const key = '${evidenceBufferKey}'
  if (Array.isArray(globalThis[key])) return
  const entries = []
  Object.defineProperty(globalThis, key, {
    configurable: true,
    value: entries,
  })
  const record = (entry) => entries.push({
    occurredAt: new Date().toISOString(),
    ...entry,
  })
  const recordNetworkFailure = (url, detail, level = 'error') => {
    const message = String(url) + ' failed: ' + String(detail)
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
  record({ kind: 'activity', description: 'Navigate ' + location.href })
  addEventListener('error', (event) => {
    const target = event.target
    const resourceUrl = target && (
      target.currentSrc || target.src || target.href
    )
    if (resourceUrl) {
      recordNetworkFailure(resourceUrl, 'load error')
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
      try {
        const response = await Reflect.apply(originalFetch, this, args)
        if (!response.ok) {
          recordNetworkFailure(
            response.url || requestUrl,
            response.status,
            response.status >= 500 ? 'error' : 'warning',
          )
        }
        return response
      } catch (error) {
        recordNetworkFailure(requestUrl, display(error))
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
      const failed = (event) => recordNetworkFailure(request.url, event.type)
      this.addEventListener('error', failed, { once: true })
      this.addEventListener('abort', failed, { once: true })
      this.addEventListener('timeout', failed, { once: true })
      this.addEventListener('loadend', () => {
        if (this.status >= 400) {
          recordNetworkFailure(
            this.responseURL || request.url,
            this.status,
            this.status >= 500 ? 'error' : 'warning',
          )
        }
      }, { once: true })
      return Reflect.apply(originalSend, this, args)
    }
  }
  if (typeof PerformanceObserver !== 'function') return
  const observe = (entry) => {
    const activity = 'Resource ' +
      (entry.initiatorType || 'request') + ' ' + entry.name
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

export const consumeWebEvidenceScript = `(() => {
  const entries = globalThis['${evidenceBufferKey}']
  return Array.isArray(entries) ? entries.splice(0) : []
})()`
