import { runInNewContext } from 'node:vm'
import { expect, test } from 'vitest'
import {
  createWebEvidenceCollector,
  installWebEvidenceScript,
  instrumentWebEvidencePages,
} from './web-evidence'
import { projectWebStepEvidence } from './web-step-evidence'

function observablePage() {
  let buffered: unknown[] = []
  return {
    page: {
      async evaluate() {
        return { entries: buffered.splice(0), droppedCount: 0 }
      },
    },
    buffer(entries: unknown[]) {
      buffered = entries
    },
  }
}

type BrowserScriptEntry = {
  kind: string
  description?: string
  origin?: string
  message?: string
}

type BrowserScriptContext = {
  // biome-ignore lint/style/useNamingConvention: matches the browser API.
  URL: typeof URL
  console: Record<string, (...args: unknown[]) => void>
  location: { href: string }
  addEventListener: () => void
  fetch: (url: string) => Promise<{
    ok: boolean
    status: number
    url: string
  }>
  // biome-ignore lint/style/useNamingConvention: matches the browser API.
  XMLHttpRequest: typeof FakeXmlHttpRequest
  // biome-ignore lint/style/useNamingConvention: matches the browser API.
  PerformanceObserver: typeof FakePerformanceObserver
  __pickleSpecWebEvidenceV1?: {
    entries: BrowserScriptEntry[]
    droppedCount: number
  }
}

class FakeXmlHttpRequest {
  status = 404
  // biome-ignore lint/style/useNamingConvention: matches the browser API.
  responseURL = ''
  private listeners = new Map<string, (event: { type: string }) => void>()

  open(_method?: string, _url?: string) {}

  addEventListener(type: string, listener: (event: { type: string }) => void) {
    this.listeners.set(type, listener)
  }

  send() {
    this.listeners.get('loadend')?.({ type: 'loadend' })
  }
}

function FakePerformanceObserver() {}
FakePerformanceObserver.prototype.observe = () => {}

test('collects console, failed-network, and popup browser buffers once', async () => {
  const collector = createWebEvidenceCollector()
  const browser = observablePage()
  const popup = observablePage()
  browser.buffer([
    {
      kind: 'diagnostic',
      occurredAt: '2026-08-23T12:00:00.001Z',
      level: 'warning',
      origin: 'console',
      message: 'Slow API',
    },
    {
      kind: 'diagnostic',
      occurredAt: '2026-08-23T12:00:00.002Z',
      level: 'error',
      origin: 'network',
      message: 'https://missing.test/pay failed: TypeError: Failed to fetch',
    },
    {
      kind: 'activity',
      occurredAt: '2026-08-23T12:00:00.003Z',
      description: 'Resource fetch https://example.test/pay',
    },
  ])
  popup.buffer([
    {
      kind: 'diagnostic',
      occurredAt: '2026-08-23T12:00:00.004Z',
      level: 'info',
      origin: 'console',
      message: 'Popup ready',
    },
  ])

  expect(await collector.collect([popup.page, browser.page])).toEqual({
    diagnostics: [
      {
        occurredAt: '2026-08-23T12:00:00.001Z',
        level: 'warning',
        origin: 'console',
        message: 'Slow API',
      },
      {
        occurredAt: '2026-08-23T12:00:00.002Z',
        level: 'error',
        origin: 'network',
        message: 'https://missing.test/pay failed: TypeError: Failed to fetch',
      },
      {
        occurredAt: '2026-08-23T12:00:00.004Z',
        level: 'info',
        origin: 'console',
        message: 'Popup ready',
      },
    ],
    activity: [
      {
        occurredAt: '2026-08-23T12:00:00.003Z',
        description: 'Resource fetch https://example.test/pay',
      },
    ],
  })
  expect(await collector.collect([browser.page, popup.page])).toEqual({
    diagnostics: [],
    activity: [],
  })
})

test('keeps browser execution usable when a page cannot be instrumented', async () => {
  const collector = createWebEvidenceCollector(() => '2026-08-23T12:00:00.000Z')
  const available = observablePage()
  const closed = {
    async evaluate() {
      throw new Error('Target page closed')
    },
  }

  expect(
    await instrumentWebEvidencePages([closed, available.page], collector),
  ).toEqual([available.page])
  expect(collector.consume()).toEqual({
    diagnostics: [
      {
        occurredAt: '2026-08-23T12:00:00.000Z',
        level: 'warning',
        origin: 'adapter',
        message: 'Browser evidence instrumentation failed: Target page closed',
      },
    ],
    activity: [],
  })
})

