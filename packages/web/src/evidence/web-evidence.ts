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
  evaluate(expression: string): Promise<z.core.util.JSONType>
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

function errorText(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
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

  function recordAdapterFailure(message: string, cause: unknown) {
    recordDiagnostic('adapter', `${message}: ${errorText(cause)}`)
  }

  function consume(): CollectedWebEvidence {
    return {
      diagnostics: diagnostics.splice(0).toSorted(byOccurredAt),
      activity: activity.splice(0).toSorted(byOccurredAt),
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

  async function collectPage(page: ObservablePage): Promise<void> {
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
    pages: readonly ObservablePage[],
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
  pages: readonly ObservablePage[],
  collector: WebEvidenceCollector,
): Promise<ObservablePage[]> {
  const instrumented = await Promise.all(
    pages.map(async (page): Promise<ObservablePage | undefined> => {
      try {
        await page.evaluate(installWebEvidenceScript)
        return page
      } catch (error) {
        collector.recordAdapterFailure(
          'Browser evidence instrumentation failed',
          error,
        )
        return undefined
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
