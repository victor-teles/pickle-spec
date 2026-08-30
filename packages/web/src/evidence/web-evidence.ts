import { type DiagnosticEntry, diagnosticLevels } from '@pickle-spec/runner'
import { z } from 'zod'
import {
  consumeWebEvidenceScript,
  installWebEvidenceScript,
} from './web-evidence-script'

export { installWebEvidenceScript } from './web-evidence-script'

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