test('the browser script records HTTP failures without duplicate navigation', async () => {
  const context: BrowserScriptContext = {
    URL,
    console: {
      debug() {},
      info() {},
      log() {},
      warn() {},
      error() {},
    },
    location: { href: 'https://example.test/checkout' },
    addEventListener() {},
    async fetch(url) {
      const ok = url.includes('/success')
      return { ok, status: ok ? 204 : 503, url }
    },
    // biome-ignore lint/style/useNamingConvention: matches the browser API.
    XMLHttpRequest: FakeXmlHttpRequest,
    PerformanceObserver: FakePerformanceObserver,
  }
  runInNewContext(installWebEvidenceScript, context)

  await context.fetch(
    'https://user:password@example.test/pay?token=secret&view=summary',
  )
  const xhr = new context.XMLHttpRequest()
  xhr.open('POST', 'https://example.test/xhr?api_key=private')
  xhr.send()
  const firstEntries =
    context.__pickleSpecWebEvidenceV1?.entries.splice(0) ?? []

  expect(
    firstEntries.filter((entry) => entry.description?.startsWith('Navigate ')),
  ).toHaveLength(1)
  expect(
    firstEntries.filter((entry) => entry.origin === 'network'),
  ).toMatchObject([
    {
      message:
        'GET https://example.test/pay?token=%3Credacted%3E&view=summary failed: 503',
    },
    {
      message:
        'POST https://example.test/xhr?api_key=%3Credacted%3E failed: 404',
    },
  ])

  await context.fetch('https://example.test/pay')
  expect(
    context.__pickleSpecWebEvidenceV1?.entries.filter(
      (entry) => entry.origin === 'network',
    ),
  ).toMatchObject([
    {
      message: 'GET https://example.test/pay failed: 503',
    },
  ])

  await context.fetch('https://example.test/success?session=private')
  expect(
    context.__pickleSpecWebEvidenceV1?.entries.find((entry) =>
      entry.message?.includes('/success'),
    ),
  ).toMatchObject({
    message:
      'GET https://example.test/success?session=%3Credacted%3E completed: 204',
  })
})

test('bounds browser evidence and reports truncation', async () => {
  const context: BrowserScriptContext = {
    URL,
    console: {
      debug() {},
      info() {},
      log() {},
      warn() {},
      error() {},
    },
    location: { href: 'https://example.test/' },
    addEventListener() {},
    async fetch(url) {
      return { ok: true, status: 200, url }
    },
    // biome-ignore lint/style/useNamingConvention: matches the browser API.
    XMLHttpRequest: FakeXmlHttpRequest,
    PerformanceObserver: FakePerformanceObserver,
  }
  runInNewContext(installWebEvidenceScript, context)
  const log = context.console.log
  if (!log) throw new Error('Expected an instrumented console logger')
  for (let index = 0; index < 501; index++) log(index)

  const collector = createWebEvidenceCollector()
  const collected = await collector.collect([
    {
      async evaluate() {
        const buffer = context.__pickleSpecWebEvidenceV1
        return {
          entries: buffer?.entries.splice(0) ?? [],
          droppedCount: buffer?.droppedCount ?? 0,
        }
      },
    },
  ])

  expect(collected.diagnostics).toContainEqual(
    expect.objectContaining({
      origin: 'adapter',
      message: 'Browser evidence truncated; 2 entries were dropped',
    }),
  )
})

test('correlates prior resolved actions without rewriting occurrence time', () => {
  const projected = projectWebStepEvidence({
    execution: {
      state: 'failed',
      resolvedActions: [{ description: 'Verify payment is captured' }],
      message: 'Payment was declined',
    },
    step: {
      keyword: 'Then ',
      text: 'payment is captured',
      type: 'outcome',
    },
    collected: {
      diagnostics: [
        {
          occurredAt: '2026-08-23T12:00:00.004Z',
          level: 'error',
          origin: 'console',
          message: 'Payment was declined',
        },
      ],
      activity: [],
    },
    previousResolvedActionTrace: [
      {
        occurredAt: '2026-08-23T12:00:00.001Z',
        kind: 'resolved-action',
        description: 'Click pay on chrome',
      },
    ],
  })

  expect(
    projected.execution.trace?.find(
      (entry) => entry.description === 'Click pay on chrome',
    ),
  ).toEqual({
    occurredAt: '2026-08-23T12:00:00.001Z',
    causalAt: '2026-08-23T12:00:00.004Z',
    kind: 'resolved-action',
    description: 'Click pay on chrome',
  })
  expect(
    projected.execution.diagnostics?.every(
      (entry) => entry.causalAt === '2026-08-23T12:00:00.004Z',
    ),
  ).toBe(true)
})
