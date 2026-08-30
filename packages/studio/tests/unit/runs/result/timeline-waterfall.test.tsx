import { renderToStaticMarkup } from 'react-dom/server'
import { expect, test } from 'vitest'
import type { TimelineEntry } from '../../../../src/features/runs/result/result-evidence'
import { TimelineWaterfall } from '../../../../src/features/runs/result/timeline-waterfall'

test('renders pointer-only plot proxies for point and duration entries', () => {
  const entries: TimelineEntry[] = [
    {
      id: 'point-entry',
      startedAt: '2026-08-25T12:00:01.000Z',
      timingPrecision: 'exact',
      kind: 'Diagnostic entry',
      title: 'Payment was declined',
      attributes: [],
    },
    {
      id: 'duration-entry',
      startedAt: '2026-08-25T12:00:02.000Z',
      finishedAt: '2026-08-25T12:00:02.010Z',
      timingPrecision: 'exact',
      kind: 'Step',
      title: 'Then payment is captured',
      attributes: [],
    },
  ]

  const markup = renderToStaticMarkup(
    <TimelineWaterfall
      entries={entries}
      attemptStartedAt="2026-08-25T12:00:00.000Z"
      durationMs={4_000}
      selectedEntryId={entries[0]?.id}
      followedEntryId={entries[0]?.id}
      following={false}
      onSelect={() => {}}
    />,
  )

  expect(markup.match(/data-timeline-plot=/g)?.length).toBe(2)
  expect(markup).toContain('data-timeline-plot="point"')
  expect(markup).toContain('data-timeline-plot="duration"')
  expect(markup).toContain('role="presentation" tabindex="-1"')
  expect(markup).toContain('width:44px')
  expect(markup).toContain('width:max(44px, 0.8%)')
  expect(markup).toContain('style="left:25%"')
  expect(markup).toContain('style="left:50%;width:0.8%"')
  expect(markup).toContain('overflow-hidden')
  expect(markup).toContain('data-timeline-duration-label="true"')
  expect(markup).toContain('class="min-w-0 truncate"')
  expect(markup).toContain('px-3 text-left transition-none')
  expect(markup.match(/data-timeline-mark="true"/g)?.length).toBe(2)
  expect(markup).toMatch(
    /data-timeline-mark="true" class="[^"]*transition-none[^"]*peer-hover/,
  )
  expect(markup).toMatch(
    /data-timeline-tick="1000" class="[^"]*whitespace-nowrap/,
  )
  expect(markup).toMatch(
    /data-timeline-tick="4000" class="[^"]*whitespace-nowrap[^"]*right-1\.5/,
  )
  expect(markup).toContain('Timeline entry')
  expect(markup).not.toContain('<button role="presentation"')
})

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
  expect(markup.match(/data-timeline-plot=/g)?.length).toBe(100)
  expect(markup).toContain('Showing 1–100 of 10000 entries')
  expect(markup).toContain('aria-label="Timeline pages"')
  expect(markup).toContain('Next 100')
  expect(markup).not.toContain('Event 100')
  expect(markup).not.toContain('Event 9999')
})
