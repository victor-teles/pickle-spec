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

export const consumeWebEvidenceScript = `(() => {
  const buffer = globalThis['${evidenceBufferKey}']
  if (!buffer?.entries) return { entries: [], droppedCount: 0 }
  const result = {
    entries: buffer.entries.splice(0),
    droppedCount: buffer.droppedCount,
  }
  buffer.droppedCount = 0
  return result
})()`
