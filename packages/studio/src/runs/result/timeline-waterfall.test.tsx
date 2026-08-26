import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { TimelineEntry } from './result-evidence'
import { TimelineWaterfall } from './timeline-waterfall'

test('renders a bounded accessible page for a 10,000-entry timeline', () => {
  const entries: TimelineEntry[] = Array.from(
    { length: 10_000 },
    (_, index) => ({
      id: `run:scenario:chrome:1:event-${index}`,
      startedAt: new Date(Date.UTC(2026, 7, 25, 12, 0, 0, index)).toISOString(),
      timingPrecision: 'exact',
      kind: 'Run event',
      title: `Event ${index}`,
      attributes: [{ label: 'Sequence', value: String(index) }],
    }),
  )

  const markup = renderToStaticMarkup(
    <TimelineWaterfall
      entries={entries}
      attemptStartedAt="2026-08-25T12:00:00.000Z"
      durationMs={10_000}
      selectedEntryId={entries[0]?.id}
      followedEntryId={entries[0]?.id}
      following={false}
      onSelect={() => {}}
    />,
  )

  expect(markup.match(/data-timeline-index=/g)?.length).toBe(100)
  expect(markup).toContain('Showing 1–100 of 10000 entries')
  expect(markup).toContain('aria-label="Timeline pages"')
  expect(markup).toContain('Next 100')
  expect(markup).not.toContain('Event 100')
  expect(markup).not.toContain('Event 9999')
})
