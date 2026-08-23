import type { DiagnosticEntry, DiagnosticLevel } from '@pickle-spec/runner'

export type CollectedWebActivity = {
  occurredAt: string
  description: string
}

export type CollectedWebEvidence = {
  diagnostics: DiagnosticEntry[]
  activity: CollectedWebActivity[]
}

type ListenablePage = {
  on(event: string, listener: (payload: unknown) => void): void
}

function isListenablePage(value: unknown): value is ListenablePage {
  return Boolean(
    value &&
      typeof value === 'object' &&
      typeof (value as ListenablePage).on === 'function',
  )
}

function readMethodOrValue(value: unknown, key: string): unknown {
  if (!value || typeof value !== 'object') return undefined
  const candidate = (value as Record<string, unknown>)[key]
  return typeof candidate === 'function' ? candidate.call(value) : candidate
}

function consoleLevel(type: unknown): DiagnosticLevel {
  const normalized = String(type ?? 'log')
  if (normalized === 'error' || normalized === 'assert') return 'error'
  if (normalized === 'warning') return 'warning'
  if (normalized === 'debug' || normalized === 'trace' || normalized === 'verbose') {
    return 'debug'
  }
  return 'info'
}

function errorText(value: unknown): string {
  if (value instanceof Error) return value.message
  if (typeof value === 'string') return value
  const text = readMethodOrValue(value, 'message')
  return typeof text === 'string' && text.length > 0 ? text : String(value)
}

export function createWebEvidenceCollector(now = () => new Date().toISOString()) {
  const diagnostics: DiagnosticEntry[] = []
  const activity: CollectedWebActivity[] = []
  const attached = new WeakSet<object>()

  function recordDiagnostic(
    level: DiagnosticLevel,
    origin: DiagnosticEntry['origin'],
    message: string,
    occurredAt = now(),
  ) {
    diagnostics.push({ occurredAt, level, origin, message })
  }

  function attach(page: unknown) {
    if (!isListenablePage(page) || attached.has(page)) return
    attached.add(page)
    page.on('console', (message) => {
      recordDiagnostic(
        consoleLevel(readMethodOrValue(message, 'type')),
        'console',
        String(readMethodOrValue(message, 'text') ?? message),
      )
    })
    page.on('pageerror', (error) => {
      recordDiagnostic('error', 'console', errorText(error))
    })
    page.on('requestfailed', (request) => {
      const url = String(readMethodOrValue(request, 'url') ?? 'request')
      const failure = readMethodOrValue(request, 'failure')
      const reason =
        (failure && typeof failure === 'object'
          ? String(
              readMethodOrValue(failure, 'errorText') ??
                readMethodOrValue(failure, 'errorText') ??
                'failed',
            )
          : 'failed')
      recordDiagnostic('error', 'network', `${url} ${reason}`)
    })
    page.on('response', (response) => {
      const status = Number(readMethodOrValue(response, 'status') ?? 0)
      if (status < 400) return
      const url = String(readMethodOrValue(response, 'url') ?? 'response')
      recordDiagnostic(
        status >= 500 ? 'error' : 'warning',
        'network',
        `${url} failed: ${status}`,
      )
    })
    page.on('framenavigated', (frame) => {
      const url = String(readMethodOrValue(frame, 'url') ?? '')
      if (!url) return
      activity.push({
        occurredAt: now(),
        description: `Navigate ${url}`,
      })
    })
  }

  function consume(): CollectedWebEvidence {
    return {
      diagnostics: diagnostics.splice(0),
      activity: activity.splice(0),
    }
  }

  return { attach, consume }
}
